import { checklistItem } from "../../brain/decisionSummary";
import { formatPrice, formatR } from "../../ict/format";
import { averageTrueRange, completedCandles } from "../../ict/candles";
import type { Candle, CrtBiasContext, CrtPoi, CrtState, DealingRange, DecisionSummary, ExecutionCostStress, FairValueGap, MarketContext, MarketSymbol, OrderBlock, QualityGrade, SignalActionWindow, SignalEvidenceItem, SignalGovernance, SignalOutcome, StopSource, SwingPoint, Timeframe, TradeDirection, TradePlan, TradingSignal } from "../../ict/types";
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
import { evaluateReferenceCandle, type ReferenceCandleScore } from "./referenceCandle";
import { evaluateDirectionalBias, type DirectionalBias } from "./directionalBias";

const CRT_STRATEGY_ID = "crt";
const DEFAULT_MINIMUM_RR = 1.5;
// A DOL target can look attractive while the configured full exit at EQ pays too
// little to justify the risk. READY must clear both numbers.
const MIN_MANAGEMENT_RR = 1;
const RISK_FLOOR_ATR_MULTIPLIER = 1;
const RISK_FLOOR_AVERAGE_RANGE_MULTIPLIER = 0.8;
// Freshness windows in confirmation-TF candles: a sweep older than ~24 bars no longer
// validates a setup. ChoCH stays valid for ~48 bars — staleness is guarded by the
// retest-distance blocker and missed-detection, not by a tight expiry that closes the
// entry window before the retest can arrive. The HTF raid itself does not expire this
// way — it stays valid while the range candle is the reference and distribution is incomplete.
const SWEEP_FRESHNESS_CANDLES = 16;
const CHOCH_FRESHNESS_CANDLES = 16;
const CHOCH_SWING_WING = 3;
const CHOCH_REFERENCE_LOOKBACK = 24;
// Sweep -> shift is ONE delivery sequence (SMC: "sweep + ChoCH handshake"). The first close
// through the protecting swing must land within this many confirmation candles of the
// manipulation; a break that comes later belongs to a new trend leg (BOS), not the raid.
const CHOCH_MAX_DELAY_CANDLES = 12;
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
type AnchorSpec = { rangeTf: Extract<Timeframe, "1h" | "4h" | "1d" | "1w">; confirmTf: Extract<Timeframe, "5m" | "15m" | "1h" | "4h"> };
const ANCHORS: AnchorSpec[] = [
  { rangeTf: "4h", confirmTf: "15m" },
  { rangeTf: "1d", confirmTf: "1h" },
  { rangeTf: "1w", confirmTf: "4h" },
  // Master §8'in beşinci eşlemesi (1H→5M). Yeni aile: intradayAnchorMode "tracking"
  // (varsayılan) READY üretmez — canlıda watch olarak izlenir, replay kanıt biriktirir.
  { rangeTf: "1h", confirmTf: "5m" }
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

// Master §6 lifecycle — 10 durum. `setupPhase` (4 durum) sıralama/UI için korunur.
export type CrtLifecycleState =
  | "CANDIDATE"
  | "ACTIVE_RANGE"
  | "SIDE_SWEPT"
  | "RETURNED_INSIDE"
  | "CONFIRMATION_PENDING"
  | "CONFIRMED"
  | "TARGETING_MIDPOINT"
  | "TARGETING_OPPOSITE_EXTREME"
  | "INVALIDATED"
  | "COMPLETED";

type CrtSetup = {
  direction: TradeDirection;
  directionSource: "turtle-soup" | "raid" | "bias" | "fvg-crt" | "active-crt";
  setupPhase: "context" | "raid" | "model" | "ready";
  lifecycleState: CrtLifecycleState;
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
  htfAlignment: CrtHtfAlignment;
  reversalAtExternalHtf: boolean;
  displacementStrength: "none" | "medium" | "strong";
  locationTier: "weekly" | "daily" | "fvg" | "none";
  referenceCandle?: ReferenceCandleScore;
  directionalBias?: DirectionalBias;
  eqConsumed: boolean;
  readyEligible: boolean;
};

type CrtHtfAlignmentTimeframe = Extract<Timeframe, "1M" | "1w" | "1d" | "4h">;

export type CrtHtfAlignment = {
  aligned: boolean;
  fullyAligned: boolean;
  required: CrtHtfAlignmentTimeframe[];
  matching: CrtHtfAlignmentTimeframe[];
  opposing: CrtHtfAlignmentTimeframe[];
  neutral: CrtHtfAlignmentTimeframe[];
  summary: string;
};

const HTF_ALIGNMENT_CHAIN: Record<AnchorSpec["rangeTf"], CrtHtfAlignmentTimeframe[]> = {
  "1h": ["4h", "1d"],
  "4h": ["1d", "1w"],
  "1d": ["1w"],
  "1w": ["1M"]
};

function contextBiasForTimeframe(context: MarketContext, timeframe: CrtHtfAlignmentTimeframe) {
  if (timeframe === "1M") return context.bias.monthly;
  if (timeframe === "1w") return context.bias.weekly;
  if (timeframe === "4h") return context.bias.h4;
  return context.bias.daily;
}

export function evaluateCrtHtfAlignment(
  context: MarketContext,
  rangeTf: AnchorSpec["rangeTf"],
  direction: TradeDirection
): CrtHtfAlignment {
  const required = HTF_ALIGNMENT_CHAIN[rangeTf];
  const expected = direction === "long" ? "bullish" : "bearish";
  const opposite = direction === "long" ? "bearish" : "bullish";
  const matching = required.filter((timeframe) => contextBiasForTimeframe(context, timeframe) === expected);
  const opposing = required.filter((timeframe) => contextBiasForTimeframe(context, timeframe) === opposite);
  const neutral = required.filter((timeframe) => contextBiasForTimeframe(context, timeframe) === "neutral");
  // Loose gate: only an actively OPPOSING higher timeframe vetoes READY (never trade against
  // the HTF narrative). A neutral/unclear higher TF is tolerated — it costs score via the
  // fullyAligned bonus, not eligibility.
  const aligned = opposing.length === 0;
  const fullyAligned = matching.length === required.length;
  const reads = required
    .map((timeframe) => `${timeframe} ${contextBiasForTimeframe(context, timeframe)}`)
    .join(" + ");
  return {
    aligned,
    fullyAligned,
    required,
    matching,
    opposing,
    neutral,
    summary: fullyAligned
      ? `${reads}; ${rangeTf.toUpperCase()} ${direction.toUpperCase()} yönüyle tam uyumlu.`
      : aligned
      ? `${reads}; üst yön ${expected} değil ama karşı da değil — nötr tolere edildi, skor düşük.`
      : `${reads}; üst timeframe ${direction.toUpperCase()} yönüne karşı — READY vetosu.`
  };
}

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
  if (spec.rangeTf === "1h") return context.timeframes.h1;
  if (spec.rangeTf === "4h") return context.timeframes.h4;
  if (spec.rangeTf === "1d") return context.timeframes.daily;
  return context.timeframes.weekly;
}

function confirmCandlesFor(context: MarketContext, spec: AnchorSpec): Candle[] {
  const candles = spec.confirmTf === "5m"
    ? (context.timeframes.m5.length ? context.timeframes.m5 : context.timeframes.m15)
    : spec.confirmTf === "15m"
      ? (context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5)
      : spec.confirmTf === "1h"
        ? context.timeframes.h1
        : context.timeframes.h4;
  return completedCandles(candles);
}

function liveConfirmCandlesFor(context: MarketContext, spec: AnchorSpec): Candle[] {
  if (spec.confirmTf === "5m") return context.timeframes.m5.length ? context.timeframes.m5 : context.timeframes.m15;
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
  const timeframe = spec.rangeTf === "1h" ? "1h" : spec.rangeTf === "4h" ? "4h" : spec.rangeTf === "1d" ? "1d" : "1w";
  return buildCrtBias([candles[index - 1], candles[index]], timeframe);
}

