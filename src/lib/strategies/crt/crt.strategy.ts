import { checklistItem } from "../../brain/decisionSummary";
import { formatPrice, formatR } from "../../ict/format";
import { averageTrueRange } from "../../ict/candles";
import type { Candle, CrtPoi, DealingRange, DecisionSummary, ExecutionCostStress, FairValueGap, MarketContext, MarketSymbol, OrderBlock, QualityGrade, SignalActionWindow, SignalEvidenceItem, SignalGovernance, SignalOutcome, StopSource, SwingPoint, Timeframe, TradeDirection, TradePlan, TradingSignal } from "../../ict/types";
import { isCryptoSymbol } from "../../ict/symbols";
import { defaultAccountModel } from "../../risk/accountModel";
import { estimateExecutionCosts } from "../../risk/executionCosts";
import { calculatePositionSize } from "../../risk/positionSizing";
import { performanceFromSignals } from "../../analytics/performance";
import { evaluateSignalOutcome, buildActionWindow } from "../../intelligence/outcomeEngine";
import { buildCrtBias, validCrtPullback } from "../../intelligence/crtEngine";
import { detectFairValueGaps, detectOrderBlocks, detectSwingPoints } from "../../intelligence/structureEngine";
import type { BacktestInput, StrategyInput, StrategyModule, StrategyResult } from "../types";

const CRT_STRATEGY_ID = "crt";
const DEFAULT_MINIMUM_RR = 1.5;
// Freshness windows in confirmation-TF candles: a sweep older than ~24 bars no longer
// validates a setup. ChoCH stays valid for ~48 bars — staleness is guarded by the
// retest-distance blocker and missed-detection, not by a tight expiry that closes the
// entry window before the retest can arrive. The HTF raid itself does not expire this
// way — it stays valid while the reclaim holds and the range candle is the reference.
const SWEEP_FRESHNESS_CANDLES = 24;
const CHOCH_FRESHNESS_CANDLES = 48;
// How many closed range candles back an accepted raid can keep being the anchor's reference.
const RAID_PERSISTENCE_LOOKBACK = 6;
const SYMBOL_MIN_BUFFER: Record<MarketSymbol, number> = {
  XAUUSD: 0.8,
  NAS100: 12,
  EURUSD: 0.0002,
  GBPUSD: 0.0002,
  USDJPY: 0.03,
  AUDUSD: 0.0002,
  USDCHF: 0.0002,
  BTCUSD: 120,
  ETHUSD: 6,
  XRPUSD: 0.005,
  BNBUSD: 1.5,
  SOLUSD: 0.4
};

// CRT works on multiple anchors; each anchor confirms on its own lower timeframe:
// 1W -> 4H, 1D -> 1H, 4H -> 15m.
type AnchorSpec = { rangeTf: Extract<Timeframe, "4h" | "1d" | "1w">; confirmTf: Extract<Timeframe, "15m" | "1h" | "4h"> };
const ANCHORS: AnchorSpec[] = [
  { rangeTf: "4h", confirmTf: "15m" },
  { rangeTf: "1d", confirmTf: "1h" },
  { rangeTf: "1w", confirmTf: "4h" }
];

type AnchorRaid = { direction: TradeDirection; level: number; time: number; closed: boolean };

