import { checklistItem } from "../../brain/decisionSummary";
import { formatPrice, formatR } from "../../ict/format";
import { averageTrueRange, completedCandles } from "../../ict/candles";
import type { Candle, CrtBiasContext, CrtPoi, DealingRange, DecisionSummary, ExecutionCostStress, FairValueGap, MarketContext, MarketSymbol, OrderBlock, QualityGrade, SignalActionWindow, SignalEvidenceItem, SignalGovernance, SignalOutcome, StopSource, SwingPoint, Timeframe, TradeDirection, TradePlan, TradingSignal } from "../../ict/types";
import { isCryptoSymbol } from "../../ict/symbols";
import { defaultAccountModel } from "../../risk/accountModel";
import { estimateExecutionCosts } from "../../risk/executionCosts";
import { calculatePositionSize } from "../../risk/positionSizing";
import { performanceFromSignals } from "../../analytics/performance";
import { evaluateSignalOutcome, buildActionWindow } from "../../intelligence/outcomeEngine";
import { buildCrtBias, validCrtPullback } from "../../intelligence/crtEngine";
import { detectFairValueGaps, detectOrderBlocks, detectSwingPoints } from "../../intelligence/structureEngine";
import { buildKillzoneContext } from "../../intelligence/killzoneContextEngine";
import type { BacktestInput, StrategyInput, StrategyModule, StrategyResult } from "../types";
import { detectLatestTurtleSoup, type TurtleSoupPattern } from "./turtleSoup";

const CRT_STRATEGY_ID = "crt";
const DEFAULT_MINIMUM_RR = 1.5;
// Freshness windows in confirmation-TF candles: a sweep older than ~24 bars no longer
// validates a setup. ChoCH stays valid for ~48 bars — staleness is guarded by the
// retest-distance blocker and missed-detection, not by a tight expiry that closes the
// entry window before the retest can arrive. The HTF raid itself does not expire this
// way — it stays valid while the reclaim holds and the range candle is the reference.
const SWEEP_FRESHNESS_CANDLES = 24;
const CHOCH_FRESHNESS_CANDLES = 48;
const CHOCH_SWING_WING = 3;
const CHOCH_REFERENCE_LOOKBACK = 24;
// How many closed range candles back an accepted raid can keep being the anchor's reference.
const RAID_PERSISTENCE_LOOKBACK = 6;
// A tapped 4H FVG can create an origin-CRT read, but only while the tap is fresh. Old gaps
// kept every pair in permanent WATCH and made the dashboard look smarter than the chart.
const FVG_ORIGIN_MAX_AGE_CANDLES = 10;
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

// CRT anchor/confirmation canon: each anchor timeframe confirms on its own lower timeframe.
//   1W range -> 4H confirmation
//   1D range -> 1H confirmation
//   4H range -> 15m confirmation (5m acceptable when 15m is unavailable)
// The 4H candles are read off New York-close charts (opens 17/21/01/05/09/13 NY); the
// 01:00 / 05:00 / 09:00 NY opens are the doctrine's key candles — London raids Asia's
// candle, New York raids London's.
type AnchorSpec = { rangeTf: Extract<Timeframe, "4h" | "1d" | "1w">; confirmTf: Extract<Timeframe, "15m" | "1h" | "4h"> };
const ANCHORS: AnchorSpec[] = [
  { rangeTf: "4h", confirmTf: "15m" },
  { rangeTf: "1d", confirmTf: "1h" },
  { rangeTf: "1w", confirmTf: "4h" }
];

type AnchorRaid = { direction: TradeDirection; level: number; time: number; closed: boolean };
type AnchorOrigin = {
  kind: "fvg-origin";
  direction: TradeDirection;
  fvg: FairValueGap;
  originIndex: number;
  tapIndex: number;
} | {
  kind: "active-crt";
  direction: TradeDirection;
  originIndex: number;
  label: string;
  bias: CrtBiasContext;
  closed: boolean;
};

type AnchorCtx = {
  spec: AnchorSpec;
  rangeCandles: Candle[];
  confirmCandles: Candle[];
  liveConfirmCandles: Candle[];
  range: DealingRange;
  raid?: AnchorRaid;
  swings: SwingPoint[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  htfFvgs: FairValueGap[];
  atr: number;
  averageRange: number;
  turtleSoup?: TurtleSoupPattern;
  origin?: AnchorOrigin;
};

type CrtSetup = {
  direction: TradeDirection;
  directionSource: "turtle-soup" | "raid" | "bias" | "fvg-crt" | "active-crt";
  setupPhase: "context" | "raid" | "model" | "ready";
  manipulation?: { side: "buy-side" | "sell-side"; level: number; candleIndex: number; reclaimed: boolean };
  chochReference?: { level: number; candleIndex: number };
  choch?: { level: number; candleIndex: number; referenceCandleIndex: number; bodyRatio: number; rangeAtr: number };
  poi?: CrtPoi;
  retestIndex?: number;
  turtleSoup?: TurtleSoupPattern;
  plan: TradePlan;
  warnings: string[];
  blockers: string[];
  score: number;
  raidClosed: boolean;
  anchorAtKeyLevel: boolean;
  fvgConfluence: boolean;
  htfNarrative: TradeDirection | "neutral";
  displacementStrength: "none" | "medium" | "strong";
  locationTier: "weekly" | "daily" | "fvg" | "none";
  readyEligible: boolean;
};

const NY_HOUR_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });

function nyHour(time: number): number {
  return Number(NY_HOUR_FORMAT.format(time)) % 24;
}

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
  const candles = spec.confirmTf === "15m"
    ? (context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5)
    : spec.confirmTf === "1h"
      ? context.timeframes.h1
      : context.timeframes.h4;
  return completedCandles(candles);
}

function liveConfirmCandlesFor(context: MarketContext, spec: AnchorSpec): Candle[] {
  if (spec.confirmTf === "15m") return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  if (spec.confirmTf === "1h") return context.timeframes.h1;
  return context.timeframes.h4;
}

function rangeFromCandle(candle: Candle, spec: AnchorSpec): DealingRange {
  return { high: candle.high, low: candle.low, midpoint: (candle.high + candle.low) / 2, source: `CRT ${spec.rangeTf} range: previous closed candle` };
}

function rangeFromFvgOrigin(candle: Candle, spec: AnchorSpec, gap: FairValueGap): DealingRange {
  return {
    high: candle.high,
    low: candle.low,
    midpoint: (candle.high + candle.low) / 2,
    source: `CRT ${spec.rangeTf} FVG origin candle: ${gap.direction.toUpperCase()} FVG tap`
  };
}

function rangeFromActiveCrt(candle: Candle, spec: AnchorSpec, label: string): DealingRange {
  return {
    high: candle.high,
    low: candle.low,
    midpoint: (candle.high + candle.low) / 2,
    source: `${label}: ${spec.rangeTf} candle high/low aktif CRT range`
  };
}

function crtBiasAtIndex(candles: Candle[], index: number, spec: AnchorSpec): CrtBiasContext | undefined {
  if (index < 1 || index >= candles.length) return undefined;
  const timeframe = spec.rangeTf === "4h" ? "4h" : spec.rangeTf === "1d" ? "1d" : "1w";
  return buildCrtBias([candles[index - 1], candles[index]], timeframe);
}