function raidFromPair(range: DealingRange, raidCandle: Candle, closed: boolean): AnchorRaid | undefined {
  const shortSwept = raidCandle.high > range.high;
  const longSwept = raidCandle.low < range.low;
  const shortCloseBack = closed && raidCandle.close < range.high;
  const longCloseBack = closed && raidCandle.close > range.low;
  // The second HTF candle only has to take the closed reference candle's high or low.
  // It may still be forming: its close and an additional HTF reclaim are not entry gates.
  // Directional confirmation belongs exclusively to the lower confirmation timeframe.
  const shortRaid = shortSwept;
  const longRaid = longSwept;
  if (shortRaid && longRaid) {
    // Both sides taken by one candle has no directional CRT read. Do not invent direction
    // by comparing wick sizes; wait for the next clean one-side raid.
    return undefined;
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

// SOP steps 2-4: mark CRT-High/Low, recognize the raid as soon as the wick takes an extreme,
// then drop to the lower timeframe. The raid candle does not have to close first.
// An accepted raid does NOT roll away when the next range candle closes: while it is still
// active, a poke at a newer candle's extreme is that raid's distribution leg (or noise), not
// a fresh setup — so scan oldest-first and keep the waiting setup's direction instead of
// flipping it on every new candle.
// The manipulation does NOT have to be the candle immediately after the range candle. For a
// given closed range candle, the raid is the FIRST later candle that takes its high or low —
// the candles in between simply traded inside the range (accumulation). We scan candidate range
// candles oldest-first within the persistence window so an already-accepted raid keeps its
// direction instead of flipping every time a new candle closes.
function firstSweepIndex(closed: Candle[], rangeIndex: number, range: DealingRange): number {
  for (let index = rangeIndex + 1; index < closed.length; index += 1) {
    if (closed[index].high > range.high || closed[index].low < range.low) return index;
  }
  return -1;
}

export function detectAnchorRaid(rangeCandles: Candle[], spec: AnchorSpec): { range: DealingRange; raid?: AnchorRaid } {
  const hasExplicitState = rangeCandles.some((candle) => typeof candle.closed === "boolean");
  const last = rangeCandles.at(-1);
  // Legacy/demo fixtures have no candle-state metadata. Preserve their original contract:
  // the last row is the live candle. Real Yahoo rows carry an explicit closed flag.
  const forming = last?.closed === false ? last : !hasExplicitState ? last : undefined;
  const closed = forming ? completedCandles(rangeCandles.slice(0, -1)) : completedCandles(rangeCandles);
  const n = closed.length;
  if (n === 0) return { range: rangeFromCandle(rangeCandles[rangeCandles.length - 1], spec) };
  const firstRange = Math.max(0, n - 1 - RAID_PERSISTENCE_LOOKBACK);
  // Closed raid: range candle -> first later candle (adjacent or several bars on) that sweeps it.
  for (let rangeIndex = firstRange; rangeIndex <= n - 2; rangeIndex += 1) {
    const range = rangeFromCandle(closed[rangeIndex], spec);
    const raidIndex = firstSweepIndex(closed, rangeIndex, range);
    if (raidIndex === -1) continue;
    const raid = raidFromPair(range, closed[raidIndex], true);
    if (raid && raidStillActive(closed, raidIndex, range, raid.direction)) {
      // The manipulation extreme is the raid LEG's running extreme, not the first raid
      // candle's wick: raidStillActive deliberately tolerates later wick pokes (distribution
      // leg / noise) as long as every close holds the reclaim, so those pokes belong to the
      // same raid. A stop anchored to the first wick would sit inside already-printed
      // liquidity once a later poke prints higher (live-raid parity: the forming wick counts).
      const legCandles = [...closed.slice(raidIndex + 1), ...(forming ? [forming] : [])];
      const level = raid.direction === "short"
        ? legCandles.reduce((max, candle) => Math.max(max, candle.high), raid.level)
        : legCandles.reduce((min, candle) => Math.min(min, candle.low), raid.level);
      return { range, raid: { ...raid, level } };
    }
  }
  // Forming raid: the most recent closed range candle every later closed candle respected,
  // now swept by the still-forming candle.
  if (forming) {
    for (let rangeIndex = n - 1; rangeIndex >= firstRange; rangeIndex -= 1) {
      const range = rangeFromCandle(closed[rangeIndex], spec);
      const respected = closed.slice(rangeIndex + 1).every((candle) => candle.high <= range.high && candle.low >= range.low);
      if (!respected) break;
      const raid = raidFromPair(range, forming, false);
      if (raid) return { range, raid };
    }
  }
  return { range: rangeFromCandle(closed[n - 1], spec) };
}

function buildAnchorCtx(context: MarketContext, spec: AnchorSpec): AnchorCtx | undefined {
  const rangeCandles = rangeCandlesFor(context, spec);
  const confirmCandles = confirmCandlesFor(context, spec);
  if (rangeCandles.length < 2 || confirmCandles.length < 20) return undefined;
  const liveConfirmCandles = liveConfirmCandlesFor(context, spec);
  const { range, raid } = detectAnchorRaid(rangeCandles, spec);
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
  "1h": 12,
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

export function findFirstCrtConfirmSweepIndex(
  candles: Candle[],
  raidTime: number,
  direction: TradeDirection,
  level: number
): number | undefined {
  const index = candles.findIndex((candle) =>
    candle.time >= raidTime
    && (direction === "short" ? candle.high > level : candle.low < level)
  );
  return index >= 0 ? index : undefined;
}

function confirmSweepIndex(anchor: AnchorCtx, direction: TradeDirection): number | undefined {
  if (!anchor.raid) return undefined;
  return findFirstCrtConfirmSweepIndex(
    anchor.liveConfirmCandles,
    anchor.raid.time,
    direction,
    direction === "short" ? anchor.range.high : anchor.range.low
  );
}

function anchorBias(anchor: AnchorCtx) {
  if (anchor.origin?.kind === "active-crt") return anchor.origin.bias;
  return buildCrtBias(completedCandles(anchor.rangeCandles), anchor.spec.rangeTf === "1h" ? "1h" : anchor.spec.rangeTf === "4h" ? "4h" : anchor.spec.rangeTf === "1d" ? "1d" : "1w");
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

export function isCrtEqConsumed(
  candles: Candle[],
  direction: TradeDirection,
  midpoint: number,
  manipulationIndex: number | undefined
): boolean {
  if (typeof manipulationIndex !== "number") return false;
  return candles.slice(Math.max(0, manipulationIndex)).some((candle) => direction === "short"
    ? candle.low <= midpoint
    : candle.high >= midpoint);
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
    const candleIndex = confirmSweepIndex(anchor, direction);
    if (typeof candleIndex !== "number") return undefined;
    return {
      side: expectedSweepSide(direction),
      level: anchor.raid.level,
      candleIndex,
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
  // Same running-extreme rule as the HTF raid: later wick pokes past the sweep candle while
  // the closes keep holding are the same raid leg, and the stop anchor must sit above them.
  const legExtremeSince = (fromIndex: number, seed: number): number => candles
    .slice(fromIndex + 1)
    .reduce((extreme, candle) => direction === "short" ? Math.max(extreme, candle.high) : Math.min(extreme, candle.low), seed);
  if (rangeSweep) {
    return {
      side: expectedSweepSide(direction),
      level: legExtremeSince(rangeSweep.candleIndex, direction === "short" ? rangeSweep.candle.high : rangeSweep.candle.low),
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
    ? {
        side: expectedSweepSide(direction),
        level: legExtremeSince(swingSweep.candleIndex, direction === "short" ? swingSweep.candle.high : swingSweep.candle.low),
        candleIndex: swingSweep.candleIndex,
        reclaimed: true
      }
    : undefined;
}

export type CrtChochRead = {
  reference?: { level: number; candleIndex: number };
  structuralBreak?: { level: number; candleIndex: number; referenceCandleIndex: number; bodyRatio: number; rangeAtr: number };
  confirmation?: { level: number; candleIndex: number; referenceCandleIndex: number; bodyRatio: number; rangeAtr: number };
};

function internalShiftReference(
  candles: Candle[],
  manipulationIndex: number,
  side: SwingPoint["side"],
  range: DealingRange,
  internalMargin: number
): SwingPoint | undefined {
  const firstIndex = Math.max(1, manipulationIndex - CHOCH_REFERENCE_LOOKBACK);
  for (let index = manipulationIndex - 1; index >= firstIndex; index -= 1) {
    const previous = candles[index - 1];
    const candle = candles[index];
    const next = candles[index + 1];
    if (!previous || !candle || !next || next.closed === false) continue;
    const isPivot = side === "high"
      ? candle.high > previous.high && candle.high >= next.high
      : candle.low < previous.low && candle.low <= next.low;
    const level = side === "high" ? candle.high : candle.low;
    const isInternal = side === "high"
      ? level < range.high - internalMargin
      : level > range.low + internalMargin;
    if (isPivot && isInternal) return { side, level, candleIndex: index, strength: "minor" };
  }
  return undefined;
}

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
  const internalMargin = Math.max(buffer * 2, (range.high - range.low) * 0.04);
  const confirmedSwing = [...swings]
    .filter((point) => point.side === swingSide)
    // A pivot is only knowable after its right wing closes. This prevents replay from using a
    // swing that was discovered after the alleged break.
    .filter((point) => point.candleIndex + CHOCH_SWING_WING <= manipulationIndex)
    .filter((point) => point.candleIndex >= manipulationIndex - CHOCH_REFERENCE_LOOKBACK)
    .filter((point) => point.level <= range.high + buffer && point.level >= range.low - buffer)
    // The opposite CRT boundary is the DOL, not an internal character-shift level. Using it
    // as ChoCH asks price to break the target before entry and creates impossible plans.
    .filter((point) => direction === "short"
      ? point.level > range.low + internalMargin
      : point.level < range.high - internalMargin)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  // CRT shift is an internal structure break. A three-wing swing is preferred, but a
  // one-candle internal pivot that was already visible before the manipulation is valid too.
  // Requiring only the broad three-wing pivot hid the exact SSL -> shift sequence used on
  // discretionary CRT charts.
  const swing = confirmedSwing ?? internalShiftReference(candles, manipulationIndex, swingSide, range, internalMargin);
  if (!swing) return {};

  const reference = { level: swing.level, candleIndex: swing.candleIndex };
  const minimumCloseThrough = Math.max(buffer * 0.1, averageRange * 0.03);
  const referenceWing = confirmedSwing ? CHOCH_SWING_WING : 1;
  const firstBreakIndex = Math.max(manipulationIndex + 1, swing.candleIndex + referenceWing + 1);
  // Sweep -> shift must be one delivery sequence: the break search ends CHOCH_MAX_DELAY_CANDLES
  // after the manipulation. A close through the swing beyond that window is a move the raid no
  // longer owns (the recovery's own BOS), so it cannot be this setup's character change.
  const lastBreakIndex = Math.min(candles.length - 1, manipulationIndex + CHOCH_MAX_DELAY_CANDLES);
  let structuralBreak: CrtChochRead["structuralBreak"];
  for (let index = firstBreakIndex; index <= lastBreakIndex; index += 1) {
    const candle = candles[index];
    if (candle.closed === false) continue;
    const directionalBody = direction === "short" ? candle.close < candle.open : candle.close > candle.open;
    const closeThrough = direction === "short" ? swing.level - candle.close : candle.close - swing.level;
    const candleRange = Math.max(candle.high - candle.low, 0.000001);
    const bodyRatio = Math.abs(candle.close - candle.open) / candleRange;
    const rangeAtr = candleRange / Math.max(averageRange, 0.000001);
    if (!directionalBody || closeThrough < minimumCloseThrough) continue;
    // Only the FIRST close through the protecting swing can be the character change. If that
    // first break is already stale, the character changed long ago — a fresher re-close of the
    // same level is the new trend's continuation, never this raid's ChoCH. Stop, don't skip.
    if (index < candles.length - CHOCH_FRESHNESS_CANDLES) break;
    structuralBreak ??= {
      level: swing.level,
      candleIndex: index,
      referenceCandleIndex: swing.candleIndex,
      bodyRatio,
      rangeAtr
    };
    // A strong displacement close confirms by itself. A weaker structural close can only be
    // promoted later when that same shift leg leaves a directional FVG.
    if (bodyRatio < 0.5 || rangeAtr < 0.8) continue;
    return {
      reference,
      structuralBreak,
      confirmation: {
        level: swing.level,
        candleIndex: index,
        referenceCandleIndex: swing.candleIndex,
        bodyRatio,
        rangeAtr
      }
    };
  }
  return { reference, structuralBreak };
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

function isGapPoi(poi: CrtPoi | undefined): boolean {
  return Boolean(poi && (poi.type === "fvg" || poi.label.toUpperCase().includes("FVG")));
}

function isShiftFvg(poi: CrtPoi | undefined, shift: CrtSetup["choch"]): boolean {
  if (!poi || !shift || !isGapPoi(poi) || typeof poi.candleIndex !== "number") return false;
  // FairValueGap.candleIndex is the third candle of the three-candle gap. The displacement
  // candle is therefore one bar earlier; allow one bar either side of the shift close.
  return poi.candleIndex >= shift.candleIndex && poi.candleIndex <= shift.candleIndex + 2;
}

function poiForAnchor(anchor: AnchorCtx, direction: TradeDirection, manipulation: CrtSetup["manipulation"], shift: CrtSetup["choch"]): CrtPoi | undefined {
  // SOP step 7: the entry POI is the FVG/OB the raid's reversal leg leaves behind — an old
  // zone from prior structure is a different trade, and a synthetic OTE is not a POI at all.
  if (!manipulation) return undefined;
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
    .filter((poi) => !shift || (poi.candleIndex ?? 0) <= shift.candleIndex + 2)
    .filter((poi) => poi.midpoint <= range.high && poi.midpoint >= range.low)
    .sort((a, b) => {
      const aLinked = isShiftFvg(a, shift) ? 0 : 1;
      const bLinked = isShiftFvg(b, shift) ? 0 : 1;
      return aLinked - bLinked || priority[a.type] - priority[b.type] || (b.candleIndex ?? 0) - (a.candleIndex ?? 0);
    })[0];
}

export function findCrtEntryRetestIndex(
  candles: Candle[],
  entry: number,
  afterIndex: number,
  zone?: { low: number; high: number }
): number | undefined {
  const index = candles.findIndex((candle, candleIndex) => candleIndex > afterIndex && (zone
    ? candle.low <= zone.high && candle.high >= zone.low
    : candle.low <= entry && candle.high >= entry));
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
  // CRT entry is the first executable FVG tap, not a mandatory CE/midpoint fill. For a
  // bullish FVG price returns from above into the high edge; for a bearish FVG it returns
  // from below into the low edge. Requiring the exact midpoint missed valid taps while the
  // UI correctly described the whole box as the entry area.
  const poiEntry = poi && isGapPoi(poi)
    ? direction === "long" ? poi.high : poi.low
    : poi?.midpoint;
  return poi && typeof poiEntry === "number" && insideRange(poiEntry) && (direction === "short" ? poiEntry > choch.level : poiEntry < choch.level)
    ? poiEntry
    : choch.level;
}

export function selectCrtEntry(input: {
  choch: CrtSetup["choch"];
  poi?: CrtPoi;
  plannedRetestEntry: number;
  retestIndex?: number;
  confirmationClose?: number;
}): {
  entry: number;
  entrySource: TradePlan["entrySource"];
  entryStatus: TradePlan["entryStatus"];
  retested: boolean;
} {
  const { choch, poi, plannedRetestEntry, retestIndex, confirmationClose } = input;
  if (choch && typeof retestIndex === "number") {
    return {
      entry: plannedRetestEntry,
      entrySource: poi ? "poi-retest" : "choch-close",
      entryStatus: "confirmed",
      retested: true
    };
  }

  // A ChoCH close WITHOUT a retest never confirms the entry (input.confirmationClose is
  // deliberately ignored). Measured 2026-07-15 (12 symbols, 30d): direct-from-close entries ran
  // -0.46R over 5 trades while retest-based entries made +0.56R over 6, and the doctrine says the
  // displaced close is never chased. The plan stays visible (WATCH) at the retest level and only
  // confirms when price actually returns. This guard was silently removed in b60d381 (a live/replay
  // alignment commit) and restored 2026-07-22 by owner decision — see retest-mandatory-for-entry.
  void confirmationClose;
  return {
    entry: plannedRetestEntry,
    entrySource: choch || poi ? (poi ? "poi-retest" : "choch-close") : "fallback-close",
    entryStatus: choch || poi ? "pending" : "fallback",
    retested: false
  };
}

function buildAnchorPlan(context: MarketContext, anchor: AnchorCtx, direction: TradeDirection, turtleSoup: TurtleSoupPattern | undefined, manipulation: CrtSetup["manipulation"], choch: CrtSetup["choch"], poi: CrtPoi | undefined, retestIndex: number | undefined, minimumRR: number, buffer: number, stress: ExecutionCostStress): TradePlan {
  const candles = anchor.confirmCandles;
  const plannedRetestEntry = entryLevelForAnchor(anchor, direction, choch, poi);
  const confirmationClose = choch ? candles[choch.candleIndex]?.close : undefined;
  const entryDecision = selectCrtEntry({ choch, poi, plannedRetestEntry, retestIndex, confirmationClose });
  const { entry, entrySource, entryStatus } = entryDecision;
  // Stop must sit on the loss side of the entry.
  const manipulationStop = manipulation
    ? direction === "short" ? manipulation.level + buffer : manipulation.level - buffer
    : undefined;
  const manipulationStopValid = typeof manipulationStop === "number"
    && (direction === "short" ? manipulationStop > entry : manipulationStop < entry);
  const structuralStopSource: StopSource = manipulationStopValid ? "manipulation" : "swing";
  const structuralStop = manipulationStopValid && typeof manipulationStop === "number"
    ? manipulationStop
    : direction === "short" ? anchor.range.high + buffer : anchor.range.low - buffer;
  const structuralStopValid = direction === "short" ? structuralStop > entry : structuralStop < entry;
  const minimumRiskFloor = Math.max(
    anchor.atr * RISK_FLOOR_ATR_MULTIPLIER,
    anchor.averageRange * RISK_FLOOR_AVERAGE_RANGE_MULTIPLIER,
    SYMBOL_MIN_BUFFER[context.symbol] * 2
  );
  const useRiskFloor = structuralStopValid && Math.abs(entry - structuralStop) < minimumRiskFloor;
  // Widen away from the entry only. This preserves a valid manipulation/structure stop; an
  // already-invalid structural stop is deliberately left untouched so geometry validation can
  // reject the setup instead of manufacturing a plausible-looking plan.
  const stopLoss = useRiskFloor
    ? direction === "short" ? entry + minimumRiskFloor : entry - minimumRiskFloor
    : structuralStop;
  const stopSource: StopSource = useRiskFloor ? "volatility-floor" : structuralStopSource;
  const riskDistance = Math.max(Math.abs(entry - stopLoss), 0.000001);
  // CRT management is deterministic: TP1 is the anchor range equilibrium (0.5), never a
  // synthetic "POC" inferred from candle touches.
  const tp1 = anchor.range.midpoint;
  const realTarget = targetDol(anchor, direction, entry);
  const tp2 = realTarget ?? tp1;
  const costs = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp2, stress });
  const managementCosts = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp1, stress });
  const planWarnings = [
    ...(turtleSoup ? [`${anchor.spec.confirmTf} Turtle Soup ek kalite teyidi var.`] : []),
    `CRT ${anchor.spec.rangeTf} range ${formatPrice(anchor.range.low)}-${formatPrice(anchor.range.high)}; confirmation ${anchor.spec.confirmTf}.`,
    `TP1/EQ yönetim seviyesi ${formatPrice(tp1)}; TP2/DOL ${formatPrice(tp2)}.`,
    ...(useRiskFloor
      ? [`Structure stop gürültü bandında kaldı; risk tabanı ${formatPrice(minimumRiskFloor)} uygulandı.`]
      : [`Stop ${structuralStopSource === "manipulation" ? "manipulation wick" : "CRT structure"} dışına ${formatPrice(buffer)} buffer ile kondu.`]),
    ...(costs.netRR < minimumRR ? [`TP2/DOL net RR ${costs.netRR.toFixed(2)}, minimum ${minimumRR}. READY değil.`] : []),
    ...(managementCosts.netRR < MIN_MANAGEMENT_RR
      ? [`EQ/TP1 net RR ${managementCosts.netRR.toFixed(2)}, minimum ${MIN_MANAGEMENT_RR}. Tam-EQ çıkışta READY değil.`]
      : [`Tam-EQ yönetim net RR ${managementCosts.netRR.toFixed(2)}.`]),
    ...(!choch ? [`${anchor.spec.confirmTf} ChoCH/Just mum kapanışı bekleniyor.`] : []),
    // Retest zorunlu (retest-mandatory-for-entry): ChoCH var ama retest yoksa plan WATCH'ta bekler.
    ...(choch && entryStatus === "pending" ? [`ChoCH kapandı; giriş ${formatPrice(entry)} retest teması bekleniyor (kapanış kovalanmaz).`] : [])
  ];

  return {
    entry,
    entrySource,
    entryStatus,
    entryModel: {
      source: entrySource,
      status: entryStatus,
      level: entry,
      retested: entryDecision.retested,
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
    managementRR: managementCosts.netRR,
    riskDistance,
    stopSource,
    stopBuffer: buffer,
    targetSource: "crt-dol",
    executionCosts: costs,
    planWarnings
  };
}

export function isCrtPlanGeometryValid(direction: TradeDirection, plan: TradePlan): boolean {
  const finalTarget = plan.targets[1] ?? plan.targets[0];
  if (![plan.entry, plan.stopLoss, finalTarget, plan.riskDistance, plan.rr].every(Number.isFinite)) return false;
  if (plan.riskDistance <= 0 || typeof finalTarget !== "number") return false;
  const stopValid = direction === "short" ? plan.stopLoss > plan.entry : plan.stopLoss < plan.entry;
  const targetValid = direction === "short" ? finalTarget < plan.entry : finalTarget > plan.entry;
  return stopValid && targetValid;
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
  // Turtle Soup is optional evidence only. It must never replace the anchor's real HTF raid,
  // otherwise an unrelated recent LTF wick rewrites the manipulation time, stop and sequence.
  const manipulation = manipulationForAnchor(anchor, direction);
  const eqConsumed = isCrtEqConsumed(anchor.liveConfirmCandles, direction, anchor.range.midpoint, manipulation?.candleIndex);
  const chochRead = chochForAnchor(anchor, direction, manipulation, buffer);
  const structuralShift = chochRead.structuralBreak ?? chochRead.confirmation;
  const poi = poiForAnchor(anchor, direction, manipulation, structuralShift);
  const linkedShiftFvg = isShiftFvg(poi, structuralShift);
  // A strong closed internal break is the confirmation. A linked FVG may validate a weaker
  // break, but absence of an FVG must never erase an otherwise valid ChoCH.
  const choch = chochRead.confirmation ?? (linkedShiftFvg ? structuralShift : undefined);
  const plannedEntry = entryLevelForAnchor(anchor, direction, choch, poi);
  const retestKnownIndex = choch ? Math.max(choch.candleIndex, poi?.candleIndex ?? choch.candleIndex) : undefined;
  const retestIndex = typeof retestKnownIndex === "number"
    ? findCrtEntryRetestIndex(
        anchor.liveConfirmCandles,
        plannedEntry,
        retestKnownIndex,
        poi && isGapPoi(poi) ? { low: poi.low, high: poi.high } : undefined
      )
    : undefined;
  const plan = buildAnchorPlan(context, anchor, direction, turtleSoup, manipulation, choch, poi, retestIndex, minimumRR, buffer, executionCostStress(settings));
  const bias = anchorBias(anchor);
  const biasConflict = directionSource === "raid" && bias.direction !== "neutral" && bias.direction !== direction;
  const continuationAgainst = (bias.kind === "bullish-continuation" && direction === "short")
    || (bias.kind === "bearish-continuation" && direction === "long");
  const lastClose = anchor.confirmCandles[anchor.confirmCandles.length - 1].close;
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
  const managementRR = plan.managementRR ?? eqDistanceR;
  const eqTooClose = tp1Valid && eqDistanceR < 0.5;
  const hasRealTarget = typeof targetDol(anchor, direction, plan.entry) === "number";
  const anchorRanges = anchor.rangeCandles.slice(-20).map((candle) => candle.high - candle.low);
  const anchorAverageRange = anchorRanges.reduce((sum, value) => sum + value, 0) / Math.max(anchorRanges.length, 1);
  const rangeHeight = anchor.range.high - anchor.range.low;
  const rangeTooSmall = anchorAverageRange > 0 && rangeHeight < anchorAverageRange * 0.6;
  const stopInNoise = plan.riskDistance < anchor.atr * 0.6;
  // STEP 1: HTF narrative (M/W/D/4H) gives direction weight. Conflicts affect quality only;
  // the setup's own range raid and lower-timeframe confirmation remain authoritative.
  const votes = [context.bias.monthly, context.bias.weekly, context.bias.daily, context.bias.h4];
  const bullishVotes = votes.filter((vote) => vote === "bullish").length;
  const bearishVotes = votes.filter((vote) => vote === "bearish").length;
  const htfNarrative: TradeDirection | "neutral" = bullishVotes - bearishVotes >= 2 ? "long" : bearishVotes - bullishVotes >= 2 ? "short" : "neutral";
  // Master §8/§11: two-sided directional bias (draw-first). Structured bias evidence for Gemini/UI;
  // it grades the market's lean and confidence, it does not override the per-anchor direction.
  const directionalBias = evaluateDirectionalBias({
    price: (context.timeframes.m15.at(-1) ?? context.timeframes.m5.at(-1))?.close ?? anchor.range.midpoint,
    htfBias: { monthly: context.bias.monthly, weekly: context.bias.weekly, daily: context.bias.daily, h4: context.bias.h4 },
    pdZone: context.premiumDiscount.zone,
    liquidityObjectives: context.liquidityObjectives,
    sweeps: context.sweeps,
    displacements: context.displacements,
    marketStructureShifts: context.marketStructureShifts,
    inKillzone: context.killzones.some((zone) => zone.active && zone.name !== "Outside")
  });
  const htfAlignment = evaluateCrtHtfAlignment(context, anchor.spec.rangeTf, direction);
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
  // Top/bottom reversal exception (Master §10.2/§10.4): at a top the 1D/1W candle bias is still
  // bullish BY DEFINITION — it only flips after the move delivers. When the manipulation swept
  // weekly/monthly-tier EXTERNAL liquidity (PWH/PML) or a STRONG opposing liquidity pool (old
  // structural high/low, equal highs/lows — the classic BSL/SSL raid), that draw is consumed and
  // the sweep itself is the counter-side evidence, so the opposing-HTF read demotes from veto to
  // a size-down warning. Every other gate (ChoCH, retest, RR, geometry) applies unchanged.
  const externalPoolSwept = context.liquidityPools.some((pool) =>
    pool.strength === "strong"
    && (direction === "short" ? pool.side === "buy-side" : pool.side === "sell-side")
    && nearSwept(pool.level));
  const reversalAtExternalHtf = !htfAlignment.aligned && (weeklyLocation || externalPoolSwept) && Boolean(manipulation);
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
  // Master §5: grade the CRT reference candle so an arbitrary doji cannot pose as a real range.
  // Hybrid, not a hard filter: every closed candle is a candidate, but a weak candle scores low.
  let referenceIndex = -1;
  for (let index = anchor.rangeCandles.length - 1; index >= 0; index -= 1) {
    if (Math.abs(anchor.rangeCandles[index].high - anchor.range.high) < 1e-9 && Math.abs(anchor.rangeCandles[index].low - anchor.range.low) < 1e-9) {
      referenceIndex = index;
      break;
    }
  }
  const referenceCandle = referenceIndex >= 0
    ? evaluateReferenceCandle({
        candle: anchor.rangeCandles[referenceIndex],
        recentCandles: anchor.rangeCandles.slice(0, referenceIndex),
        atMeaningfulLocation: anchorAtKeyLevel || fvgConfluence,
        keyTime: keyOpenRaid || buildKillzoneContext(anchor.rangeCandles[referenceIndex].time).some((zone) => zone.active && zone.name !== "Outside")
      })
    : undefined;

  const blockers = [
    // CRT core: closed range -> one-side wick raid -> LTF character-shift close ->
    // opposite range edge. Everything else belongs in quality warnings, not this gate list.
    anchor.origin ? `${anchor.origin.kind === "fvg-origin" ? "FVG-origin" : "Active CRT"} deneysel model; ana CRT ile ayrı ölçülene kadar yalnızca WATCH.` : undefined,
    !manipulation ? `Manipulation yok: ${anchor.spec.rangeTf.toUpperCase()} CRT high/low henüz alınmadı.` : undefined,
    !choch ? `${anchor.spec.confirmTf} ChoCH/shift mum kapanışı yok.` : undefined,
    settings.useHtfAlignmentFilter === true && !htfAlignment.aligned && !reversalAtExternalHtf ? `HTF yön filtresi açık ve yön karşı: ${htfAlignment.summary}` : undefined,
    !hasRealTarget ? "Gerçek distribution/DOL hedefi yok; entry range'in ötesine taşmış." : undefined,
    !stopValid ? "Stop entry'nin yanlış tarafında; plan geometrisi bozuk, trade edilemez." : undefined,
    !pdAligned ? "CRT range P/D yanlış: long discounttan, short premiumdan gelmeli." : undefined,
    managementRR < MIN_MANAGEMENT_RR
      ? `Tam-EQ çıkış net RR yetersiz (${managementRR.toFixed(2)} < ${MIN_MANAGEMENT_RR}).`
      : undefined,
    retestFar ? "Fiyat entry alanından uzaklaşmış; kovalanmaz — yeni raid bekle." : undefined,
    settings.avoidNews === true && context.eventRisk.noTrade ? `Haber filtresi açık: ${context.eventRisk.summary}` : undefined,
    plan.rr < minimumRR ? `TP2/DOL RR minimumun altında (${plan.rr.toFixed(2)} < ${minimumRR}).` : undefined,
    context.dataConfidence.score < 35 ? context.dataConfidence.summary : undefined
  ].filter((item): item is string => Boolean(item));
  const warnings = [
    turtleSoup ? turtleSoup.summary : undefined,
    htfAlignment.aligned && !htfAlignment.fullyAligned ? `Üst yön nötr (${htfAlignment.neutral.join(", ")}); karşı değil ama tam onay yok, boyutu küçük tut.` : undefined,
    reversalAtExternalHtf ? `Karşı-HTF dönüş setup'ı: haftalık/aylık external likidite süpürüldü (draw tüketildi), HTF henüz dönmedi — geçerli ama boyutu küçük tut.` : undefined,
    choch && !poi ? "FVG/OB yok; plan doğrudan kapalı ChoCH mumundan giriş kullanıyor." : undefined,
    choch && poi && !linkedShiftFvg ? "POI var ama shift bacağına bağlı değil; yalnızca kalite notu." : undefined,
    choch && linkedShiftFvg && typeof retestIndex !== "number" ? "Shift FVG var ama retest gelmedi; retest zorunlu, ChoCH kapanışı tek başına giriş onaylamaz — WATCH." : undefined,
    !pullback.valid ? `${pullback.summary} (hard gate değil, kalite notu.)` : undefined,
    !pdAligned ? `${direction.toUpperCase()} entry CRT range ${crtZone}; ideal ${expectedPd(direction)} ama RR/geometri uygunsa hard gate değil.` : undefined,
    !inSession ? "Killzone dışı; hard gate değil ama killzone içi setup'ın ihtimali daha yüksek." : undefined,
    context.eventRisk.noTrade && settings.avoidNews !== true ? `${context.eventRisk.summary} (haber filtresi kapalı; manuel risk notu.)` : undefined,
    continuationAgainst ? "HTF continuation setup yönüne ters; hard gate değil, kalite notu." : undefined,
    eqConsumed ? `CRT %50/EQ ${formatPrice(anchor.range.midpoint)} raid sonrası görüldü; setup tüketildi, yeni giriş yok.` : undefined,
    !anchorAtKeyLevel && !fvgConfluence ? "Sweep ek HTF key level/FVG confluence taşımıyor; model geçerli olabilir ama kalite düşük." : undefined,
    rangeTooSmall ? `CRT range mumu ortalama ${anchor.spec.rangeTf} range'in altında; küçük range, false shift riski yüksek.` : undefined,
    manipulation && displacementStrength === "none" && !linkedShiftFvg ? `Raid sonrası ${anchor.spec.confirmTf} displacement zayıf.` : undefined,
    stopInNoise ? `Stop mesafesi ${anchor.spec.confirmTf} gürültü bandının içinde; küçük boyut kullan.` : undefined,
    !tp1Valid ? "Entry EQ seviyesini geçmiş; TP1'i atla ve yalnızca DOL/TP2 planını kullan." : undefined,
    !anchorAtKeyLevel ? "Anchor mum key seviyede değil (PDH/PDL/PWH/PWL uzak); confluence eksik." : undefined,
    !fvgConfluence ? "Raid bölgesi HTF FVG içinde değil; CRT-FVG confluence eksik." : undefined,
    biasConflict ? "HTF bias raid yönünün tersinde; counter-bias reversal, boyutu küçük tut." : undefined,
    dealingPdConflict ? "Global dealing range PD ters (CRT range PD doğru); geniş resimde ters yarıda, boyutu küçük tut." : undefined,
    htfNarrative !== "neutral" && direction !== htfNarrative ? "Geniş M/W/D/4H çoğunluğu setup yönüne karşı; üst yön blocker'ına ek kalite uyarısı." : undefined,
    htfNarrative === "neutral" ? "Geniş M/W/D/4H anlatısı karışık; anchor'a özel HTF zinciri esas alındı." : undefined,
    context.regime.type === "chop" ? "Chop/low-energy rejim; fake MSS ve zayıf FVG riski, boyutu küçük tut." : undefined,
    context.regime.type === "news-expansion" ? `Haber/spike expansion rejimi: ${context.regime.summary}` : undefined,
    context.regime.type === "trend" && biasConflict ? "Trend rejiminde counter-bias CRT; kalite düşük, risk azalt." : undefined,
    eqTooClose ? `EQ/TP1 mesafesi ${eqDistanceR.toFixed(2)}R (0.5R altı); tam-EQ çıkış modelinde işlem R'ı küçük kalır, boyutu küçük tut.` : undefined,
    context.regime.tradeability === "caution" ? context.regime.summary : undefined,
    !smtAligned ? "SMT (correlated pair divergence) yok; en güçlü kurumsal teyit eksik." : undefined,
    !sessionTimedRaid && anchor.raid ? "Raid bir killzone dışında oluştu; session-sweep anlatısı zayıf." : undefined,
    ...plan.planWarnings
  ].filter((item): item is string => Boolean(item));
  // Score communicates quality; it never redefines the CRT model. Core completion alone earns
  // a tradable score, while FVG/SMT/session/location add confidence without veto power.
  const score = Math.max(0, Math.min(100,
    20
    + (manipulation ? 30 : 0)
    + (choch ? 25 : 0)
    + (plan.rr >= minimumRR ? 15 : Math.max(0, Math.round(plan.rr * 5)))
    + (managementRR >= MIN_MANAGEMENT_RR ? 10 : 0)
    + (linkedShiftFvg || typeof retestIndex === "number" ? 5 : 0)
    + (htfAlignment.fullyAligned ? 6 : htfAlignment.aligned ? 3 : 0)
    + (smtAligned ? 3 : 0)
    + (inSession || isCryptoSymbol(context.symbol) ? 2 : 0)
    + (anchorAtKeyLevel || fvgConfluence ? 2 : 0)
    + (rangeRespect ? 2 : 0)
    + (sessionTimedRaid ? 2 : 0)
    + (keyOpenRaid ? 1 : 0)
    // reference_candle_score: an A imbalance range candle earns ~9, a D/arbitrary candle ~2.
    + Math.round(((referenceCandle?.score ?? 50) / 100) * 10)
    // Two-sided bias gate (Master §8): a confident OPPOSING macro bias costs score (not a veto —
    // the anchor still owns direction; htfAlignment already vetoes a hard opposing HTF).
    - (directionalBias.direction !== "neutral" && (directionalBias.direction === "bullish" ? "long" : "short") !== direction ? Math.min(12, Math.round(directionalBias.confidence / 5)) : 0)
    - (!pdAligned ? 8 : 0)
    - (!inSession ? 6 : 0)
  ));
  if (directionalBias.direction !== "neutral" && (directionalBias.direction === "bullish" ? "long" : "short") !== direction && directionalBias.confidence >= 25) {
    warnings.push(`İki-taraflı bias ${directionalBias.direction} (güven ${directionalBias.confidence}) setup yönüne karşı; makro çekiş ters, boyutu küçük tut.`);
  }
  if (referenceCandle && (referenceCandle.grade === "D" || referenceCandle.grade === "C")) {
    warnings.push(`CRT range mumu zayıf (reference_candle_score ${referenceCandle.score}/${referenceCandle.grade}): ${referenceCandle.reasons[0]} Alelade mum güçlü imbalance mumu kadar güvenilir değildir.`);
  }
  if (referenceCandle?.exhausted) {
    warnings.push("CRT range mumu aşırı büyük/tükenmiş; menzil zaten teslim edilmiş olabilir, boyutu küçük tut.");
  }
  if (score < 70) warnings.push(`CRT kalite skoru ${score}; B altı kalite. Görünür kalsın ama küçük boyut/ek teyit gerekir.`);
  // READY = the setup is logically/geometrically valid AND at least tradable quality. Quality
  // gaps (weak location, no SMT, no session raid, medium displacement, tight EQ) only cost
  // score/grade — they no longer block READY, since scoring them twice (score + veto) is what
  // starved the live system to zero signals. Real invalidators still veto.
  const modelFormed = Boolean(manipulation) && Boolean(choch);
  const modelReady = modelFormed && plan.entryStatus === "confirmed";
  // 1H anchor'ı yeni bir aile: Master §14 (audit-first) gereği önce kendi replay kanıtını
  // biriktirir. tracking modunda (varsayılan) READY olamaz — canlıda watch olarak görünür,
  // Telegram'a çıkmaz; yalnız intradayAnchorMode="live" bunu açar (30+ işlem kanıtı sonrası).
  const intradayTracking = anchor.spec.rangeTf === "1h" && settings.intradayAnchorMode !== "live";
  if (intradayTracking && modelReady) {
    warnings.push("1H anchor tracking modunda: model hazır ama READY üretmez; replay kanıt biriktiriyor.");
  }
  const readyEligible = !intradayTracking
    && plan.entryStatus === "confirmed"
    && plan.rr >= minimumRR
    && managementRR >= MIN_MANAGEMENT_RR
    && blockers.length === 0
    && pdAligned
    && Boolean(manipulation) && !eqConsumed
    && hasRealTarget && stopValid && !retestFar
    && (settings.useHtfAlignmentFilter !== true || htfAlignment.aligned || reversalAtExternalHtf)
    && modelReady
    && context.dataConfidence.score >= 35;
  const setupPhase: CrtSetup["setupPhase"] = readyEligible
    ? "ready"
    : modelFormed
    ? "model"
    : manipulation
    ? "raid"
    : "context";
  // Master §6: lifecycle bir boolean değil, 10 durumlu bir zincirdir. `setupPhase` (4 durum)
  // sıralama/UI için kalır; bu alan doktrinin tam zincirini deterministik olarak türetir.
  // Yalnızca sistemin GERÇEKTEN bildiği olgulardan üretilir — pozisyon takibi yok, bu yüzden
  // TARGETING_* durumları fiyatın plan seviyelerine göre konumundan okunur.
  const lifecycleState: CrtLifecycleState = eqConsumed
    ? "COMPLETED"
    : readyEligible
      ? (() => {
          const past = direction === "short" ? lastClose < plan.entry : lastClose > plan.entry;
          if (!past) return "CONFIRMED";
          const beyondEq = direction === "short" ? lastClose <= plan.targets[0] : lastClose >= plan.targets[0];
          return beyondEq ? "TARGETING_OPPOSITE_EXTREME" : "TARGETING_MIDPOINT";
        })()
      : choch
        ? "CONFIRMATION_PENDING"
        : manipulation?.reclaimed
          ? "RETURNED_INSIDE"
          : manipulation
            ? "SIDE_SWEPT"
            : anchor.raid
              ? "ACTIVE_RANGE"
              : "CANDIDATE";
  // Blockers gate READY; score remains a quality measure and must retain variation so the
  // radar can distinguish a 61-point early idea from an 89-point setup with one hard issue.
  const visibleScore = Math.max(0, score - Math.min(24, blockers.length * 4));
  return {
    direction,
    directionSource,
    setupPhase,
    lifecycleState,
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
    htfAlignment,
    reversalAtExternalHtf,
    displacementStrength,
    locationTier,
    referenceCandle,
    directionalBias,
    eqConsumed,
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
    checklistItem(`${anchor.spec.rangeTf.toUpperCase()} Range`, anchor.origin?.kind === "active-crt" && !anchor.origin.closed ? "neutral" : "pass", anchor.range.source),
    checklistItem("Manipulation", setup.manipulation ? "pass" : "fail", setup.manipulation ? `${anchor.spec.rangeTf.toUpperCase()} CRT ${setup.direction === "short" ? "high" : "low"} alındı: ${formatPrice(setup.manipulation.level)}. HTF kapanışı beklenmez.` : `${anchor.spec.rangeTf.toUpperCase()} CRT ${setup.direction === "short" ? "high" : "low"} alınması bekleniyor.`),
    checklistItem("ChoCH / Just", setup.choch ? "pass" : "fail", setup.choch ? `${anchor.spec.confirmTf} kapanış ${formatPrice(setup.choch.level)} seviyesini kırdı.` : `${anchor.spec.confirmTf} kapanışla kırılma bekleniyor.`),
    checklistItem("Entry", setup.plan.entryStatus === "confirmed" ? "pass" : "neutral", setup.plan.entryStatus === "confirmed" ? `${formatPrice(setup.plan.entry)} ${setup.plan.entrySource} entry aktif.` : "ChoCH kapanışı gelmeden entry yok."),
    checklistItem("RR to DOL", setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "fail", `Karşı CRT kenarı ${formatPrice(setup.plan.targets[1])}; net RR ${formatR(setup.plan.rr)}.`),
    checklistItem("POI", setup.poi ? "pass" : "neutral", setup.poi ? `${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)} kalite bonusu.` : "FVG/OB yok; CRT yine ChoCH kapanışıyla geçerli olabilir."),
    checklistItem("CRT Bias / DOL", bias.direction === direction ? "pass" : "neutral", bias.summary),
    checklistItem("Premium / Discount", pdAligned ? "pass" : "neutral", `Entry ${crtZone}; ideal ${expectedPd(direction)}. Kalite notu, hard gate değil.`),
    checklistItem("HTF Yön Uyumu", setup.htfAlignment.fullyAligned ? "pass" : setup.htfAlignment.aligned || setup.reversalAtExternalHtf ? "neutral" : "fail", setup.reversalAtExternalHtf ? `${setup.htfAlignment.summary} Karşı-HTF dönüş istisnası: haftalık external likidite süpürüldü.` : setup.htfAlignment.summary),
    checklistItem("SMT", smtAligned ? "pass" : "neutral", smtAligned ? "SMT kalite teyidi var." : "SMT hard şart değil."),
    checklistItem("Data", context.dataConfidence.score >= 68 ? "pass" : context.dataConfidence.score >= 35 ? "neutral" : "fail", context.dataConfidence.summary)
  ];
}

function crtDecisionSummary(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup, grade: QualityGrade, riskWarnings: string[]): DecisionSummary {
  const checklist = crtChecklist(context, anchor, setup);
  const side = setup.direction === "short" ? "Bearish" : "Bullish";
  const fullReasoning = [
    `${context.symbol} ${side} CRT: ${anchor.spec.rangeTf} range ${formatPrice(anchor.range.low)}-${formatPrice(anchor.range.high)}.`,
    setup.manipulation ? `Manipulation ${formatPrice(setup.manipulation.level)} seviyesinde tamam.` : "Manipulation bekleniyor.",
    setup.choch ? `${anchor.spec.confirmTf} dağılım kapanışı ${formatPrice(setup.choch.level)} iç yapısını kırdı.` : `${anchor.spec.confirmTf} iç yapı kapanışı bekleniyor.`,
    `Plan ${formatPrice(setup.plan.entry)} giriş, ${formatPrice(setup.plan.stopLoss)} stop, karşı CRT kenarı ${formatPrice(setup.plan.targets[1])}.`,
    `Grade ${grade}, net RR ${formatR(setup.plan.rr)}.`,
    ...riskWarnings
  ].join(" ");
  return {
    shortSummary: `${context.symbol} ${setup.direction.toUpperCase()} · range → manipulation → distribution · RR ${formatR(setup.plan.rr)}.`,
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
      ? "CRT tamam: range, manipulation, dağılım kapanışı ve karşı kenar hedefi hazır."
      : setup.setupPhase === "model"
      ? "Dağılım başladı; RR veya plan geometrisi kontrol ediliyor."
      : setup.setupPhase === "raid"
      ? "Manipulation var; alt zaman iç yapı kapanışı bekleniyor."
      : "CRT range var; bir kenarın sweep edilmesi bekleniyor.")
  };
}

export function findCrtTrackingStartIndex(input: {
  executionCandles: Candle[];
  confirmCandles: Candle[];
  liveConfirmCandles: Candle[];
  confirmTf: AnchorSpec["confirmTf"];
  entrySource: TradePlan["entrySource"];
  chochIndex?: number;
  retestIndex?: number;
  manipulationIndex?: number;
}): number {
  const { executionCandles, confirmCandles, liveConfirmCandles, confirmTf, entrySource, chochIndex, retestIndex, manipulationIndex } = input;
  const confirmDuration = confirmTf === "4h" ? 4 * 60 * 60 * 1000 : confirmTf === "1h" ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const startTime = typeof retestIndex === "number"
    ? liveConfirmCandles[retestIndex]?.time
    : entrySource === "choch-close" && typeof chochIndex === "number"
      ? (confirmCandles[chochIndex]?.time ?? 0) + confirmDuration
      : typeof chochIndex === "number"
        ? confirmCandles[chochIndex]?.time
        : typeof manipulationIndex === "number"
          ? confirmCandles[manipulationIndex]?.time
          : undefined;
  if (typeof startTime !== "number") return Math.max(0, executionCandles.length - 1);
  const index = executionCandles.findIndex((candle) => candle.time >= startTime);
  return index >= 0 ? index : Math.max(0, executionCandles.length - 1);
}

function m15StartIndex(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): number {
  return findCrtTrackingStartIndex({
    executionCandles: context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5,
    confirmCandles: anchor.confirmCandles,
    liveConfirmCandles: anchor.liveConfirmCandles,
    confirmTf: anchor.spec.confirmTf,
    entrySource: setup.plan.entrySource,
    chochIndex: setup.choch?.candleIndex,
    retestIndex: setup.retestIndex,
    manipulationIndex: setup.manipulation?.candleIndex
  });
}

function lifecycle(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup, readyCandidate: boolean): { stage: TradingSignal["stage"]; outcome: SignalOutcome; actionWindow: SignalActionWindow } {
  if (setup.plan.entryStatus !== "fallback" && !isCrtPlanGeometryValid(setup.direction, setup.plan)) {
    const outcome: SignalOutcome = {
      status: "not-triggered",
      entryTouched: false,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesTracked: 0,
      summary: "Plan geometrisi geçersiz: stop veya DOL entry'nin yanlış tarafında. Setup işlem adayı değildir."
    };
    return { stage: "invalidated", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "invalidated") };
  }
  if (setup.eqConsumed) {
    const outcome: SignalOutcome = {
      status: "missed",
      entryTouched: false,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesTracked: 0,
      summary: `Raid sonrası CRT %50/EQ ${formatPrice(anchor.range.midpoint)} görüldü; setup tüketildi ve yeni giriş aranmaz.`
    };
    return { stage: "missed", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "missed") };
  }
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
    // Master §6: lifecycle tam zinciriyle kanıt olarak sunulur (yalnız "ready mi" değil).
    { id: "crt-lifecycle", label: "CRT Lifecycle", status: setup.lifecycleState === "INVALIDATED" ? "fail" : setup.lifecycleState === "CONFIRMED" || setup.lifecycleState === "COMPLETED" || setup.lifecycleState.startsWith("TARGETING") ? "pass" : "neutral", detail: `${setup.lifecycleState} — Master §6 zinciri: CANDIDATE → ACTIVE_RANGE → SIDE_SWEPT → RETURNED_INSIDE → CONFIRMATION_PENDING → CONFIRMED → TARGETING_MIDPOINT/OPPOSITE → COMPLETED.`, timeframe: anchor.spec.rangeTf },
    { id: "crt-bias", label: "CRT Bias / DOL", status: bias.direction === setup.direction ? "pass" : "neutral", detail: bias.summary, timeframe: anchor.spec.rangeTf, price: bias.drawLevel },
    { id: "htf-alignment", label: "HTF Yön Uyumu", status: setup.htfAlignment.fullyAligned ? "pass" : setup.htfAlignment.aligned ? "neutral" : setup.reversalAtExternalHtf ? "warning" : "fail", detail: setup.reversalAtExternalHtf ? `${setup.htfAlignment.summary} Karşı-HTF dönüş istisnası aktif (haftalık external likidite süpürüldü).` : setup.htfAlignment.summary, timeframe: setup.htfAlignment.required[0] },
    { id: "crt-range", label: `${anchor.spec.rangeTf.toUpperCase()} Candle Range`, status: "pass", detail: anchor.range.source, timeframe: anchor.spec.rangeTf, price: anchor.range.midpoint },
    { id: "reference-candle", label: "Reference Candle", status: !setup.referenceCandle ? "neutral" : setup.referenceCandle.grade === "A" || setup.referenceCandle.grade === "B" ? "pass" : "warning", detail: setup.referenceCandle ? `reference_candle_score ${setup.referenceCandle.score}/100 (${setup.referenceCandle.grade}). ${setup.referenceCandle.reasons[0]}` : "Range mumu skorlanamadı.", timeframe: anchor.spec.rangeTf, price: anchor.range.midpoint },
    { id: "directional-bias", label: "Directional Bias", status: !setup.directionalBias ? "neutral" : setup.directionalBias.direction === "neutral" ? "neutral" : (setup.directionalBias.direction === "bullish" ? "long" : "short") === setup.direction ? "pass" : "warning", detail: setup.directionalBias ? `bullish ${setup.directionalBias.bullishScore} / bearish ${setup.directionalBias.bearishScore} → ${setup.directionalBias.direction} (güven ${setup.directionalBias.confidence}). ${setup.directionalBias.summary}` : "Bias skorlanamadı.", timeframe: anchor.spec.rangeTf, price: setup.directionalBias?.externalDraw?.level },
    { id: "valid-pullback", label: "Valid Pullback", status: validCrtPullback(anchor.rangeCandles, setup.direction).valid ? "pass" : "neutral", detail: validCrtPullback(anchor.rangeCandles, setup.direction).summary, timeframe: anchor.spec.rangeTf },
    { id: "poi", label: "POI", status: setup.poi ? "pass" : "neutral", detail: setup.poi ? `${setup.poi.label} kalite bonusu olarak map edildi.` : "FVG/OB yok; ChoCH kapanışı varsa CRT yine geçerlidir.", timeframe: anchor.spec.confirmTf, candleIndex: setup.poi?.candleIndex, price: setup.poi?.midpoint },
    { id: "manipulation", label: "Manipulation", status: setup.manipulation ? "pass" : "fail", detail: setup.manipulation ? `${anchor.spec.rangeTf.toUpperCase()} CRT ${setup.direction === "short" ? "high" : "low"} wick ile alındı; HTF kapanışı şart değil.` : `${anchor.spec.rangeTf.toUpperCase()} CRT high/low raid yok.`, timeframe: anchor.spec.rangeTf, candleIndex: setup.manipulation?.candleIndex, price: setup.manipulation?.level },
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
    { id: "entry", label: "Entry", status: setup.plan.entryStatus === "confirmed" ? "pass" : "fail", detail: typeof setup.retestIndex === "number" ? `ChoCH sonrası ${formatPrice(setup.plan.entry)} retest entry görüldü.` : setup.choch ? `Kapalı ChoCH mumundan ${formatPrice(setup.plan.entry)} entry aktif; retest şart değil.` : "ChoCH kapanışı gelmeden entry yok.", timeframe: anchor.spec.confirmTf, candleIndex: setup.retestIndex ?? setup.choch?.candleIndex, time: anchor.liveConfirmCandles[setup.retestIndex ?? setup.choch?.candleIndex ?? -1]?.time, price: setup.plan.entry },
    { id: "eq-management", label: "EQ / TP1", status: "neutral", detail: `Tam çıkış hedefi EQ ${formatPrice(setup.plan.targets[0])}; DOL beklenmez (Hepsi-EQ yönetimi).`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[0] },
    { id: "dol-target", label: "DOL / TP2", status: setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning", detail: `Final DOL target ${formatPrice(setup.plan.targets[1])}, RR ${formatR(setup.plan.rr)}.`, timeframe: anchor.spec.rangeTf, price: setup.plan.targets[1] }
  ];
}

// Owner kuralı (2026-07-26): "sweep gördük diye otomatik ters işlem aramayacağız." Güçlü HTF
// trend + fiyatın swept range kenarının ÖTESİNDE kapanışla KABUL görmesi (reclaim yok) =
// continuation bağlamı; CRT reversal orada bastırılır (gösterilmez), trend-continuation playbook'u
// devralır. Reclaim'e dayalı gerçek CRT dönüşleri ETKİLENMEZ (onlarda fiyat range'e geri döner,
// kabul yoktur) — yani ölçülmüş "reversal-at-external-liquidity" edge'i korunur; yalnız
// kabul-edilmiş (fiyat geçip tutundu) karşı-trend fade'ler elenir.
function continuationAcceptanceSuppresses(context: MarketContext, anchor: AnchorCtx, setup: CrtSetup): boolean {
  // Yalnız HTF anchor'lara uygula (1d/1w = trendi tanımlayan büyük range'ler). 4h/1h taktik
  // raid'ler HTF trende karşı küçük düzeltmelerdir; onları CRT meşru fade eder, continuation
  // playbook'u HTF trendi taşır. Owner örneği (USDCHF) 1W range idi.
  if (anchor.spec.rangeTf !== "1d" && anchor.spec.rangeTf !== "1w") return false;
  const daily = context.biasDetail?.daily;
  if (!daily || daily.confidence !== "strong" || daily.bias === "neutral") return false;
  const dailyDir: TradeDirection = daily.bias === "bullish" ? "long" : "short";
  if (dailyDir === setup.direction) return false;          // reversal trend YÖNÜNDE — with-trend, dokunma
  const lastClose = anchor.confirmCandles.at(-1)?.close;
  if (typeof lastClose !== "number") return false;
  // Fiyat swept kenarın ötesinde kapanışla tutunuyor mu? short: range high üstü, long: range low altı.
  // Bu kontrol zaten reclaim-and-back-inside (geçerli dönüş) durumlarını dışlar: gerçek bir CRT
  // dönüşünde fiyat range'e geri dönmüştür (short için lastClose < rangeHigh), o yüzden bastırılmaz.
  return setup.direction === "short" ? lastClose > anchor.range.high : lastClose < anchor.range.low;
}

function signalFromAnchor(context: MarketContext, settings: StrategyInput["settings"], anchor: AnchorCtx): TradingSignal | undefined {
  const setup = buildAnchorSetup(context, settings, anchor);
  // Every anchor timeframe (4h/1d/1w) that produces a direction is surfaced — a directional
  // bias with a defined range is a live "raid bekleniyor" read, not noise. directionForAnchor
  // already returns undefined when no raid and no directional bias exist, so a pair with no
  // read on a timeframe simply yields nothing there.
  if (!setup) return undefined;
  // Kabul-edilmiş karşı-trend fade'i bastır (owner 2026-07-26): trend güçlü ve fiyat kenarın
  // ötesinde kabul görmüşse bu reversal değil, continuation'dır.
  if (continuationAcceptanceSuppresses(context, anchor, setup)) return undefined;
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
      setupPhase: setup.setupPhase,
      // Stage invalidated ise lifecycle de dürüstçe INVALIDATED olur (Master §6).
      lifecycleState: life.stage === "invalidated" ? "INVALIDATED" : setup.lifecycleState,
      crtState: deriveCrtState(setup, life.stage, life.outcome.status, anchor.origin?.kind === "active-crt" ? anchor.origin.closed : true),
      biasDirection: setup.directionalBias?.direction,
      biasBullishScore: setup.directionalBias?.bullishScore,
      biasBearishScore: setup.directionalBias?.bearishScore,
      biasConfidence: setup.directionalBias?.confidence,
      biasExternalDraw: setup.directionalBias?.externalDraw?.label,
      referenceCandleScore: setup.referenceCandle?.score,
      referenceCandleGrade: setup.referenceCandle?.grade,
      turtleSoup: Boolean(setup.turtleSoup)
    }
  };
}