type AnchorCtx = {
  spec: AnchorSpec;
  rangeCandles: Candle[];
  confirmCandles: Candle[];
  range: DealingRange;
  raid?: AnchorRaid;
  swings: SwingPoint[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  htfFvgs: FairValueGap[];
  atr: number;
  averageRange: number;
};

type CrtSetup = {
  direction: TradeDirection;
  directionSource: "raid" | "bias" | "pd";
  manipulation?: { side: "buy-side" | "sell-side"; level: number; candleIndex: number; reclaimed: boolean };
  choch?: { level: number; candleIndex: number };
  poi?: CrtPoi;
  plan: TradePlan;
  warnings: string[];
  blockers: string[];
  score: number;
  raidClosed: boolean;
  anchorAtKeyLevel: boolean;
  fvgConfluence: boolean;
};

function expectedPd(direction: TradeDirection) {
  return direction === "short" ? "premium" : "discount";
}

function expectedSweepSide(direction: TradeDirection) {
  return direction === "short" ? "buy-side" : "sell-side";
}

function rangeCandlesFor(context: MarketContext, spec: AnchorSpec): Candle[] {
  if (spec.rangeTf === "4h") return context.timeframes.h4;
  if (spec.rangeTf === "1d") return context.timeframes.daily;
  return context.timeframes.weekly;
}

function confirmCandlesFor(context: MarketContext, spec: AnchorSpec): Candle[] {
  if (spec.confirmTf === "15m") return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  if (spec.confirmTf === "1h") return context.timeframes.h1;
  return context.timeframes.h4;
}

function rangeFromCandle(candle: Candle, spec: AnchorSpec): DealingRange {
  return { high: candle.high, low: candle.low, midpoint: (candle.high + candle.low) / 2, source: `CRT ${spec.rangeTf} range: previous closed candle` };
}

function raidFromPair(range: DealingRange, raidCandle: Candle, closed: boolean, lastClose: number): AnchorRaid | undefined {
  const shortRaid = raidCandle.high > range.high && (!closed || raidCandle.close < range.high) && lastClose < range.high;
  const longRaid = raidCandle.low < range.low && (!closed || raidCandle.close > range.low) && lastClose > range.low;
  if (shortRaid && longRaid) {
    // A forming candle that swept both sides is chaos, not a raid; a closed one tie-breaks
    // by the larger excess.
    if (!closed) return undefined;
    const upExcess = raidCandle.high - range.high;
    const downExcess = range.low - raidCandle.low;
    return upExcess >= downExcess
      ? { direction: "short", level: raidCandle.high, time: raidCandle.time, closed }
      : { direction: "long", level: raidCandle.low, time: raidCandle.time, closed };
  }
  if (shortRaid) return { direction: "short", level: raidCandle.high, time: raidCandle.time, closed };
  if (longRaid) return { direction: "long", level: raidCandle.low, time: raidCandle.time, closed };
  return undefined;
}

// A raid stays alive only while every later close holds the reclaim (a close beyond the
// swept extreme was a breakout) and the distribution target is untouched (a touch of the
// opposite extreme means the setup played out and is consumed).
function raidStillActive(rangeCandles: Candle[], raidIndex: number, range: DealingRange, direction: TradeDirection): boolean {
  for (let index = raidIndex + 1; index < rangeCandles.length; index += 1) {
    const candle = rangeCandles[index];
    if (direction === "short" ? candle.close > range.high : candle.close < range.low) return false;
    if (direction === "short" ? candle.low <= range.low : candle.high >= range.high) return false;
  }
  return true;
}

// SOP steps 2-4: mark CRT-High/Low, wait for the raid, confirm the close back inside.
// A closed raid candle (strongest confirmation) is preferred; a live raid on the forming
// candle is the fast variant. In both cases the reclaim must still hold NOW — if price
// trades beyond the swept extreme, that was a breakout and there is nothing to fade.
// An accepted raid does NOT roll away when the next range candle closes: while it is still
// active, a poke at a newer candle's extreme is that raid's distribution leg (or noise), not
// a fresh setup — so scan oldest-first and keep the waiting setup's direction instead of
// flipping it on every new candle.
function detectAnchorRaid(rangeCandles: Candle[], lastClose: number, spec: AnchorSpec): { range: DealingRange; raid?: AnchorRaid } {
  const n = rangeCandles.length;
  for (let rangeIndex = Math.max(0, n - 2 - RAID_PERSISTENCE_LOOKBACK); rangeIndex <= n - 4; rangeIndex += 1) {
    const range = rangeFromCandle(rangeCandles[rangeIndex], spec);
    const raid = raidFromPair(range, rangeCandles[rangeIndex + 1], true, lastClose);
    if (raid && raidStillActive(rangeCandles, rangeIndex + 1, range, raid.direction)) return { range, raid };
  }
  if (n >= 3) {
    const range = rangeFromCandle(rangeCandles[n - 3], spec);
    const raid = raidFromPair(range, rangeCandles[n - 2], true, lastClose);
    if (raid) return { range, raid };
  }
  if (n >= 2) {
    const range = rangeFromCandle(rangeCandles[n - 2], spec);
    const raid = raidFromPair(range, rangeCandles[n - 1], false, lastClose);
    return raid ? { range, raid } : { range };
  }
  return { range: rangeFromCandle(rangeCandles[n - 1], spec) };
}

function buildAnchorCtx(context: MarketContext, spec: AnchorSpec): AnchorCtx | undefined {
  const rangeCandles = rangeCandlesFor(context, spec);
  const confirmCandles = confirmCandlesFor(context, spec);
  if (rangeCandles.length < 2 || confirmCandles.length < 20) return undefined;
  const lastClose = confirmCandles[confirmCandles.length - 1].close;
  const { range, raid } = detectAnchorRaid(rangeCandles, lastClose, spec);
  const swings = detectSwingPoints(confirmCandles, 3);
  const ranges = confirmCandles.slice(-20).map((candle) => candle.high - candle.low);
  return {
    spec,
    rangeCandles,
    confirmCandles,
    range,
    raid,
    swings,
    fvgs: detectFairValueGaps(confirmCandles),
    orderBlocks: detectOrderBlocks(confirmCandles, swings),
    htfFvgs: detectFairValueGaps(rangeCandles),
    atr: averageTrueRange(confirmCandles, 14),
    averageRange: ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1)
  };
}

function symbolBuffer(anchor: AnchorCtx, symbol: MarketSymbol): number {
  return Math.max(anchor.atr * 0.2, anchor.averageRange * 0.15, SYMBOL_MIN_BUFFER[symbol]);
}

function confirmIndexAtTime(candles: Candle[], time: number): number {
  const index = candles.findIndex((candle) => candle.time >= time);
  return index >= 0 ? index : Math.max(0, candles.length - 1);
}

function anchorBias(anchor: AnchorCtx) {
  return buildCrtBias(anchor.rangeCandles, anchor.spec.rangeTf === "4h" ? "4h" : anchor.spec.rangeTf === "1d" ? "1d" : "1w");
}

function directionForAnchor(context: MarketContext, anchor: AnchorCtx): { direction: TradeDirection; source: CrtSetup["directionSource"] } | undefined {
  if (anchor.raid) return { direction: anchor.raid.direction, source: "raid" };
  const bias = anchorBias(anchor);
  if (bias.direction === "long" || bias.direction === "short") return { direction: bias.direction, source: "bias" };
  if (anchor.spec.rangeTf === "4h") {
    return { direction: context.premiumDiscount.zone === "premium" ? "short" : "long", source: "pd" };
  }
  return undefined;
}