function raidFromPair(range: DealingRange, raidCandle: Candle, closed: boolean, lastClose: number): AnchorRaid | undefined {
  const shortSwept = raidCandle.high > range.high;
  const longSwept = raidCandle.low < range.low;
  const shortReclaimedNow = lastClose < range.high;
  const longReclaimedNow = lastClose > range.low;
  const shortCloseBack = closed && raidCandle.close < range.high;
  const longCloseBack = closed && raidCandle.close > range.low;
  // The mitigation/reclaim candle does not have to close back inside the CRT range. Touching
  // the external liquidity and then trading back inside is enough for a live read; close-back
  // is tracked as a quality bonus through AnchorRaid.closed.
  const shortRaid = shortSwept && shortReclaimedNow;
  const longRaid = longSwept && longReclaimedNow;
  if (shortRaid && longRaid) {
    // A forming candle that swept both sides is chaos, not a raid; a closed one tie-breaks
    // by the larger excess.
    if (!closed) return undefined;
    const upExcess = raidCandle.high - range.high;
    const downExcess = range.low - raidCandle.low;
    return upExcess >= downExcess
      ? { direction: "short", level: raidCandle.high, time: raidCandle.time, closed: shortCloseBack }
      : { direction: "long", level: raidCandle.low, time: raidCandle.time, closed: longCloseBack };
  }
  if (shortRaid) return { direction: "short", level: raidCandle.high, time: raidCandle.time, closed: shortCloseBack };
  if (longRaid) return { direction: "long", level: raidCandle.low, time: raidCandle.time, closed: longCloseBack };
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

// SOP steps 2-4: mark CRT-High/Low, wait for the raid, then require current reclaim to hold.
// A same-candle close-back is preferred; a live touch/mitigation without close-back is valid
// enough to drop to the LTF. In both cases the reclaim must still hold NOW — if price
// trades beyond the swept extreme, that was a breakout and there is nothing to fade.
// An accepted raid does NOT roll away when the next range candle closes: while it is still
// active, a poke at a newer candle's extreme is that raid's distribution leg (or noise), not
// a fresh setup — so scan oldest-first and keep the waiting setup's direction instead of
// flipping it on every new candle.
function detectAnchorRaid(rangeCandles: Candle[], lastClose: number, spec: AnchorSpec): { range: DealingRange; raid?: AnchorRaid } {
  const hasExplicitState = rangeCandles.some((candle) => typeof candle.closed === "boolean");
  const last = rangeCandles.at(-1);
  // Legacy/demo fixtures have no candle-state metadata. Preserve their original contract:
  // the last row is the live candle. Real Yahoo rows carry an explicit closed flag.
  const forming = last?.closed === false ? last : !hasExplicitState ? last : undefined;
  const closed = forming ? completedCandles(rangeCandles.slice(0, -1)) : completedCandles(rangeCandles);
  const n = closed.length;
  for (let rangeIndex = Math.max(0, n - 1 - RAID_PERSISTENCE_LOOKBACK); rangeIndex <= n - 3; rangeIndex += 1) {
    const range = rangeFromCandle(closed[rangeIndex], spec);
    const raid = raidFromPair(range, closed[rangeIndex + 1], true, lastClose);
    if (raid && raidStillActive(closed, rangeIndex + 1, range, raid.direction)) return { range, raid };
  }
  if (n >= 2) {
    const range = rangeFromCandle(closed[n - 2], spec);
    const raid = raidFromPair(range, closed[n - 1], true, lastClose);
    if (raid) return { range, raid };
  }
  if (forming && n >= 1) {
    const range = rangeFromCandle(closed[n - 1], spec);
    const raid = raidFromPair(range, forming, false, lastClose);
    return raid ? { range, raid } : { range };
  }
  return { range: rangeFromCandle(closed[Math.max(0, n - 1)] ?? rangeCandles[rangeCandles.length - 1], spec) };
}

function buildAnchorCtx(context: MarketContext, spec: AnchorSpec): AnchorCtx | undefined {
  const rangeCandles = rangeCandlesFor(context, spec);
  const confirmCandles = confirmCandlesFor(context, spec);
  if (rangeCandles.length < 2 || confirmCandles.length < 20) return undefined;
  const liveConfirmCandles = liveConfirmCandlesFor(context, spec);
  const lastClose = liveConfirmCandles.at(-1)?.close ?? confirmCandles[confirmCandles.length - 1].close;
  const { range, raid } = detectAnchorRaid(rangeCandles, lastClose, spec);
  const swings = detectSwingPoints(confirmCandles, 3);
  const ranges = confirmCandles.slice(-20).map((candle) => candle.high - candle.low);
  return {
    spec,
    rangeCandles,
    confirmCandles,
    liveConfirmCandles,
    range,
    raid,
    swings,
    fvgs: detectFairValueGaps(confirmCandles),
    orderBlocks: detectOrderBlocks(confirmCandles, swings),
    htfFvgs: detectFairValueGaps(rangeCandles),
    atr: averageTrueRange(confirmCandles, 14),
    averageRange: ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1),
    turtleSoup: detectLatestTurtleSoup(confirmCandles, spec.confirmTf)
  };
}

function fvgToPoi(gap: FairValueGap, label = "FVG"): CrtPoi {
  return {
    type: gap.mitigated ? "breaker" : "fvg",
    direction: gap.direction,
    low: gap.low,
    high: gap.high,
    midpoint: gap.midpoint,
    candleIndex: gap.candleIndex,
    mitigated: gap.mitigated,
    label
  };
}

function fvgTapHeld(rangeCandles: Candle[], gap: FairValueGap): number | undefined {
  const start = Math.max(0, gap.candleIndex + 1);
  const latestIndex = rangeCandles.length - 1;
  let latestHeldTap: number | undefined;
  for (let index = start; index < rangeCandles.length; index += 1) {
    if (latestIndex - index > FVG_ORIGIN_MAX_AGE_CANDLES) continue;
    const candle = rangeCandles[index];
    const touched = candle.low <= gap.high && candle.high >= gap.low;
    if (!touched) continue;
    const latestClose = rangeCandles[latestIndex]?.close;
    const held = typeof latestClose === "number" && (gap.direction === "long" ? latestClose > gap.high : latestClose < gap.low);
    if (held) latestHeldTap = index;
  }
  return latestHeldTap;
}

function buildFvgOriginAnchorCtxs(context: MarketContext): AnchorCtx[] {
  const spec: AnchorSpec = { rangeTf: "4h", confirmTf: "15m" };
  const rangeCandles = context.timeframes.h4;
  const confirmCandles = confirmCandlesFor(context, spec);
  const liveConfirmCandles = liveConfirmCandlesFor(context, spec);
  if (rangeCandles.length < 8 || confirmCandles.length < 20) return [];
  const htfFvgs = detectFairValueGaps(rangeCandles);
  const swings = detectSwingPoints(confirmCandles, 3);
  const ranges = confirmCandles.slice(-20).map((candle) => candle.high - candle.low);
  const base = {
    spec,
    rangeCandles,
    confirmCandles,
    liveConfirmCandles,
    swings,
    fvgs: detectFairValueGaps(confirmCandles),
    orderBlocks: detectOrderBlocks(confirmCandles, swings),
    htfFvgs,
    atr: averageTrueRange(confirmCandles, 14),
    averageRange: ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1),
    turtleSoup: detectLatestTurtleSoup(confirmCandles, spec.confirmTf)
  };

  return htfFvgs
    .flatMap((gap): AnchorCtx[] => {
      const tapIndex = fvgTapHeld(rangeCandles, gap);
      const originIndex = Math.min(rangeCandles.length - 1, Math.max(0, gap.candleIndex));
      const originCandle = rangeCandles[originIndex];
      if (tapIndex === undefined || !originCandle) return [];
      return [{
        ...base,
        range: rangeFromFvgOrigin(originCandle, spec, gap),
        origin: { kind: "fvg-origin" as const, direction: gap.direction, fvg: gap, originIndex, tapIndex }
      }];
    })
    .slice(-3);
}

const ACTIVE_CRT_LOOKBACK: Record<AnchorSpec["rangeTf"], number> = {
  "4h": 8,
  "1d": 6,
  "1w": 3
};

function activeCrtStillValid(rangeCandles: Candle[], originIndex: number, direction: TradeDirection, range: DealingRange): boolean {
  const later = rangeCandles.slice(originIndex + 1);
  if (direction === "long") return !later.some((candle) => candle.close < range.low);
  return !later.some((candle) => candle.close > range.high);
}

function activeCrtNotConsumed(rangeCandles: Candle[], originIndex: number, direction: TradeDirection, range: DealingRange): boolean {
  const latestIndex = rangeCandles.length - 1;
  if (originIndex >= latestIndex) return true;
  const later = rangeCandles.slice(originIndex + 1);
  // If the opposite side of that CRT candle already traded, its DOL did its job. The setup
  // is no longer a fresh context alert; wait for a new CRT candle.
  if (direction === "long") return !later.some((candle) => candle.high >= range.high);
  return !later.some((candle) => candle.low <= range.low);
}