// Master §6: derive the CRT lifecycle state from the setup facts + realized outcome.
function deriveCrtState(setup: CrtSetup, stage: TradingSignal["stage"], outcomeStatus: SignalOutcome["status"], originClosed: boolean): CrtState {
  if (outcomeStatus === "tp2") return "COMPLETED";
  if (stage === "invalidated" || outcomeStatus === "stopped") return "INVALIDATED";
  if (outcomeStatus === "tp1") return "TARGETING_OPPOSITE_EXTREME";
  if (outcomeStatus === "open") return "TARGETING_MIDPOINT";
  if (setup.plan.entryStatus === "confirmed") return "CONFIRMED";
  if (setup.choch) return "CONFIRMATION_PENDING";
  if (setup.manipulation?.reclaimed) return "RETURNED_INSIDE";
  if (setup.manipulation) return "SIDE_SWEPT";
  if (!originClosed) return "CANDIDATE";
  return "ACTIVE_RANGE";
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

const RANGE_TF_RANK: Record<string, number> = { "4h": 0, "1d": 1, "1w": 2, "1h": 3 };

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

// Test erişimi: kabul-bastırma saf fonksiyonu doğrudan doğrulanabilsin.
export const __crtInternals = { continuationAcceptanceSuppresses };

export const crtStrategy: StrategyModule = {
  id: CRT_STRATEGY_ID,
  name: "CRT Candle Range",
  description: "Candle Range Theory: range, tek taraflı manipulation, LTF dağılım kapanışı ve karşı range kenarı hedefi.",
  requiredTimeframes: ["1M", "1w", "1d", "4h", "1h", "15m", "5m"],
  defaultSettings: {
    minimumRR: 1.5,
    mode: "watch_ready",
    useExecutionCosts: true,
    slippageStress: "normal",
    noAutoExecution: true,
    useHtfAlignmentFilter: true,
    exitModel: "eq-full",
    // Owner decision 2026-07-22: 1H→5M anchor promoted to LIVE (produces READY + alerts),
    // consciously overriding the 30-trade rule on the demo-window result (PF 2.94). Same
    // quality gates apply; RANGE_TF_RANK keeps 1H sorted last so it only surfaces when it is
    // the best available signal. Revert to "tracking" to demote.
    intradayAnchorMode: "tracking"
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