function manipulationForAnchor(anchor: AnchorCtx, direction: TradeDirection): CrtSetup["manipulation"] {
  // The HTF raid IS the manipulation — it stays valid while the reclaim holds, it does not
  // expire on an LTF freshness window. Confirmation-TF sweeps are the fine-grained variant.
  if (anchor.raid && anchor.raid.direction === direction) {
    return {
      side: expectedSweepSide(direction),
      level: anchor.raid.level,
      candleIndex: confirmIndexAtTime(anchor.confirmCandles, anchor.raid.time),
      reclaimed: true
    };
  }
  const candles = anchor.confirmCandles;
  const lastClose = candles[candles.length - 1].close;
  const rangeLevel = direction === "short" ? anchor.range.high : anchor.range.low;
  if (direction === "short" ? lastClose >= rangeLevel : lastClose <= rangeLevel) return undefined;
  const freshnessStart = Math.max(0, candles.length - SWEEP_FRESHNESS_CANDLES);
  const rangeSweep = candles
    .map((candle, candleIndex) => ({ candle, candleIndex }))
    .filter(({ candleIndex }) => candleIndex >= freshnessStart)
    .filter(({ candle }) => direction === "short"
      ? candle.high > rangeLevel && candle.close < rangeLevel
      : candle.low < rangeLevel && candle.close > rangeLevel)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  if (rangeSweep) {
    return {
      side: expectedSweepSide(direction),
      level: direction === "short" ? rangeSweep.candle.high : rangeSweep.candle.low,
      candleIndex: rangeSweep.candleIndex,
      reclaimed: true
    };
  }
  const swingSide = direction === "short" ? "high" : "low";
  const swingSweep = anchor.swings
    .filter((point) => point.side === swingSide)
    .filter((point) => direction === "short" ? lastClose < point.level : lastClose > point.level)
    .flatMap((point) => candles
      .map((candle, candleIndex) => ({ point, candle, candleIndex }))
      .filter(({ candleIndex }) => candleIndex > point.candleIndex && candleIndex >= freshnessStart)
      .filter(({ candle }) => direction === "short"
        ? candle.high > point.level && candle.close < point.level
        : candle.low < point.level && candle.close > point.level))
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  return swingSweep
    ? { side: expectedSweepSide(direction), level: direction === "short" ? swingSweep.candle.high : swingSweep.candle.low, candleIndex: swingSweep.candleIndex, reclaimed: true }
    : undefined;
}

function chochForAnchor(anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"], buffer: number): CrtSetup["choch"] {
  const candles = anchor.confirmCandles;
  const startIndex = manipulation?.candleIndex ?? Math.max(0, candles.length - CHOCH_FRESHNESS_CANDLES);
  const swingSide = direction === "short" ? "low" : "high";
  const swing = [...anchor.swings]
    .filter((point) => point.side === swingSide && point.candleIndex < startIndex)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  const level = swing?.level;
  if (typeof level !== "number") return undefined;
  // The ChoCH reference must live inside the CRT range: a stale swing from prior structure
  // outside the range produces entries far away from the actual setup.
  if (level > anchor.range.high + buffer || level < anchor.range.low - buffer) return undefined;
  const confirmIndex = candles.findIndex((candle, index) => {
    if (index <= startIndex) return false;
    return direction === "short" ? candle.close < level : candle.close > level;
  });
  if (confirmIndex < 0) return undefined;
  if (confirmIndex < candles.length - CHOCH_FRESHNESS_CANDLES) return undefined;
  return { level, candleIndex: confirmIndex };
}

function poiForAnchor(anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"]): CrtPoi | undefined {
  // SOP step 7: the entry POI is the FVG/OB the raid's reversal leg leaves behind — an old
  // zone from prior structure is a different trade, and a synthetic OTE is not a POI at all.
  if (!manipulation) return undefined;
  const candles = anchor.confirmCandles;
  const lastClose = candles[candles.length - 1].close;
  const range = anchor.range;
  const pois: CrtPoi[] = [
    ...anchor.fvgs.map((gap): CrtPoi => ({
      type: gap.mitigated ? "breaker" : "fvg",
      direction: gap.direction,
      low: gap.low,
      high: gap.high,
      midpoint: gap.midpoint,
      candleIndex: gap.candleIndex,
      mitigated: gap.mitigated,
      label: gap.mitigated ? "Breaker / mitigated FVG" : "FVG"
    })),
    ...anchor.orderBlocks.map((block): CrtPoi => ({
      type: block.mitigated ? "breaker" : "ob",
      direction: block.direction,
      low: block.low,
      high: block.high,
      midpoint: block.midpoint,
      candleIndex: block.candleIndex,
      mitigated: block.mitigated,
      label: block.mitigated ? "Breaker Block" : "Order Block"
    }))
  ];
  const priority: Record<CrtPoi["type"], number> = { fvg: 0, ob: 1, breaker: 2, ote: 3 };
  return pois
    .filter((poi) => poi.direction === direction)
    .filter((poi) => (poi.candleIndex ?? -1) >= manipulation.candleIndex)
    .filter((poi) => poi.midpoint <= range.high && poi.midpoint >= range.low)
    .filter((poi) => direction === "long" ? poi.midpoint <= lastClose : poi.midpoint >= lastClose)
    .filter((poi) => {
      const start = Math.max(0, poi.candleIndex ?? 0);
      return candles.slice(start).some((candle) => candle.low <= poi.high && candle.high >= poi.low);
    })
    .sort((a, b) => priority[a.type] - priority[b.type] || (b.candleIndex ?? 0) - (a.candleIndex ?? 0))[0];
}