function buildActiveCrtAnchorCtxs(context: MarketContext): AnchorCtx[] {
  return ANCHORS.flatMap((spec): AnchorCtx[] => {
    const rangeCandles = rangeCandlesFor(context, spec);
    const confirmCandles = confirmCandlesFor(context, spec);
    const liveConfirmCandles = liveConfirmCandlesFor(context, spec);
    if (rangeCandles.length < 4 || confirmCandles.length < 20) return [];
    const latestIndex = rangeCandles.length - 1;
    const hasExplicitState = rangeCandles.some((candle) => typeof candle.closed === "boolean");
    const lookback = ACTIVE_CRT_LOOKBACK[spec.rangeTf];
    const firstIndex = Math.max(1, latestIndex - lookback);
    const htfFvgs = detectFairValueGaps(rangeCandles);
    const swings = detectSwingPoints(confirmCandles, 3);
    const confirmRanges = confirmCandles.slice(-20).map((candle) => candle.high - candle.low);
    const anchorRanges = rangeCandles.slice(Math.max(0, latestIndex - 20), latestIndex + 1).map((candle) => candle.high - candle.low);
    const anchorAverageRange = anchorRanges.reduce((sum, value) => sum + value, 0) / Math.max(anchorRanges.length, 1);

    const candidates = [];
    for (let originIndex = latestIndex; originIndex >= firstIndex; originIndex -= 1) {
      const candle = rangeCandles[originIndex];
      const bias = crtBiasAtIndex(rangeCandles, originIndex, spec);
      if (!candle || !bias || bias.direction === "neutral") continue;
      const originClosed = candle.closed === true || (!hasExplicitState && originIndex < latestIndex);
      const originLabel = originClosed ? `Active ${spec.rangeTf.toUpperCase()} CRT` : `Forming ${spec.rangeTf.toUpperCase()} CRT`;
      const range = rangeFromActiveCrt(candle, spec, originLabel);
      const rangeHeight = range.high - range.low;
      if (anchorAverageRange > 0 && rangeHeight < anchorAverageRange * 0.45) continue;
      if (!activeCrtStillValid(rangeCandles, originIndex, bias.direction, range)) continue;
      if (!activeCrtNotConsumed(rangeCandles, originIndex, bias.direction, range)) continue;
      candidates.push({
        spec,
        rangeCandles,
        confirmCandles,
        liveConfirmCandles,
        range,
        swings,
        fvgs: detectFairValueGaps(confirmCandles),
        orderBlocks: detectOrderBlocks(confirmCandles, swings),
        htfFvgs,
        atr: averageTrueRange(confirmCandles, 14),
        averageRange: confirmRanges.reduce((sum, value) => sum + value, 0) / Math.max(confirmRanges.length, 1),
        turtleSoup: detectLatestTurtleSoup(confirmCandles, spec.confirmTf),
        origin: {
          kind: "active-crt" as const,
          direction: bias.direction,
          originIndex,
          label: originLabel,
          bias,
          closed: originClosed
        }
      });
    }
    return candidates.slice(0, 1);
  });
}

function symbolBuffer(anchor: AnchorCtx, symbol: MarketSymbol, profile: StrategyInput["settings"]["stopProfile"] = "normal"): number {
  const multiplier = profile === "aggressive" ? 0.85 : profile === "conservative" ? 1.25 : 1;
  return Math.max(anchor.atr * 0.2, anchor.averageRange * 0.15, SYMBOL_MIN_BUFFER[symbol]) * multiplier;
}

function confirmIndexAtTime(candles: Candle[], time: number): number {
  const index = candles.findIndex((candle) => candle.time >= time);
  return index >= 0 ? index : Math.max(0, candles.length - 1);
}

function anchorBias(anchor: AnchorCtx) {
  if (anchor.origin?.kind === "active-crt") return anchor.origin.bias;
  return buildCrtBias(completedCandles(anchor.rangeCandles), anchor.spec.rangeTf === "4h" ? "4h" : anchor.spec.rangeTf === "1d" ? "1d" : "1w");
}

// Direction comes ONLY from the pair's own structure: its anchor-candle bias or raid.
// There is deliberately NO premium/discount fallback — range position is a location filter,
// not a direction source. Guessing "premium -> short" painted every correlated pair the
// same side on dollar days: the whole board read SHORT with no pair-specific setup behind it.
function directionForAnchor(_context: MarketContext, anchor: AnchorCtx): { direction: TradeDirection; source: CrtSetup["directionSource"] } | undefined {
  if (anchor.origin?.kind === "fvg-origin") return { direction: anchor.origin.direction, source: "fvg-crt" };
  if (anchor.origin?.kind === "active-crt") return { direction: anchor.origin.direction, source: "active-crt" };
  if (anchor.raid) return { direction: anchor.raid.direction, source: "raid" };
  const bias = anchorBias(anchor);
  if (bias.direction !== "neutral") return { direction: bias.direction, source: "bias" };
  return undefined;
}

function manipulationForAnchor(anchor: AnchorCtx, direction: TradeDirection): CrtSetup["manipulation"] {
  if (anchor.origin?.kind === "fvg-origin" && anchor.origin.direction === direction) {
    const origin = anchor.origin;
    const tapCandle = anchor.rangeCandles[origin.tapIndex];
    const nextRangeCandle = anchor.rangeCandles[origin.tapIndex + 1];
    const tapWindowEnd = nextRangeCandle?.time ?? (tapCandle?.time ?? 0) + 4 * 60 * 60 * 1000;
    const tapConfirmIndex = anchor.confirmCandles.findIndex((candle) =>
      candle.time >= (tapCandle?.time ?? 0)
      && candle.time < tapWindowEnd
      && candle.low <= origin.fvg.high
      && candle.high >= origin.fvg.low
    );
    if (tapConfirmIndex < 0) return undefined;
    return {
      side: expectedSweepSide(direction),
      level: direction === "long" ? origin.fvg.low : origin.fvg.high,
      candleIndex: tapConfirmIndex,
      reclaimed: true
    };
  }
  if (anchor.origin?.kind === "active-crt" && anchor.origin.direction === direction && anchor.origin.bias.kind.includes("reversal")) {
    const originCandle = anchor.rangeCandles[anchor.origin.originIndex];
    return {
      side: expectedSweepSide(direction),
      level: direction === "long" ? originCandle.low : originCandle.high,
      candleIndex: confirmIndexAtTime(anchor.confirmCandles, originCandle.time),
      reclaimed: true
    };
  }
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

export type CrtChochRead = {
  reference?: { level: number; candleIndex: number };
  confirmation?: { level: number; candleIndex: number; referenceCandleIndex: number; bodyRatio: number; rangeAtr: number };
};

export function detectCrtChoch(input: {
  candles: Candle[];
  swings: SwingPoint[];
  range: DealingRange;
  direction: TradeDirection;
  manipulationIndex: number;
  buffer: number;
  averageRange: number;
}): CrtChochRead {
  const { candles, swings, range, direction, manipulationIndex, buffer, averageRange } = input;
  const swingSide = direction === "short" ? "low" : "high";
  const swing = [...swings]
    .filter((point) => point.side === swingSide)
    // A pivot is only knowable after its right wing closes. This prevents replay from using a
    // swing that was discovered after the alleged break.
    .filter((point) => point.candleIndex + CHOCH_SWING_WING <= manipulationIndex)
    .filter((point) => point.candleIndex >= manipulationIndex - CHOCH_REFERENCE_LOOKBACK)
    .filter((point) => point.level <= range.high + buffer && point.level >= range.low - buffer)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  if (!swing) return {};

  const reference = { level: swing.level, candleIndex: swing.candleIndex };
  const minimumCloseThrough = Math.max(buffer * 0.1, averageRange * 0.03);
  const firstBreakIndex = Math.max(manipulationIndex + 1, swing.candleIndex + CHOCH_SWING_WING + 1);
  for (let index = firstBreakIndex; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.closed === false) continue;
    const directionalBody = direction === "short" ? candle.close < candle.open : candle.close > candle.open;
    const closeThrough = direction === "short" ? swing.level - candle.close : candle.close - swing.level;
    const candleRange = Math.max(candle.high - candle.low, 0.000001);
    const bodyRatio = Math.abs(candle.close - candle.open) / candleRange;
    const rangeAtr = candleRange / Math.max(averageRange, 0.000001);
    if (!directionalBody || closeThrough < minimumCloseThrough || bodyRatio < 0.5 || rangeAtr < 0.8) continue;
    if (index < candles.length - CHOCH_FRESHNESS_CANDLES) continue;
    return {
      reference,
      confirmation: {
        level: swing.level,
        candleIndex: index,
        referenceCandleIndex: swing.candleIndex,
        bodyRatio,
        rangeAtr
      }
    };
  }
  return { reference };
}

function chochForAnchor(anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"], buffer: number): CrtChochRead {
  const manipulationIndex = manipulation?.candleIndex ?? Math.max(0, anchor.confirmCandles.length - CHOCH_FRESHNESS_CANDLES);
  return detectCrtChoch({
    candles: anchor.confirmCandles,
    swings: anchor.swings,
    range: anchor.range,
    direction,
    manipulationIndex,
    buffer,
    averageRange: anchor.averageRange
  });
}