function targetDol(anchor: AnchorCtx, direction: TradeDirection, entry: number): number | undefined {
  // CRT distribution target: the opposite side of the range candle. Never fabricate a
  // synthetic entry±2R target — a setup without a real draw has no trade.
  const rangeTarget = direction === "short" ? anchor.range.low : anchor.range.high;
  const rangeIsUseful = direction === "short" ? rangeTarget < entry : rangeTarget > entry;
  if (rangeIsUseful) return rangeTarget;
  const bias = anchorBias(anchor);
  if (bias.direction !== "neutral") {
    const dolIsUseful = direction === "short" ? bias.drawLevel < entry : bias.drawLevel > entry;
    if (dolIsUseful) return bias.drawLevel;
  }
  return undefined;
}

function executionCostStress(settings: StrategyInput["settings"]): ExecutionCostStress {
  if (settings.useExecutionCosts === false) return "off";
  return settings.slippageStress === "high" ? "high" : "normal";
}

function buildAnchorPlan(context: MarketContext, anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"], choch: CrtSetup["choch"], poi: CrtPoi | undefined, minimumRR: number, stress: ExecutionCostStress): TradePlan {
  const candles = anchor.confirmCandles;
  const latest = candles[candles.length - 1];
  const buffer = symbolBuffer(anchor, context.symbol);
  // Entry is the retest after confirmation, never the displaced ChoCH close: chasing the
  // displacement leaves no room to the distribution target and destroys RR.
  const insideRange = (level: number) => level <= anchor.range.high && level >= anchor.range.low;
  const retestLevel = choch
    ? (poi && insideRange(poi.midpoint) && (direction === "short" ? poi.midpoint > choch.level : poi.midpoint < choch.level) ? poi.midpoint : choch.level)
    : undefined;
  const entry = retestLevel ?? poi?.midpoint ?? latest.close;
  // Stop must sit on the loss side of the entry.
  const manipulationStop = manipulation
    ? direction === "short" ? manipulation.level + buffer : manipulation.level - buffer
    : undefined;
  const manipulationStopValid = typeof manipulationStop === "number"
    && (direction === "short" ? manipulationStop > entry : manipulationStop < entry);
  const stopSource: StopSource = manipulationStopValid ? "manipulation" : "swing";
  const stopLoss = manipulationStopValid && typeof manipulationStop === "number"
    ? manipulationStop
    : direction === "short" ? anchor.range.high + buffer : anchor.range.low - buffer;
  const riskDistance = Math.max(Math.abs(entry - stopLoss), 0.000001);
  const tp1 = anchor.range.midpoint;
  const realTarget = targetDol(anchor, direction, entry);
  const tp2 = realTarget ?? tp1;
  const costs = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp2, stress });
  const entryStatus = choch ? "confirmed" : poi ? "pending" : "fallback";
  const entrySource = choch ? "choch-close" : poi ? "poi-retest" : "fallback-close";
  const planWarnings = [
    `CRT ${anchor.spec.rangeTf} range ${formatPrice(anchor.range.low)}-${formatPrice(anchor.range.high)}; confirmation ${anchor.spec.confirmTf}.`,
    `TP1/EQ yönetim seviyesi ${formatPrice(tp1)}; TP2/DOL ${formatPrice(tp2)}.`,
    `Stop manipulation wick dışına ${formatPrice(buffer)} buffer ile kondu.`,
    ...(costs.netRR < minimumRR ? [`TP2/DOL net RR ${costs.netRR.toFixed(2)}, minimum ${minimumRR}. READY değil.`] : []),
    ...(entryStatus !== "confirmed" ? [`${anchor.spec.confirmTf} ChoCH/Just mum kapanışı bekleniyor.`] : [])
  ];

  return {
    entry,
    entrySource,
    entryStatus,
    entryModel: {
      source: entrySource,
      status: entryStatus,
      level: entry,
      retested: Boolean(poi),
      cisdConfirmed: Boolean(choch),
      fairValueGap: poi?.type === "fvg" || poi?.type === "breaker"
        ? { direction: poi.direction, low: poi.low, high: poi.high, midpoint: poi.midpoint, candleIndex: poi.candleIndex ?? 0, mitigated: poi.mitigated }
        : undefined,
      warnings: entryStatus === "confirmed" ? [] : [`POI teması sonrası ${anchor.spec.confirmTf} ChoCH/Just kapanışı bekleniyor.`]
    },
    stopLoss,
    targets: [tp1, tp2],
    invalidation: stopLoss,
    rr: costs.netRR,
    grossRR: costs.grossRR,
    riskDistance,
    stopSource,
    stopBuffer: buffer,
    targetSource: "crt-dol",
    executionCosts: costs,
    planWarnings
  };
}

function buildAnchorSetup(context: MarketContext, settings: StrategyInput["settings"], anchor: AnchorCtx): CrtSetup | undefined {
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const picked = directionForAnchor(context, anchor);
  if (!picked) return undefined;
  const { direction, source: directionSource } = picked;
  const buffer = symbolBuffer(anchor, context.symbol);
  const manipulation = manipulationForAnchor(anchor, direction);
  const choch = chochForAnchor(anchor, direction, manipulation, buffer);
  const poi = poiForAnchor(anchor, direction, manipulation);
  const plan = buildAnchorPlan(context, anchor, direction, manipulation, choch, poi, minimumRR, executionCostStress(settings));
  const bias = anchorBias(anchor);
  const biasConflict = directionSource === "raid" && bias.direction !== "neutral" && bias.direction !== direction;
  const continuationAgainst = (bias.kind === "bullish-continuation" && direction === "short")
    || (bias.kind === "bearish-continuation" && direction === "long");
  const lastClose = anchor.confirmCandles[anchor.confirmCandles.length - 1].close;
  const reclaimHolds = direction === "short" ? lastClose < anchor.range.high : lastClose > anchor.range.low;
  const crtZone = plan.entry >= anchor.range.midpoint ? "premium" : "discount";
  const pdAligned = crtZone === expectedPd(direction);
  const smtAligned = context.smtDivergences.some((item) => item.direction === direction);
  const inSession = isCryptoSymbol(context.symbol) || context.killzones.some((zone) => zone.active && zone.name !== "Outside");
  const tp1Valid = direction === "short" ? plan.targets[0] < plan.entry : plan.targets[0] > plan.entry;
  const stopValid = direction === "short" ? plan.stopLoss > plan.entry : plan.stopLoss < plan.entry;
  // The retest must be plausible: an entry sitting further than 1.5R from current price is
  // last month's liquidity grab, not this setup's entry.
  const retestFar = Math.abs(lastClose - plan.entry) > plan.riskDistance * 1.5;
  // If EQ pays less than half the risk, the 50% partial cannot carry the losers: the
  // win/loss asymmetry goes negative even with a decent win rate.
  const eqDistanceR = Math.abs(plan.targets[0] - plan.entry) / Math.max(plan.riskDistance, 0.000001);
  const eqTooClose = tp1Valid && eqDistanceR < 0.5;
  const hasRealTarget = typeof targetDol(anchor, direction, plan.entry) === "number";
  const anchorRanges = anchor.rangeCandles.slice(-20).map((candle) => candle.high - candle.low);
  const anchorAverageRange = anchorRanges.reduce((sum, value) => sum + value, 0) / Math.max(anchorRanges.length, 1);
  const rangeHeight = anchor.range.high - anchor.range.low;
  const rangeTooSmall = anchorAverageRange > 0 && rangeHeight < anchorAverageRange * 0.6;
  const stopInNoise = plan.riskDistance < anchor.atr * 0.6;
  const opposite: TradeDirection = direction === "short" ? "long" : "short";
  const oppositeStructure = direction === "short" ? "bullish" : "bearish";
  const fullHtfConflict = context.bias.daily === oppositeStructure && context.bias.h4 === oppositeStructure
    && anchor.spec.rangeTf === "4h";
  const pullback = validCrtPullback(anchor.rangeCandles, direction);
  const raidClosed = Boolean(anchor.raid && anchor.raid.direction === direction && anchor.raid.closed);
  const sweptExtreme = direction === "short" ? anchor.range.high : anchor.range.low;
  const anchorAtKeyLevel = context.liquidityObjectives.some((objective) => Math.abs(objective.level - sweptExtreme) <= buffer * 3);
  // "CRT hep FVG içinde": the raid zone overlapping an unmitigated HTF FVG is quality confluence.
  const fvgConfluence = anchor.htfFvgs.some((gap) => sweptExtreme >= gap.low - buffer && sweptExtreme <= gap.high + buffer);

  const blockers = [
    directionSource === "pd" ? "Range extreme raid yok ve HTF bias neutral; trade yönü net değil." : undefined,
    !pdAligned ? `${direction.toUpperCase()} için CRT range ${expectedPd(direction)} gerekir; şu an ${crtZone}.` : undefined,
    !poi && !choch ? "Entry referansı yok: raid displacement'ı FVG/OB bırakmadı ve ChoCH kapanışı yok." : undefined,
    !anchorAtKeyLevel && !fvgConfluence ? "Raid HTF haritada bir POI'ye denk gelmiyor (key level / HTF FVG yok)." : undefined,
    !manipulation ? "Manipulation raid/sweep + reclaim yok." : undefined,
    continuationAgainst ? "HTF continuation kapanışı ters yönde; range close ile kırılmış, bu range'den reversal alınmaz." : undefined,
    !reclaimHolds ? "Fiyat hâlâ range extreminin ötesinde; reclaim tutmuyor, bu manipulation değil breakout." : undefined,
    !choch ? `${anchor.spec.confirmTf} ChoCH/Just mum kapanışı yok.` : undefined,
    !hasRealTarget ? "Gerçek distribution/DOL hedefi yok; entry range'in ötesine taşmış." : undefined,
    rangeTooSmall ? `CRT range mumu ortalama ${anchor.spec.rangeTf} range'in altında; küçük range gürültüdür, trade edilmez.` : undefined,
    stopInNoise ? `Stop mesafesi ${anchor.spec.confirmTf} gürültü bandının içinde; RR görünüşte iyi ama stop korunmasız.` : undefined,
    fullHtfConflict ? "Daily ve 4H bias birlikte ters yönde; tam HTF conflict'te reversal alınmaz." : undefined,
    !tp1Valid ? "Entry range EQ seviyesini geçmiş; TP1 hedefi girişin gerisinde, kovalama riski." : undefined,
    !stopValid ? "Stop entry'nin yanlış tarafında; plan geometrisi bozuk, trade edilemez." : undefined,
    retestFar ? "Retest uzak; fiyat entry alanını terk etmiş, kovalanmaz — yeni raid bekle." : undefined,
    eqTooClose ? `EQ/TP1 mesafesi ${eqDistanceR.toFixed(2)}R; 0.5R altında partial yönetimi kayıpları taşıyamaz.` : undefined,
    context.regime.tradeability === "blocked" ? `Rejim uygun değil: ${context.regime.summary}` : undefined,
    context.regime.type === "trend" && biasConflict ? "Trend rejiminde counter-bias reversal alınmaz; sweep devam hareketine dönüşür." : undefined,
    plan.rr < minimumRR ? `TP2/DOL RR minimumun altında (${plan.rr.toFixed(2)} < ${minimumRR}).` : undefined,
    context.eventRisk.noTrade && settings.avoidNews !== false ? context.eventRisk.summary : undefined,
    context.dataConfidence.score < 35 ? context.dataConfidence.summary : undefined
  ].filter((item): item is string => Boolean(item));
  const warnings = [
    choch && !poi ? "Displacement POI yok; entry ChoCH/MSS seviyesinin retest'i." : undefined,
    !pullback.valid ? `${pullback.summary} (hard gate değil, kalite notu.)` : undefined,
    !inSession ? "Killzone dışı; hard gate değil ama killzone içi setup'ın ihtimali daha yüksek." : undefined,
    !raidClosed && manipulation ? "HTF raid mumu henüz range içine kapanmadı; teyit LTF reclaim ile sınırlı, boyutu küçük tut." : undefined,
    !anchorAtKeyLevel ? "Anchor mum key seviyede değil (PDH/PDL/PWH/PWL uzak); confluence eksik." : undefined,
    !fvgConfluence ? "Raid bölgesi HTF FVG içinde değil; CRT-FVG confluence eksik." : undefined,
    biasConflict ? "HTF bias raid yönünün tersinde; counter-bias reversal, boyutu küçük tut." : undefined,
    context.regime.tradeability === "caution" ? context.regime.summary : undefined,
    !smtAligned ? "SMT yok; hard şart değil, sadece kalite notu." : undefined,
    ...plan.planWarnings
  ].filter((item): item is string => Boolean(item));
  const score = Math.max(0, Math.min(100,
    14
    + (directionSource === "raid" ? (biasConflict ? 12 : 18) : directionSource === "bias" ? 10 : 0)
    + (pullback.valid ? 8 : 0)
    + (pdAligned ? 10 : 0)
    + (poi ? 10 : 0)
    + (manipulation ? 14 : 0)
    + (choch ? 14 : 0)
    + (plan.rr >= minimumRR ? 8 : 0)
    + (smtAligned ? 4 : 0)
    + (raidClosed ? 8 : 0)
    + (anchorAtKeyLevel ? 5 : 0)
    + (fvgConfluence ? 5 : 0)
    + (inSession ? 6 : 0)
    + Math.min(6, Math.max(0, (context.dataConfidence.score - 50) / 10))
  ));
  // A setup with open blockers is not A-grade material no matter how many boxes it ticks.
  const cappedScore = blockers.length ? Math.min(score, 72) : score;
  return {
    direction,
    directionSource,
    manipulation,
    choch,
    poi,
    plan: { ...plan, planWarnings: Array.from(new Set(warnings)) },
    warnings,
    blockers,
    score: cappedScore,
    raidClosed,
    anchorAtKeyLevel,
    fvgConfluence
  };
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 90) return "A+";
  if (score >= 78) return "A";
  if (score >= 64) return "B";
  if (score >= 48) return "C";
  return "D";
}