function poiForAnchor(anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"], choch: CrtSetup["choch"]): CrtPoi | undefined {
  // SOP step 7: the entry POI is the FVG/OB the raid's reversal leg leaves behind — an old
  // zone from prior structure is a different trade, and a synthetic OTE is not a POI at all.
  if (!manipulation) return undefined;
  if (anchor.origin?.kind === "fvg-origin" && anchor.origin.direction === direction) {
    return fvgToPoi(anchor.origin.fvg, "4H FVG tap / origin CRT");
  }
  const candles = anchor.confirmCandles;
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
    .filter((poi) => !choch || (poi.candleIndex ?? 0) <= choch.candleIndex + 2)
    .filter((poi) => poi.midpoint <= range.high && poi.midpoint >= range.low)
    .sort((a, b) => priority[a.type] - priority[b.type] || (b.candleIndex ?? 0) - (a.candleIndex ?? 0))[0];
}

export function findCrtEntryRetestIndex(candles: Candle[], entry: number, afterIndex: number): number | undefined {
  const index = candles.findIndex((candle, candleIndex) => candleIndex > afterIndex && candle.low <= entry && candle.high >= entry);
  return index >= 0 ? index : undefined;
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

function entryLevelForAnchor(anchor: AnchorCtx, direction: TradeDirection, choch: CrtSetup["choch"], poi: CrtPoi | undefined): number {
  const latest = anchor.confirmCandles[anchor.confirmCandles.length - 1];
  const insideRange = (level: number) => level <= anchor.range.high && level >= anchor.range.low;
  if (!choch) return poi?.midpoint ?? latest.close;
  return poi && insideRange(poi.midpoint) && (direction === "short" ? poi.midpoint > choch.level : poi.midpoint < choch.level)
    ? poi.midpoint
    : choch.level;
}

function buildAnchorPlan(context: MarketContext, anchor: AnchorCtx, direction: TradeDirection, turtleSoup: TurtleSoupPattern | undefined, manipulation: CrtSetup["manipulation"], choch: CrtSetup["choch"], poi: CrtPoi | undefined, retestIndex: number | undefined, minimumRR: number, buffer: number, stress: ExecutionCostStress): TradePlan {
  const candles = anchor.confirmCandles;
  // Entry is the actual post-ChoCH retest level, never the displaced break close.
  const entry = entryLevelForAnchor(anchor, direction, choch, poi);
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
  // CRT management is deterministic: TP1 is the anchor range equilibrium (0.5), never a
  // synthetic "POC" inferred from candle touches.
  const tp1 = anchor.range.midpoint;
  const realTarget = targetDol(anchor, direction, entry);
  const tp2 = realTarget ?? tp1;
  const costs = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp2, stress });
  const entryRetested = Boolean(choch) && typeof retestIndex === "number";
  const entryStatus = entryRetested ? "confirmed" : choch || poi ? "pending" : "fallback";
  const entrySource = poi ? "poi-retest" : choch ? "choch-close" : "fallback-close";
  const planWarnings = [
    ...(turtleSoup ? [
      `${anchor.spec.confirmTf} Turtle Soup var: manipulation kanıtı olarak okunur, tek başına entry değildir.`,
      `TS %50 filtresi geçti; entry yine POI/retest + ChoCH/Just kapanışıyla verilir.`
    ] : [`Turtle Soup yok; bu sadece kalite artısı, ana karar ChoCH/POI kapanışıyla verilir.`]),
    `CRT ${anchor.spec.rangeTf} range ${formatPrice(anchor.range.low)}-${formatPrice(anchor.range.high)}; confirmation ${anchor.spec.confirmTf}.`,
    `TP1/EQ yönetim seviyesi ${formatPrice(tp1)}; TP2/DOL ${formatPrice(tp2)}.`,
    `Stop manipulation wick dışına ${formatPrice(buffer)} buffer ile kondu.`,
    ...(costs.netRR < minimumRR ? [`TP2/DOL net RR ${costs.netRR.toFixed(2)}, minimum ${minimumRR}. READY değil.`] : []),
    ...(!choch ? [`${anchor.spec.confirmTf} ChoCH/Just mum kapanışı bekleniyor.`] : []),
    ...(choch && !entryRetested ? [`ChoCH onaylı; ${formatPrice(entry)} seviyesine gerçek retest/mitigation teması bekleniyor.`] : [])
  ];

  return {
    entry,
    entrySource,
    entryStatus,
    entryModel: {
      source: entrySource,
      status: entryStatus,
      level: entry,
      retested: entryRetested,
      cisdConfirmed: Boolean(choch),
      fairValueGap: poi?.type === "fvg" || poi?.type === "breaker"
        ? { direction: poi.direction, low: poi.low, high: poi.high, midpoint: poi.midpoint, candleIndex: poi.candleIndex ?? 0, mitigated: poi.mitigated }
        : undefined,
      warnings: entryStatus === "confirmed"
        ? []
        : !choch
          ? [`${anchor.spec.confirmTf} ChoCH/Just kapanışı bekleniyor.`]
          : [`ChoCH sonrası ${formatPrice(entry)} retest teması bekleniyor.`]
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

// STEP 8: after the raid, price must reprice aggressively. Scans every confirmation candle
// since the manipulation (not just a trailing window) so a valid displacement cannot age out
// while the ChoCH is still fresh.
function displacementSince(anchor: AnchorCtx, direction: TradeDirection, fromIndex: number): "none" | "medium" | "strong" {
  const candles = anchor.confirmCandles;
  let best: "none" | "medium" | "strong" = "none";
  for (let index = Math.max(1, fromIndex); index < candles.length; index += 1) {
    const candle = candles[index];
    if ((direction === "long") !== (candle.close > candle.open)) continue;
    const range = Math.max(candle.high - candle.low, 0.000001);
    const bodyRatio = Math.abs(candle.close - candle.open) / range;
    const rangeAtr = range / Math.max(anchor.averageRange, 0.000001);
    if (bodyRatio >= 0.58 && rangeAtr >= 1.05) {
      if (rangeAtr >= 1.6 && bodyRatio >= 0.7) return "strong";
      best = "medium";
    }
  }
  return best;
}

function buildAnchorSetup(context: MarketContext, settings: StrategyInput["settings"], anchor: AnchorCtx): CrtSetup | undefined {
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const picked = directionForAnchor(context, anchor);
  if (!picked) return undefined;
  const { direction, source: directionSource } = picked;
  const buffer = symbolBuffer(anchor, context.symbol, settings.stopProfile);
  const turtleSoup = anchor.turtleSoup?.direction === direction ? anchor.turtleSoup : undefined;
  const manipulation: CrtSetup["manipulation"] = turtleSoup
    ? { side: expectedSweepSide(direction), level: turtleSoup.sweepLevel, candleIndex: turtleSoup.turtleCandleIndex, reclaimed: true }
    : manipulationForAnchor(anchor, direction);
  const chochRead = chochForAnchor(anchor, direction, manipulation, buffer);
  const choch = chochRead.confirmation;
  const poi = poiForAnchor(anchor, direction, manipulation, choch);
  const plannedEntry = entryLevelForAnchor(anchor, direction, choch, poi);
  const retestKnownIndex = choch ? Math.max(choch.candleIndex, poi?.candleIndex ?? choch.candleIndex) : undefined;
  const retestIndex = typeof retestKnownIndex === "number"
    ? findCrtEntryRetestIndex(anchor.liveConfirmCandles, plannedEntry, retestKnownIndex)
    : undefined;
  const plan = buildAnchorPlan(context, anchor, direction, turtleSoup, manipulation, choch, poi, retestIndex, minimumRR, buffer, executionCostStress(settings));
  const bias = anchorBias(anchor);
  const biasConflict = directionSource === "raid" && bias.direction !== "neutral" && bias.direction !== direction;
  const continuationAgainst = (bias.kind === "bullish-continuation" && direction === "short")
    || (bias.kind === "bearish-continuation" && direction === "long");
  const lastClose = anchor.confirmCandles[anchor.confirmCandles.length - 1].close;
  const reclaimLevel = turtleSoup?.reclaimLevel ?? (direction === "short" ? anchor.range.high : anchor.range.low);
  const reclaimHolds = direction === "short" ? lastClose < reclaimLevel : lastClose > reclaimLevel;
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
  // STEP 1: HTF narrative (M/W/D/4H) gives direction weight. A direct opposite narrative
  // vetoes READY, while a mixed narrative is a quality warning, not a hard rejection.
  const votes = [context.bias.monthly, context.bias.weekly, context.bias.daily, context.bias.h4];
  const bullishVotes = votes.filter((vote) => vote === "bullish").length;
  const bearishVotes = votes.filter((vote) => vote === "bearish").length;
  const htfNarrative: TradeDirection | "neutral" = bullishVotes - bearishVotes >= 2 ? "long" : bearishVotes - bullishVotes >= 2 ? "short" : "neutral";
  // STEP 2: premium/discount discipline. The CRT setup's OWN range PD (pdAligned, below) is the
  // hard gate — that is the range this setup actually trades. The GLOBAL dealing-range PD is a
  // separate, broader structure; when it disagrees it is a size-down note, not a second veto.
  // (HTF narrative already carries broad-context alignment, so vetoing on dealing-range PD too
  // was a third overlapping gate that killed textbook CRT setups sitting correctly in their own
  // range.) Kept as a quality warning only.
  const dealingPdConflict = direction === "long"
    ? context.premiumDiscount.zone === "premium"
    : context.premiumDiscount.zone === "discount";
  const pullback = validCrtPullback(anchor.rangeCandles, direction);
  const raidClosed = Boolean(anchor.raid && anchor.raid.direction === direction && anchor.raid.closed);
  const originReference = anchor.origin?.kind === "fvg-origin"
    ? anchor.origin.fvg.midpoint
    : anchor.origin?.kind === "active-crt"
    ? (direction === "short" ? anchor.range.high : anchor.range.low)
    : undefined;
  const sweptExtreme = turtleSoup?.sweepLevel ?? originReference ?? (direction === "short" ? anchor.range.high : anchor.range.low);
  // STEP 3+6: liquidity/location ranking — weekly/monthly beats daily beats HTF-FVG.
  const nearSwept = (level: number) => Math.abs(level - sweptExtreme) <= buffer * 3;
  const weeklyLocation = context.liquidityObjectives.some((objective) => (objective.kind === "PWH" || objective.kind === "PWL" || objective.kind === "PMH" || objective.kind === "PML") && nearSwept(objective.level));
  const dailyLocation = context.liquidityObjectives.some((objective) => (objective.kind === "PDH" || objective.kind === "PDL" || objective.kind === "DRH" || objective.kind === "DRL") && nearSwept(objective.level));
  const fvgConfluence = anchor.htfFvgs.some((gap) => sweptExtreme >= gap.low - buffer && sweptExtreme <= gap.high + buffer);
  const locationTier: CrtSetup["locationTier"] = weeklyLocation ? "weekly" : dailyLocation ? "daily" : fvgConfluence ? "fvg" : "none";
  const anchorAtKeyLevel = weeklyLocation || dailyLocation;
  // STEP 7: the range must be respected — closes since the raid stay inside it.
  const sinceRaid = turtleSoup
    ? anchor.confirmCandles.slice(turtleSoup.turtleCandleIndex)
    : anchor.raid ? anchor.confirmCandles.filter((candle) => candle.time > (anchor.raid as AnchorRaid).time) : [];
  const respectHigh = turtleSoup?.rangeHigh ?? anchor.range.high;
  const respectLow = turtleSoup?.rangeLow ?? anchor.range.low;
  const rangeRespect = sinceRaid.length > 0 && sinceRaid.every((candle) => candle.close <= respectHigh + buffer && candle.close >= respectLow - buffer);
  // STEP 8: displacement after the raid is mandatory.
  const displacementStrength = manipulation ? displacementSince(anchor, direction, manipulation.candleIndex) : "none";
  // #4 Session-timed raid: manipulation landing inside a killzone carries the session-sweep
  // narrative (Asia raided by London, London raided by NY) — applied to every anchor.
  const raidKillzone = anchor.raid ? buildKillzoneContext(anchor.raid.time).find((zone) => zone.active && zone.name !== "Outside")?.name : undefined;
  const sessionTimedRaid = Boolean(raidKillzone);
  // The 01/05/09 NY opens remain the 4H doctrine's key candles (extra weight on top).
  const keyOpenRaid = anchor.spec.rangeTf === "4h" && Boolean(anchor.raid) && [1, 5, 9].includes(nyHour(anchor.raid?.time ?? 0));

  const blockers = [
    // Turtle Soup is optional manipulation evidence, not an entry model. READY must come from
    // the actual sequence: raid/manipulation -> POI/retest -> ChoCH/Just -> DOL plan.
    anchor.origin?.kind === "active-crt" && !anchor.origin.closed ? `${anchor.spec.rangeTf.toUpperCase()} CRT origin mumu henüz kapanmadı; gelişen bağlam READY olamaz.` : undefined,
    !pdAligned ? `${direction.toUpperCase()} için CRT range ${expectedPd(direction)} gerekir; şu an ${crtZone}.` : undefined,
    !poi && !choch ? "Entry referansı yok: raid displacement'ı FVG/OB bırakmadı ve ChoCH kapanışı yok." : undefined,
    !anchorAtKeyLevel && !fvgConfluence ? "Raid/entry HTF haritada bir POI'ye denk gelmiyor (key level / HTF FVG yok)." : undefined,
    !manipulation ? "Manipulation raid/sweep + reclaim yok." : undefined,
    continuationAgainst ? "HTF continuation kapanışı ters yönde; range close ile kırılmış, bu range'den reversal alınmaz." : undefined,
    !reclaimHolds ? "Fiyat hâlâ range extreminin ötesinde; reclaim tutmuyor, bu manipulation değil breakout." : undefined,
    !choch ? `${anchor.spec.confirmTf} ChoCH/Just mum kapanışı yok.` : undefined,
    choch && typeof retestIndex !== "number" ? `ChoCH var ama ${formatPrice(plannedEntry)} entry seviyesine sonraki retest henüz gelmedi.` : undefined,
    !hasRealTarget ? "Gerçek distribution/DOL hedefi yok; entry range'in ötesine taşmış." : undefined,
    rangeTooSmall ? `CRT range mumu ortalama ${anchor.spec.rangeTf} range'in altında; küçük range gürültüdür, trade edilmez.` : undefined,
    stopInNoise ? `Stop mesafesi ${anchor.spec.confirmTf} gürültü bandının içinde; RR görünüşte iyi ama stop korunmasız.` : undefined,
    manipulation && displacementStrength === "none" ? `Displacement yok; raid sonrası ${anchor.spec.confirmTf} agresif repricing gelmedi.` : undefined,
    !tp1Valid ? "Entry range EQ seviyesini geçmiş; TP1 hedefi girişin gerisinde, kovalama riski." : undefined,
    !stopValid ? "Stop entry'nin yanlış tarafında; plan geometrisi bozuk, trade edilemez." : undefined,
    retestFar ? "Retest uzak; fiyat entry alanını terk etmiş, kovalanmaz — yeni raid bekle." : undefined,
    // News-expansion (real spike) still vetoes; plain chop is a quality note, not a veto —
    // CRT manipulation forms inside accumulation. eqTooClose is a management note, not a kill.
    context.regime.type === "news-expansion" ? `Haber/spike expansion rejimi: ${context.regime.summary}` : undefined,
    settings.avoidNews === true && context.eventRisk.noTrade ? `Haber filtresi açık: ${context.eventRisk.summary}` : undefined,
    context.regime.type === "trend" && biasConflict ? "Trend rejiminde counter-bias reversal alınmaz; sweep devam hareketine dönüşür." : undefined,
    plan.rr < minimumRR ? `TP2/DOL RR minimumun altında (${plan.rr.toFixed(2)} < ${minimumRR}).` : undefined,
    context.dataConfidence.score < 35 ? context.dataConfidence.summary : undefined
  ].filter((item): item is string => Boolean(item));
  const warnings = [
    turtleSoup ? turtleSoup.summary : undefined,
    choch && !poi ? "Displacement POI yok; entry ChoCH/MSS seviyesinin retest'i." : undefined,
    !pullback.valid ? `${pullback.summary} (hard gate değil, kalite notu.)` : undefined,
    !inSession ? "Killzone dışı; hard gate değil ama killzone içi setup'ın ihtimali daha yüksek." : undefined,
    context.eventRisk.noTrade && settings.avoidNews !== true ? `${context.eventRisk.summary} (haber filtresi kapalı; manuel risk notu.)` : undefined,
    // Note only — a live raid whose reclaim holds is a valid setup basis; the mitigating
    // candle does not have to close inside the range before dropping to the LTF for entry.
    !raidClosed && manipulation ? "Raid mumu henüz kapanmadı; reclaim tutuyor, LTF onayına geçilebilir." : undefined,
    !anchorAtKeyLevel ? "Anchor mum key seviyede değil (PDH/PDL/PWH/PWL uzak); confluence eksik." : undefined,
    !fvgConfluence ? "Raid bölgesi HTF FVG içinde değil; CRT-FVG confluence eksik." : undefined,
    biasConflict ? "HTF bias raid yönünün tersinde; counter-bias reversal, boyutu küçük tut." : undefined,
    dealingPdConflict ? "Global dealing range PD ters (CRT range PD doğru); geniş resimde ters yarıda, boyutu küçük tut." : undefined,
    htfNarrative !== "neutral" && direction !== htfNarrative ? "Üst timeframe çoğunluğu setup yönüne karşı; hard gate değil, düşük risk/ek teyit gerekir." : undefined,
    htfNarrative === "neutral" ? "HTF anlatı belirsiz (M/W/D/4H karışık); setup TF'ine güven ama boyutu küçük tut." : undefined,
    context.regime.type === "chop" ? "Chop/low-energy rejim; fake MSS ve zayıf FVG riski, boyutu küçük tut." : undefined,
    eqTooClose ? `EQ/TP1 mesafesi ${eqDistanceR.toFixed(2)}R (0.5R altı); partial'ı atla, tek hedef DOL/TP2 olsun.` : undefined,
    context.regime.tradeability === "caution" ? context.regime.summary : undefined,
    !smtAligned ? "SMT (correlated pair divergence) yok; en güçlü kurumsal teyit eksik." : undefined,
    !sessionTimedRaid && anchor.raid ? "Raid bir killzone dışında oluştu; session-sweep anlatısı zayıf." : undefined,
    ...plan.planWarnings
  ].filter((item): item is string => Boolean(item));
  // CRT quality rubric: context alone no longer earns a fake high score. Most points come
  // after a real manipulation/POI/ChoCH sequence, so the dashboard can rank ideas without
  // presenting plain HTF bias as a trade.
  const score = Math.max(0, Math.min(100,
    (htfNarrative !== "neutral" && direction === htfNarrative ? 12 : 0)
    + (directionSource === "bias" && bias.direction === direction ? (bias.strength === "strong" ? 22 : 16) : 0)
    + (directionSource === "fvg-crt" ? 20 : 0)
    + (directionSource === "active-crt" ? 16 : 0)
    + (locationTier === "weekly" ? 20 : locationTier === "daily" ? 15 : locationTier === "fvg" ? 10 : 0)
    + (turtleSoup ? 6 : 0)
    + (anchor.raid && anchor.raid.direction === direction ? 15 : manipulation ? 8 : 0)
    + (poi ? 15 : 0)
    + (displacementStrength === "strong" ? 10 : displacementStrength === "medium" ? 6 : 0)
    + (choch ? 15 : 0)
    + (typeof retestIndex === "number" ? 10 : 0)
    + (poi?.type === "fvg" ? 5 : 0)
    + (rangeRespect ? 10 : 0)
    + (inSession ? 3 : 0)
    + (smtAligned ? 8 : 0)
    + (sessionTimedRaid ? 5 : 0)
    + (keyOpenRaid ? 3 : 0)
  ));
  if (score < 70) warnings.push(`CRT kalite skoru ${score}; B altı kalite. Görünür kalsın ama küçük boyut/ek teyit gerekir.`);
  // READY = the setup is logically/geometrically valid AND at least tradable quality. Quality
  // gaps (weak location, no SMT, no session raid, medium displacement, tight EQ) only cost
  // score/grade — they no longer block READY, since scoring them twice (score + veto) is what
  // starved the live system to zero signals. Real invalidators still veto.
  const READY_MIN_SCORE = 60;
  const modelFormed = Boolean(manipulation) && Boolean(choch) && (Boolean(poi) || displacementStrength !== "none");
  const modelReady = modelFormed && typeof retestIndex === "number";
  const readyEligible = plan.entryStatus === "confirmed"
    && plan.rr >= minimumRR
    && score >= READY_MIN_SCORE
    && blockers.length === 0
    && pdAligned
    && Boolean(manipulation) && !continuationAgainst && reclaimHolds
    && hasRealTarget && tp1Valid && stopValid && !retestFar && !stopInNoise
    && modelReady
    // Only a real news/spike expansion blocks READY; plain chop is a quality note.
    && context.regime.type !== "news-expansion"
    && !(context.regime.type === "trend" && biasConflict)
    && context.dataConfidence.score >= 35;
  const setupPhase: CrtSetup["setupPhase"] = readyEligible
    ? "ready"
    : modelFormed
    ? "model"
    : manipulation
    ? "raid"
    : "context";
  // Blockers gate READY; score remains a quality measure and must retain variation so the
  // radar can distinguish a 61-point early idea from an 89-point setup with one hard issue.
  const visibleScore = Math.max(0, score - Math.min(24, blockers.length * 4));
  return {
    direction,
    directionSource,
    setupPhase,
    manipulation,
    chochReference: chochRead.reference,
    choch,
    poi,
    retestIndex,
    turtleSoup,
    plan: { ...plan, planWarnings: Array.from(new Set(warnings)) },
    warnings,
    blockers,
    score: visibleScore,
    raidClosed,
    anchorAtKeyLevel,
    fvgConfluence,
    htfNarrative,
    displacementStrength,
    locationTier,
    readyEligible
  };
}

function gradeFromScore(score: number): QualityGrade {
  // Doctrine tiers: 90+ institutional, 80-89 high probability, 70-79 tradable, below reject.
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
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
    checklistItem(
      "Turtle Soup",
      setup.turtleSoup ? "pass" : "neutral",
      setup.turtleSoup
        ? `${anchor.spec.confirmTf} range #${setup.turtleSoup.rangeCandleIndex} -> TS #${setup.turtleSoup.turtleCandleIndex}; wick/body ${setup.turtleSoup.wickRatio.toFixed(1)}x, %50 filtresi geçti.`
        : "Opsiyonel kalite artısı yok; ChoCH/POI modeliyle devam."
    ),
    checklistItem("Valid Pullback", validCrtPullback(anchor.rangeCandles, direction).valid ? "pass" : "neutral", validCrtPullback(anchor.rangeCandles, direction).summary),
    checklistItem("Premium / Discount", pdAligned ? "pass" : "fail", `${direction.toUpperCase()} için CRT range ${expectedPd(direction)}; entry ${crtZone}.`),
    checklistItem("POI", setup.poi ? "pass" : setup.choch ? "neutral" : "fail", setup.poi ? `Raid sonrası ${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)} map edildi.` : setup.choch ? "POI kutusu yok; entry ChoCH retest seviyesine bağlı." : "Raid sonrası FVG/OB oluşmadı."),
    checklistItem("Manipulation", setup.manipulation ? "pass" : "fail", setup.manipulation ? `${setup.manipulation.side} raid ${formatPrice(setup.manipulation.level)}.` : "Raid/sweep + reclaim bekleniyor."),
    checklistItem("HTF Narrative", setup.htfNarrative !== "neutral" && setup.direction === setup.htfNarrative ? "pass" : setup.htfNarrative === "neutral" ? "neutral" : "fail", setup.htfNarrative === "neutral" ? "M/W/D/4H anlatısı karışık; setup TF'e güven ama boyutu küçük tut." : setup.direction === setup.htfNarrative ? "Setup HTF anlatıyla aynı yönde." : "Setup HTF anlatıya karşı."),
    checklistItem("Location", setup.locationTier === "weekly" ? "pass" : setup.locationTier === "daily" ? "pass" : setup.locationTier === "fvg" ? "neutral" : "fail", `Raid lokasyonu: ${setup.locationTier === "weekly" ? "haftalık/aylık seviye (en güçlü)" : setup.locationTier === "daily" ? "günlük seviye" : setup.locationTier === "fvg" ? "HTF FVG" : "hiçbir yer — ortada"}.`),
    checklistItem("Displacement", setup.displacementStrength === "strong" ? "pass" : setup.displacementStrength === "medium" ? "neutral" : "fail", setup.displacementStrength === "none" ? "Raid sonrası agresif repricing yok." : `Displacement ${setup.displacementStrength}.`),
    checklistItem("Entry Retest", typeof setup.retestIndex === "number" ? "pass" : setup.choch ? "neutral" : "fail", typeof setup.retestIndex === "number" ? `${formatPrice(setup.plan.entry)} seviyesi ChoCH sonrasında gerçekten trade edildi.` : "ChoCH sonrası entry seviyesine dönüş bekleniyor."),
    checklistItem("HTF Raid Close-Back", setup.raidClosed ? "pass" : "neutral", "Raid mumunun kapanışı ekstra teyittir ama şart değil; reclaim tuttuğu sürece canlı raid de geçerli."),
    checklistItem("Key Level Anchor", setup.anchorAtKeyLevel ? "pass" : "neutral", "Anchor mumun swept extremi PDH/PDL/PWH/PWL gibi bir key seviyeye yakın olmalı."),
    checklistItem("HTF FVG Confluence", setup.fvgConfluence ? "pass" : "neutral", "Raid bölgesi bir HTF FVG'ye denk gelirse kalite artar."),
    checklistItem(
      "Key Open (NY 1/5/9)",
      anchor.spec.rangeTf === "4h" && anchor.raid && [1, 5, 9].includes(nyHour(anchor.raid.time)) ? "pass" : "neutral",
      "4H raid'in 01/05/09 NY mumunda gelmesi session-raid anlatısını taşır; hard şart değil."
    ),
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
    setup.turtleSoup ? `Turtle Soup: ${setup.turtleSoup.summary} Bu sadece manipulation kanıtı; entry POI/retest ve ChoCH/Just kapanışıyla verilir.` : `Turtle Soup yok; ChoCH/POI modeliyle devam ediliyor.`,
    setup.poi ? `POI: ${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)}.` : "POI bekleniyor.",
    setup.manipulation ? `Manipulation: ${setup.manipulation.side} raid ${formatPrice(setup.manipulation.level)}${setup.raidClosed ? " (HTF close-back teyitli)" : ""}.` : "Manipulation/raid bekleniyor.",
    setup.choch ? `ChoCH/Just close ${formatPrice(setup.choch.level)} kırdı; body ${(setup.choch.bodyRatio * 100).toFixed(0)}%, range ${setup.choch.rangeAtr.toFixed(2)}x.` : `${anchor.spec.confirmTf} ChoCH/Just kapanışı bekleniyor.`,
    typeof setup.retestIndex === "number" ? `Entry retest ${formatPrice(setup.plan.entry)} seviyesinde görüldü.` : "ChoCH sonrası entry retest bekleniyor.",
    `Entry ${formatPrice(setup.plan.entry)}, SL ${formatPrice(setup.plan.stopLoss)}, EQ/TP1 ${formatPrice(setup.plan.targets[0])}, DOL/TP2 ${formatPrice(setup.plan.targets[1])}.`,
    `Grade ${grade}, net RR ${formatR(setup.plan.rr)}.`,
    ...riskWarnings
  ].join(" ");
  return {
    shortSummary: `${context.symbol} ${setup.direction.toUpperCase()} CRT ${anchor.spec.rangeTf} ${setup.setupPhase} · RR ${formatR(setup.plan.rr)}.`,
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
    summary: setup.blockers[0] ?? (setup.setupPhase === "ready"
      ? "CRT model tamam: manipulation, POI/ChoCH ve DOL planı okunabilir."
      : setup.setupPhase === "model"
      ? "Model oluşuyor: entry/retest, RR veya kalite filtresi bekleniyor."
      : setup.setupPhase === "raid"
      ? "Raid var: POI ve ChoCH/Just kapanışı bekleniyor."
      : "Sadece CRT bağlamı var: raid/manipulation gelmeden trade yok.")
  };
}

function m15StartIndex(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): number {
  const m15 = context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  const startTime = typeof setup.choch?.candleIndex === "number"
    ? anchor.confirmCandles[setup.choch.candleIndex]?.time
    : typeof setup.manipulation?.candleIndex === "number"
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
  // A hypothetical (unconfirmed) entry cannot be "stopped": no order ever existed. Neutralize
  // the outcome so no UI layer resurrects a false "STOP OLDU" verdict from it.
  const safeOutcome: SignalOutcome = setup.plan.entryStatus !== "confirmed" && outcome.status === "stopped"
    ? { ...outcome, status: "not-triggered", summary: "Onaylı entry yoktu; hipotetik retest seviyesi stop bölgesini gördü. Bu bir trade sonucu değil, setup oluşum aşamasında." }
    : outcome;
  // But "the trade already played out" is real for any concrete entry level (confirmed OR
  // pending POI): if price consumed the level and ran to the targets, the setup is gone —
  // advertising a limit at last month's liquidity grab is chasing in reverse.
  const contextOnlyBiasWatch = (setup.directionSource === "bias" || setup.directionSource === "fvg-crt") && !readyCandidate;
  if (!contextOnlyBiasWatch && setup.plan.entryStatus !== "fallback"
    && (safeOutcome.status === "tp1" || safeOutcome.status === "tp2" || (safeOutcome.status === "missed" && safeOutcome.entryTouched))) {
    return { stage: "missed", outcome: safeOutcome, actionWindow: buildActionWindow(context, setup.plan, safeOutcome, "missed") };
  }
  // Fresh-entry window scales with the confirmation timeframe (m15 base of 16 bars, like the
  // fill timeout). A READY signal whose window has expired is not READY — it is missed;
  // "Plan hazır" and "süresi doldu" must never appear together.
  const windowCandles = 16 * (anchor.spec.confirmTf === "4h" ? 16 : anchor.spec.confirmTf === "1h" ? 4 : 1);
  const stage = readyCandidate ? "ready" : "watch";
  const actionWindow = buildActionWindow(context, setup.plan, safeOutcome, stage, windowCandles);
  if (stage === "ready" && actionWindow.status === "expired") {
    return { stage: "missed", outcome: safeOutcome, actionWindow: buildActionWindow(context, setup.plan, safeOutcome, "missed", windowCandles) };
  }
  return { stage, outcome: safeOutcome, actionWindow };
}

function evidenceFor(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): SignalEvidenceItem[] {
  const bias = anchorBias(anchor);
  return [
    { id: "crt-bias", label: "CRT Bias / DOL", status: bias.direction === setup.direction ? "pass" : "fail", detail: bias.summary, timeframe: anchor.spec.rangeTf, price: bias.drawLevel },
    { id: "crt-range", label: `${anchor.spec.rangeTf.toUpperCase()} Candle Range`, status: "pass", detail: anchor.range.source, timeframe: anchor.spec.rangeTf, price: anchor.range.midpoint },
    {
      id: "turtle-soup",
      label: "Turtle Soup",
      status: setup.turtleSoup ? "pass" : "neutral",
      detail: setup.turtleSoup ? setup.turtleSoup.summary : "Opsiyonel 3 mum TS modeli yok; ChoCH/POI modeli devam eder.",
      timeframe: anchor.spec.confirmTf,
      candleIndex: setup.turtleSoup?.turtleCandleIndex,
      time: typeof setup.turtleSoup?.turtleCandleIndex === "number" ? anchor.confirmCandles[setup.turtleSoup.turtleCandleIndex]?.time : undefined,
      price: setup.turtleSoup?.sweepLevel,
      metadata: setup.turtleSoup ? {
        rangeCandleIndex: setup.turtleSoup.rangeCandleIndex,
        turtleCandleIndex: setup.turtleSoup.turtleCandleIndex,
        rangeHigh: setup.turtleSoup.rangeHigh,
        rangeLow: setup.turtleSoup.rangeLow,
        rangeMidpoint: setup.turtleSoup.rangeMidpoint,
        sweepLevel: setup.turtleSoup.sweepLevel,
        reclaimLevel: setup.turtleSoup.reclaimLevel,
        wickRatio: setup.turtleSoup.wickRatio
      } : undefined
    },
    { id: "valid-pullback", label: "Valid Pullback", status: validCrtPullback(anchor.rangeCandles, setup.direction).valid ? "pass" : "neutral", detail: validCrtPullback(anchor.rangeCandles, setup.direction).summary, timeframe: anchor.spec.rangeTf },
    { id: "poi", label: "POI", status: setup.poi ? "pass" : "fail", detail: setup.poi ? `${setup.poi.label} map edildi; bu tek başına retest değildir.` : "Raid sonrası FVG/OB/Breaker bekleniyor.", timeframe: anchor.spec.confirmTf, candleIndex: setup.poi?.candleIndex, price: setup.poi?.midpoint },
    { id: "manipulation", label: "Manipulation", status: setup.manipulation ? "pass" : "fail", detail: setup.manipulation ? `${setup.manipulation.side} raid + reclaim${setup.raidClosed ? " (closed)" : ""}.` : "Raid/sweep + reclaim yok.", timeframe: anchor.spec.confirmTf, candleIndex: setup.manipulation?.candleIndex, price: setup.manipulation?.level },
    {
      id: "choch",
      label: "ChoCH / Just",
      status: setup.choch ? "pass" : "fail",
      detail: setup.choch
        ? `Kapalı displacement mum ${formatPrice(setup.choch.level)} internal swing seviyesini kırdı (${(setup.choch.bodyRatio * 100).toFixed(0)}% body, ${setup.choch.rangeAtr.toFixed(2)}x range).`
        : setup.chochReference
          ? `${formatPrice(setup.chochReference.level)} internal swing seviyesinde güçlü kapanış bekleniyor.`
          : "Raid öncesinde doğrulanmış internal swing bulunamadı.",
      timeframe: anchor.spec.confirmTf,
      candleIndex: setup.choch?.candleIndex ?? setup.chochReference?.candleIndex,
      time: anchor.confirmCandles[setup.choch?.candleIndex ?? setup.chochReference?.candleIndex ?? -1]?.time,
      price: setup.choch?.level ?? setup.chochReference?.level,
      metadata: {
        referenceCandleIndex: setup.choch?.referenceCandleIndex ?? setup.chochReference?.candleIndex,
        confirmationCandleIndex: setup.choch?.candleIndex,
        bodyRatio: setup.choch?.bodyRatio,
        rangeAtr: setup.choch?.rangeAtr
      }
    },
    { id: "entry-retest", label: "Entry Retest", status: typeof setup.retestIndex === "number" ? "pass" : setup.choch ? "neutral" : "fail", detail: typeof setup.retestIndex === "number" ? `ChoCH sonrası ${formatPrice(setup.plan.entry)} entry seviyesi trade edildi.` : "POI'nin oluşması retest değildir; ChoCH sonrası ayrı temas bekleniyor.", timeframe: anchor.spec.confirmTf, candleIndex: setup.retestIndex, time: typeof setup.retestIndex === "number" ? anchor.liveConfirmCandles[setup.retestIndex]?.time : undefined, price: setup.plan.entry },
    { id: "eq-management", label: "EQ / TP1", status: "neutral", detail: `0.5 range management: ${formatPrice(setup.plan.targets[0])}.`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[0] },
    { id: "dol-target", label: "DOL / TP2", status: setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning", detail: `Final DOL target ${formatPrice(setup.plan.targets[1])}, RR ${formatR(setup.plan.rr)}.`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[1] }
  ];
}

function signalFromAnchor(context: MarketContext, settings: StrategyInput["settings"], anchor: AnchorCtx): TradingSignal | undefined {
  const setup = buildAnchorSetup(context, settings, anchor);
  // Every anchor timeframe (4h/1d/1w) that produces a direction is surfaced — a directional
  // bias with a defined range is a live "raid bekleniyor" read, not noise. directionForAnchor
  // already returns undefined when no raid and no directional bias exist, so a pair with no
  // read on a timeframe simply yields nothing there.
  if (!setup) return undefined;
  // Do not hide weak-location CRT reads. They are not READY, but they are still useful
  // heads-up context: "daily/weekly CRT is active, wait for LTF confirmation or ignore if
  // key level is missing." Hiding them is why valid-looking Daily CRT ideas never appeared.
  const readyCandidate = setup.readyEligible;
  const life = lifecycle(context, anchor, setup, readyCandidate);
  const grade = gradeFromScore(setup.score);
  const position = calculatePositionSize({
    account: defaultAccountModel,
    symbol: context.symbol,
    entry: setup.plan.entry,
    stopLoss: setup.plan.stopLoss,
    target: setup.plan.targets[1] ?? setup.plan.targets[0],
    grade
  });
  return {
    id: `${context.symbol}-${setup.direction}-${anchor.confirmCandles.at(-1)?.time ?? Date.now()}-crt-${anchor.spec.rangeTf}${anchor.origin ? `-${anchor.origin.kind}-${anchor.origin.originIndex}` : ""}`,
    strategyId: CRT_STRATEGY_ID,
    symbol: context.symbol,
    direction: setup.direction,
    stage: life.stage,
    grade,
    score: setup.score,
    createdAt: Date.now(),
    timeframe: anchor.spec.confirmTf,
    plan: setup.plan,
    context,
    decisionSummary: crtDecisionSummary(context, anchor, setup, grade, position.warnings),
    evidence: evidenceFor(context, anchor, setup),
    riskWarnings: position.warnings,
    outcome: life.outcome,
    governance: governanceFor(context, anchor, setup),
    actionWindow: life.actionWindow,
    crtAnchor: {
      rangeTf: anchor.spec.rangeTf,
      confirmTf: anchor.spec.confirmTf,
      raidActive: Boolean(anchor.raid && anchor.raid.direction === setup.direction),
      raidClosed: setup.raidClosed,
      rangeHigh: anchor.range.high,
      rangeLow: anchor.range.low,
      origin: anchor.origin?.kind ?? "standard",
      originLabel: anchor.origin?.kind === "fvg-origin" ? "4H FVG origin CRT" : anchor.origin?.kind === "active-crt" ? anchor.origin.label : undefined,
      originClosed: anchor.origin?.kind === "active-crt" ? anchor.origin.closed : true,
      setupPhase: setup.setupPhase
    }
  };
}

function anchorSignal(context: MarketContext, settings: StrategyInput["settings"], spec: AnchorSpec): TradingSignal | undefined {
  const anchor = buildAnchorCtx(context, spec);
  return anchor ? signalFromAnchor(context, settings, anchor) : undefined;
}

const STAGE_RANK: Record<string, number> = { ready: 0, watch: 1, missed: 2, invalidated: 3 };

function signalPriority(signal: TradingSignal): number {
  if (signal.crtAnchor?.raidActive) return 0;
  if (signal.crtAnchor?.origin === "standard") return 1;
  if (signal.crtAnchor?.origin === "fvg-origin") return 2;
  if (signal.crtAnchor?.origin === "active-crt") return 3;
  return 1;
}

const RANGE_TF_RANK: Record<string, number> = { "4h": 0, "1d": 1, "1w": 2 };

function signalsFromContext(context: MarketContext, settings: StrategyInput["settings"]): TradingSignal[] {
  const signals = [
    ...ANCHORS.map((spec) => anchorSignal(context, settings, spec)),
    ...buildActiveCrtAnchorCtxs(context).map((anchor) => signalFromAnchor(context, settings, anchor)),
    ...buildFvgOriginAnchorCtxs(context).map((anchor) => signalFromAnchor(context, settings, anchor))
  ]
    .filter((signal): signal is TradingSignal => Boolean(signal))
    .sort((a, b) => (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9)
      || (RANGE_TF_RANK[String(a.crtAnchor?.rangeTf)] ?? 9) - (RANGE_TF_RANK[String(b.crtAnchor?.rangeTf)] ?? 9)
      || signalPriority(a) - signalPriority(b)
      || b.score - a.score);
  // When two anchors hold live raids in opposite directions (e.g. weekly short raid vs daily
  // long raid), the chop between them IS the market: say it out loud on every signal.
  const liveRaidDirections = new Set(
    signals.filter((signal) => signal.crtAnchor?.raidActive && signal.stage !== "missed" && signal.stage !== "invalidated").map((signal) => signal.direction)
  );
  if (liveRaidDirections.size > 1) {
    const note = "Anchor çatışması: üst timeframe'lerde zıt yönlü canlı raid'ler var; LTF onayı gelmeden yön yok, chop bu çatışmanın kendisi.";
    for (const signal of signals) {
      signal.governance.warnings = Array.from(new Set([note, ...signal.governance.warnings]));
      signal.decisionSummary.warnings = Array.from(new Set([note, ...signal.decisionSummary.warnings])).slice(0, 8);
    }
  }
  return signals;
}

export const crtStrategy: StrategyModule = {
  id: CRT_STRATEGY_ID,
  name: "CRT Candle Range",
  description: "Candle Range Theory: 4H/1D/1W range, raid + reclaim, LTF ChoCH confirmation, retest entry, EQ/DOL plan.",
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