function crtChecklist(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup) {
  const direction = setup.direction;
  const crtZone = setup.plan.entry >= anchor.range.midpoint ? "premium" : "discount";
  const pdAligned = crtZone === expectedPd(direction);
  const smtAligned = context.smtDivergences.some((item) => item.direction === direction);
  const bias = anchorBias(anchor);
  return [
    checklistItem("CRT Bias / DOL", bias.direction === direction ? "pass" : bias.direction === "neutral" ? "neutral" : "fail", bias.summary),
    checklistItem(`${anchor.spec.rangeTf.toUpperCase()} Range`, "pass", anchor.range.source),
    checklistItem("Valid Pullback", validCrtPullback(anchor.rangeCandles, direction).valid ? "pass" : "neutral", validCrtPullback(anchor.rangeCandles, direction).summary),
    checklistItem("Premium / Discount", pdAligned ? "pass" : "fail", `${direction.toUpperCase()} için CRT range ${expectedPd(direction)}; entry ${crtZone}.`),
    checklistItem("POI Touch", setup.poi ? "pass" : setup.choch ? "neutral" : "fail", setup.poi ? `Raid sonrası ${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)}.` : setup.choch ? "Displacement POI yok; entry ChoCH retest seviyesi." : "Raid sonrası FVG/OB oluşmadı."),
    checklistItem("Manipulation", setup.manipulation ? "pass" : "fail", setup.manipulation ? `${setup.manipulation.side} raid ${formatPrice(setup.manipulation.level)}.` : "Raid/sweep + reclaim bekleniyor."),
    checklistItem("HTF Raid Close-Back", setup.raidClosed ? "pass" : "neutral", "Raid mumunun range içine kapanışı en güçlü teyit; yoksa teyit LTF reclaim ile sınırlı."),
    checklistItem("Key Level Anchor", setup.anchorAtKeyLevel ? "pass" : "neutral", "Anchor mumun swept extremi PDH/PDL/PWH/PWL gibi bir key seviyeye yakın olmalı."),
    checklistItem("HTF FVG Confluence", setup.fvgConfluence ? "pass" : "neutral", "Raid bölgesi bir HTF FVG'ye denk gelirse kalite artar."),
    checklistItem(
      "Killzone",
      isCryptoSymbol(context.symbol) || context.killzones.some((zone) => zone.active && zone.name !== "Outside") ? "pass" : "neutral",
      "Killzone içi zamanlama ihtimali artırır; hard şart değil."
    ),
    checklistItem("ChoCH / Just", setup.choch ? "pass" : "fail", setup.choch ? `${anchor.spec.confirmTf} kapanış ${formatPrice(setup.choch.level)} seviyesini kırdı.` : `${anchor.spec.confirmTf} kapanışla kırılma bekleniyor.`),
    checklistItem("SMT", smtAligned ? "pass" : "neutral", smtAligned ? "SMT kalite teyidi var." : "SMT hard şart değil."),
    checklistItem("RR to DOL", setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "fail", `TP2/DOL net RR ${formatR(setup.plan.rr)}.`),
    checklistItem("Data", context.dataConfidence.score >= 68 ? "pass" : context.dataConfidence.score >= 35 ? "neutral" : "fail", context.dataConfidence.summary)
  ];
}

function crtDecisionSummary(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup, grade: QualityGrade, riskWarnings: string[]): DecisionSummary {
  const checklist = crtChecklist(context, anchor, setup);
  const side = setup.direction === "short" ? "Bearish" : "Bullish";
  const fullReasoning = [
    `${context.symbol} ${side} CRT setup (${anchor.spec.rangeTf} range, ${anchor.spec.confirmTf} confirmation).`,
    anchorBias(anchor).summary,
    `Aktif CRT range ${formatPrice(anchor.range.low)}-${formatPrice(anchor.range.high)}, EQ ${formatPrice(anchor.range.midpoint)}.`,
    setup.poi ? `POI: ${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)}.` : "POI bekleniyor.",
    setup.manipulation ? `Manipulation: ${setup.manipulation.side} raid ${formatPrice(setup.manipulation.level)}${setup.raidClosed ? " (HTF close-back teyitli)" : ""}.` : "Manipulation/raid bekleniyor.",
    setup.choch ? `ChoCH/Just close ${formatPrice(setup.choch.level)} kırdı.` : `${anchor.spec.confirmTf} ChoCH/Just kapanışı bekleniyor.`,
    `Entry ${formatPrice(setup.plan.entry)}, SL ${formatPrice(setup.plan.stopLoss)}, EQ/TP1 ${formatPrice(setup.plan.targets[0])}, DOL/TP2 ${formatPrice(setup.plan.targets[1])}.`,
    `Grade ${grade}, net RR ${formatR(setup.plan.rr)}.`,
    ...riskWarnings
  ].join(" ");
  return {
    shortSummary: `${context.symbol} ${setup.direction.toUpperCase()} CRT ${anchor.spec.rangeTf} ${setup.plan.entryStatus === "confirmed" ? "plan" : "watch"} · RR ${formatR(setup.plan.rr)}.`,
    fullReasoning,
    checklist,
    warnings: Array.from(new Set([...setup.warnings, ...riskWarnings])).slice(0, 8),
    invalidation: [`${formatPrice(setup.plan.stopLoss)} stop/invalidation görülürse CRT setup geçersiz olur.`],
    confidence: Math.max(0, Math.min(100, setup.score - setup.blockers.length * 8))
  };
}

function governanceFor(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): SignalGovernance {
  const status: SignalGovernance["status"] = setup.blockers.length ? "caution" : "allow";
  return {
    status,
    scoreImpact: setup.blockers.length ? -12 : 6,
    blockers: setup.blockers,
    warnings: setup.warnings,
    checklist: crtChecklist(context, anchor, setup),
    summary: setup.blockers[0] ?? "CRT SOP tamam: raid, close-back, ChoCH ve DOL planı okunabilir."
  };
}

function m15StartIndex(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): number {
  const m15 = context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  const startTime = typeof setup.manipulation?.candleIndex === "number"
    ? anchor.confirmCandles[setup.manipulation.candleIndex]?.time
    : undefined;
  if (typeof startTime !== "number") return Math.max(0, m15.length - 1);
  const index = m15.findIndex((candle) => candle.time >= startTime);
  return index >= 0 ? index : Math.max(0, m15.length - 1);
}

function lifecycle(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup, readyCandidate: boolean): { stage: TradingSignal["stage"]; outcome: SignalOutcome; actionWindow: SignalActionWindow } {
  const outcome = evaluateSignalOutcome(context, setup.direction, setup.plan, m15StartIndex(context, anchor, setup));
  // Only a confirmed entry can be stopped out; a hypothetical fallback entry running through
  // history must not kill a setup that is still waiting for its ChoCH confirmation.
  if (setup.plan.entryStatus === "confirmed" && outcome.status === "stopped") {
    return { stage: "invalidated", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "invalidated") };
  }
  // But "the trade already played out" is real for any concrete entry level (confirmed OR
  // pending POI): if price consumed the level and ran to the targets, the setup is gone —
  // advertising a limit at last month's liquidity grab is chasing in reverse.
  if (setup.plan.entryStatus !== "fallback"
    && (outcome.status === "tp1" || outcome.status === "tp2" || outcome.status === "missed")) {
    return { stage: "missed", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "missed") };
  }
  const stage = readyCandidate ? "ready" : "watch";
  return { stage, outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, stage) };
}

function evidenceFor(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): SignalEvidenceItem[] {
  const bias = anchorBias(anchor);
  return [
    { id: "crt-bias", label: "CRT Bias / DOL", status: bias.direction === setup.direction ? "pass" : "fail", detail: bias.summary, timeframe: anchor.spec.rangeTf, price: bias.drawLevel },
    { id: "crt-range", label: `${anchor.spec.rangeTf.toUpperCase()} Candle Range`, status: "pass", detail: `${anchor.spec.rangeTf} range high/low/mid used.`, timeframe: anchor.spec.rangeTf, price: anchor.range.midpoint },
    { id: "valid-pullback", label: "Valid Pullback", status: validCrtPullback(anchor.rangeCandles, setup.direction).valid ? "pass" : "neutral", detail: validCrtPullback(anchor.rangeCandles, setup.direction).summary, timeframe: anchor.spec.rangeTf },
    { id: "poi", label: "POI", status: setup.poi ? "pass" : "fail", detail: setup.poi ? `${setup.poi.label} touched.` : "FVG/OB/Breaker/OTE touch bekleniyor.", timeframe: anchor.spec.confirmTf, candleIndex: setup.poi?.candleIndex, price: setup.poi?.midpoint },
    { id: "manipulation", label: "Manipulation", status: setup.manipulation ? "pass" : "fail", detail: setup.manipulation ? `${setup.manipulation.side} raid + reclaim${setup.raidClosed ? " (closed)" : ""}.` : "Raid/sweep + reclaim yok.", timeframe: anchor.spec.confirmTf, candleIndex: setup.manipulation?.candleIndex, price: setup.manipulation?.level },
    { id: "choch", label: "ChoCH / Just", status: setup.choch ? "pass" : "fail", detail: setup.choch ? `Close broke ${formatPrice(setup.choch.level)}.` : "Kapanışla kırılma yok.", timeframe: anchor.spec.confirmTf, candleIndex: setup.choch?.candleIndex, price: setup.choch?.level },
    { id: "eq-management", label: "EQ / TP1", status: "neutral", detail: `0.5 range management: ${formatPrice(setup.plan.targets[0])}.`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[0] },
    { id: "dol-target", label: "DOL / TP2", status: setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning", detail: `Final DOL target ${formatPrice(setup.plan.targets[1])}, RR ${formatR(setup.plan.rr)}.`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[1] }
  ];
}

function anchorSignal(context: MarketContext, settings: StrategyInput["settings"], spec: AnchorSpec): TradingSignal | undefined {
  const anchor = buildAnchorCtx(context, spec);
  if (!anchor) return undefined;
  // Non-primary anchors only surface when a live raid exists — otherwise they are noise.
  if (spec.rangeTf !== "4h" && !anchor.raid) return undefined;
  const setup = buildAnchorSetup(context, settings, anchor);
  if (!setup) return undefined;
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const readyCandidate = setup.blockers.length === 0 && setup.plan.entryStatus === "confirmed" && setup.plan.rr >= minimumRR;
  const life = lifecycle(context, anchor, setup, readyCandidate);
  const grade = gradeFromScore(setup.score);
  const position = calculatePositionSize({
    account: defaultAccountModel,
    symbol: context.symbol,
    entry: setup.plan.entry,
    stopLoss: setup.plan.stopLoss,
    target: setup.plan.targets[1] ?? setup.plan.targets[0]
  });
  return {
    id: `${context.symbol}-${setup.direction}-${anchor.confirmCandles.at(-1)?.time ?? Date.now()}-crt-${spec.rangeTf}`,
    strategyId: CRT_STRATEGY_ID,
    symbol: context.symbol,
    direction: setup.direction,
    stage: life.stage,
    grade,
    score: setup.score,
    createdAt: Date.now(),
    timeframe: spec.confirmTf,
    plan: setup.plan,
    context,
    decisionSummary: crtDecisionSummary(context, anchor, setup, grade, position.warnings),
    evidence: evidenceFor(context, anchor, setup),
    riskWarnings: position.warnings,
    outcome: life.outcome,
    governance: governanceFor(context, anchor, setup),
    actionWindow: life.actionWindow,
    crtAnchor: {
      rangeTf: spec.rangeTf,
      confirmTf: spec.confirmTf,
      raidActive: Boolean(anchor.raid && anchor.raid.direction === setup.direction),
      raidClosed: setup.raidClosed,
      rangeHigh: anchor.range.high,
      rangeLow: anchor.range.low
    }
  };
}

const STAGE_RANK: Record<string, number> = { ready: 0, watch: 1, missed: 2, invalidated: 3 };

function signalsFromContext(context: MarketContext, settings: StrategyInput["settings"]): TradingSignal[] {
  return ANCHORS
    .map((spec) => anchorSignal(context, settings, spec))
    .filter((signal): signal is TradingSignal => Boolean(signal))
    .sort((a, b) => (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9) || b.score - a.score);
}

export const crtStrategy: StrategyModule = {
  id: CRT_STRATEGY_ID,
  name: "CRT Candle Range",
  description: "Candle Range Theory: 4H/1D/1W range, raid + close-back, LTF ChoCH confirmation, retest entry, EQ/DOL plan.",
  requiredTimeframes: ["1M", "1w", "1d", "4h", "1h", "15m"],
  defaultSettings: {
    minimumRR: 1.5,
    mode: "watch_ready",
    useExecutionCosts: true,
    slippageStress: "normal",
    noAutoExecution: true
  },
  scan(input: StrategyInput): StrategyResult {
    const signals = signalsFromContext(input.context, input.settings);
    const best = signals[0];
    return {
      signals,
      rejectedSetups: best && best.stage !== "ready"
        ? [{ symbol: input.context.symbol, strategyId: this.id, reason: best.governance.blockers[0] ?? best.plan.planWarnings[0] ?? "CRT confirmation bekleniyor.", score: best.score }]
        : []
    };
  },
  backtest(input: BacktestInput) {
    return performanceFromSignals(
      input.contexts
        .map((context) => signalsFromContext(context, input.settings)[0])
        .filter((signal): signal is TradingSignal => Boolean(signal))
    );
  }
};
