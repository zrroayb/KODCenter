import type { DemoMarket } from "../../data/demoData";
import {
  equityCurveFromReturns,
  maxDrawdown,
  type BacktestResult,
  type RuntimeReplayCalibration,
  type RuntimeReplayCandidate,
  type RuntimeReplayFailureCase,
  type RuntimeReplayFilterScenario,
  type RuntimeReplayManagementScenario,
  type RuntimeReplayOutcomeReason,
  type RuntimeReplayReviewMeasurements,
  type RuntimeReplaySetupBreakdown,
  type RuntimeReplayTrade
} from "../analytics/performance";
import { aggregateCandles, trimCandles } from "../data/candleAggregation";
import { executableClose, executableHigh, executableLow } from "../data/bidAsk";
import type { Candle, MarketContext, MarketSymbol, Timeframe, TradingSignal } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";
import { buildMarketContext, type MarketTimeframes } from "../intelligence/marketContext";
import { attachSmtDivergences } from "../intelligence/smtEngine";
import { closeConfirmationRequirement, entryRetestRequirement } from "../signals/waitingGuidance";
import type { StrategyModule, StrategySettings } from "../strategies/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MAX_HOLD_CANDLES = 96;
const DEFAULT_SCAN_EVERY_CANDLES = 4;
const SETUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// No daily trade-count cap: the only daily risk brake is the -2R stop. A symbol still
// takes at most one entry per day to avoid re-entering the same setup.
const REPLAY_MAX_SYMBOL_DAILY_TRADES = 1;
const REPLAY_MAX_ENTRIES_PER_SCAN = 1;
const REPLAY_DAILY_STOP_R = -2;
const MIN_REPLAY_RULE_TRADES = 20;
const MIN_REPLAY_BUCKET_TRADES = 8;
const MIN_REPLAY_SCENARIO_TRADES = 12;

type SetupState = {
  lastSeen: number;
  countedWatch: boolean;
  countedReady: boolean;
};

type DayRiskState = {
  trades: number;
  r: number;
  symbols: Record<string, number>;
};

type ReplayEntryCandidate = {
  signal: TradingSignal;
  time: number;
  state: SetupState;
  rank: number;
};

type ReplayOutcome = Pick<RuntimeReplayTrade, "status" | "rMultiple" | "maxFavorableR" | "maxAdverseR" | "candlesHeld" | "outcomeReason" | "tags" | "note" | "managementVariants" | "unfilledCounterfactualR">;

// A retest limit order that has not filled within ~16 confirmation-TF bars is cancelled.
// Future candles are m15, so patience and hold duration scale with the signal's
// confirmation timeframe: a 1H-confirm setup gets 4x, a 4H-confirm setup 16x.
const ENTRY_FILL_TIMEOUT_CANDLES = 16;

function confirmTfFactor(signal: TradingSignal): number {
  const tf = signal.crtAnchor?.confirmTf;
  return tf === "4h" ? 16 : tf === "1h" ? 4 : 1;
}

export type RuntimeReplayInput = {
  markets: DemoMarket[];
  strategy: StrategyModule;
  settings: StrategySettings;
  windowDays?: number;
  maxHoldCandles?: number;
  scanEveryCandles?: number;
};

function executionCandles(market: DemoMarket): Candle[] {
  return market.timeframes.m15.length ? market.timeframes.m15 : market.timeframes.m5;
}

function latestReplayTime(markets: DemoMarket[]): number {
  return Math.max(...markets.flatMap((market) => executionCandles(market).slice(-1).map((candle) => candle.time + 15 * 60 * 1000)), 0);
}

function earliestReplayTime(markets: DemoMarket[]): number {
  const firstTimes = markets.flatMap((market) => executionCandles(market).slice(0, 1).map((candle) => candle.time + 15 * 60 * 1000));
  return firstTimes.length ? Math.min(...firstTimes) : 0;
}

function candleCloseTime(time: number, timeframe: Timeframe): number {
  if (timeframe === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  if (timeframe === "1w") return time + 7 * DAY_MS;
  if (timeframe === "1d") return time + DAY_MS;
  if (timeframe === "4h") return time + 4 * 60 * 60 * 1000;
  if (timeframe === "1h") return time + 60 * 60 * 1000;
  if (timeframe === "15m") return time + 15 * 60 * 1000;
  return time + 5 * 60 * 1000;
}

function sliceByTime(candles: Candle[], time: number, count: number, timeframe: Timeframe): Candle[] {
  return trimCandles(
    candles
      .filter((candle) => candleCloseTime(candle.time, timeframe) <= time)
      .map((candle) => ({ ...candle, closed: true })),
    count
  );
}

function timeframesAt(market: DemoMarket, time: number): MarketTimeframes {
  const m15 = sliceByTime(market.timeframes.m15, time, 220, "15m");
  const h1 = sliceByTime(market.timeframes.h1, time, 180, "1h");
  const h4 = sliceByTime(market.timeframes.h4, time, 140, "4h");
  const daily = sliceByTime(market.timeframes.daily, time, 220, "1d");
  const weekly = sliceByTime(market.timeframes.weekly, time, 80, "1w");
  const monthly = sliceByTime(market.timeframes.monthly, time, 24, "1M");
  const m5 = sliceByTime(market.timeframes.m5, time, 220, "5m");
  return {
    monthly: monthly.length ? monthly : trimCandles(aggregateCandles(daily, "1M"), 24),
    weekly: weekly.length ? weekly : trimCandles(aggregateCandles(daily, "1w"), 80),
    daily,
    h4: h4.length ? h4 : trimCandles(aggregateCandles(h1, "4h"), 140),
    h1: h1.length ? h1 : trimCandles(aggregateCandles(m15, "1h"), 180),
    m15,
    m5
  };
}

function enoughWarmup(context: MarketContext): boolean {
  return context.timeframes.m15.length >= 80 && context.timeframes.h1.length >= 30 && context.timeframes.h4.length >= 12 && context.timeframes.daily.length >= 20 && context.timeframes.weekly.length >= 3;
}

function enoughWarmupTimeframes(timeframes: MarketTimeframes): boolean {
  return timeframes.m15.length >= 80 && timeframes.h1.length >= 30 && timeframes.h4.length >= 12 && timeframes.daily.length >= 20 && timeframes.weekly.length >= 3;
}

function replayTimes(markets: DemoMarket[], startedAt: number, endedAt: number, scanEveryCandles: number): number[] {
  const allTimes = Array.from(new Set(
    markets.flatMap((market) =>
      executionCandles(market)
        .filter((candle) => candle.time >= startedAt && candle.time <= endedAt)
        .map((candle) => candle.time + 15 * 60 * 1000)
    )
  )).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(scanEveryCandles));
  return allTimes.filter((_, index) => index % step === 0 || index === allTimes.length - 1);
}

function roundedLevel(value: number, symbol: MarketSymbol): string {
  // Level-dedupe precision by quote scale: sub-10 quotes need pip-level decimals, big
  // quotes only whole-ish levels. Fall back to the price magnitude for new symbols.
  const decimals = symbol === "EURUSD" || symbol === "GBPUSD" || symbol === "AUDUSD" || symbol === "USDCHF"
    ? 5
    : symbol === "BTCUSD" || symbol === "ETHUSD" || symbol === "BNBUSD" || symbol === "NAS100"
      ? 1
      : symbol === "XRPUSD"
        ? 4
        : symbol === "USDJPY"
          ? 3
          : 2;
  return value.toFixed(decimals);
}

function setupKey(signal: TradingSignal): string {
  return [
    signal.symbol,
    signal.direction,
    signal.plan.entrySource,
    signal.plan.stopSource,
    signal.plan.targetSource,
    signalAnchorZone(signal),
    signal.context.regime.type
  ].join("|");
}

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function dayStateFor(states: Map<string, DayRiskState>, time: number): DayRiskState {
  const key = dayKey(time);
  const state = states.get(key) ?? { trades: 0, r: 0, symbols: {} };
  states.set(key, state);
  return state;
}

function canTakeReplayEntry(state: DayRiskState, signal: TradingSignal): boolean {
  if (state.r <= REPLAY_DAILY_STOP_R) return false;
  if ((state.symbols[signal.symbol] ?? 0) >= REPLAY_MAX_SYMBOL_DAILY_TRADES) return false;
  return true;
}

function applyReplayRisk(state: DayRiskState, signal: TradingSignal, outcome: ReplayOutcome) {
  state.trades += 1;
  state.r = Number((state.r + outcome.rMultiple).toFixed(2));
  state.symbols[signal.symbol] = (state.symbols[signal.symbol] ?? 0) + 1;
}

function futureCandlesForSignal(market: DemoMarket, signalTime: number, maxHoldCandles: number): Candle[] {
  return executionCandles(market)
    .filter((candle) => candle.time >= signalTime)
    .slice(0, maxHoldCandles);
}

function priceTouched(candle: Candle, level: number): boolean {
  return candle.low <= level && candle.high >= level;
}

function rAtPrice(signal: TradingSignal, price: number): number {
  const risk = Math.max(signal.plan.riskDistance, 0.000001);
  return signal.direction === "short"
    ? (signal.plan.entry - price) / risk
    : (price - signal.plan.entry) / risk;
}

function expiryCloseR(signal: TradingSignal, candles: Candle[]): number {
  const last = candles[candles.length - 1];
  if (!last) return 0;
  const exitSide = signal.direction === "short" ? "buy" : "sell";
  return Number(Math.max(-1, rAtPrice(signal, executableClose(last, exitSide))).toFixed(2));
}

function targetR(signal: TradingSignal, targetIndex: 0 | 1): number {
  const target = signal.plan.targets[targetIndex] ?? signal.plan.targets[0] ?? signal.plan.entry;
  return Math.max(0, Math.abs(target - signal.plan.entry) / Math.max(signal.plan.riskDistance, 0.000001));
}

function stopHit(signal: TradingSignal, candle: Candle): boolean {
  return signal.direction === "short"
    ? executableHigh(candle, "buy") >= signal.plan.stopLoss
    : executableLow(candle, "sell") <= signal.plan.stopLoss;
}

function targetHit(signal: TradingSignal, candle: Candle, targetIndex: 0 | 1): boolean {
  const target = signal.plan.targets[targetIndex];
  if (typeof target !== "number") return false;
  return signal.direction === "short"
    ? executableLow(candle, "buy") <= target
    : executableHigh(candle, "sell") >= target;
}

function breakevenHit(signal: TradingSignal, candle: Candle): boolean {
  return signal.direction === "short"
    ? executableHigh(candle, "buy") >= signal.plan.entry
    : executableLow(candle, "sell") <= signal.plan.entry;
}

function expectedBias(signal: TradingSignal) {
  return signal.direction === "short" ? "bearish" : "bullish";
}

function expectedPd(signal: TradingSignal) {
  return signal.direction === "short" ? "premium" : "discount";
}

function signalAnchorZone(signal: TradingSignal): "premium" | "discount" {
  const midpoint = signal.crtAnchor
    ? (signal.crtAnchor.rangeHigh + signal.crtAnchor.rangeLow) / 2
    : signal.context.premiumDiscount.midpoint;
  return signal.plan.entry >= midpoint ? "premium" : "discount";
}

function replaySessionClassification(signal: TradingSignal) {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const manipulation = signal.evidence.find((item) => item.id === "manipulation")?.status === "pass";
  if (activeSession === "London") {
    return {
      reference: "ASIA",
      trigger: "LONDON",
      model: manipulation
        ? signal.direction === "long"
          ? "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT"
          : "ASIA_RANGE_LONDON_HIGH_SWEEP_BEARISH_CRT"
        : signal.direction === "long"
          ? "ASIA_RANGE_LONDON_BULLISH_CONTINUATION"
          : "ASIA_RANGE_LONDON_BEARISH_CONTINUATION"
    };
  }
  if (activeSession === "New York AM") {
    return {
      reference: "LONDON",
      trigger: "NY_AM",
      model: manipulation
        ? signal.direction === "long"
          ? "LONDON_RANGE_NY_LOW_SWEEP_BULLISH_CRT"
          : "LONDON_RANGE_NY_HIGH_SWEEP_BEARISH_CRT"
        : signal.direction === "long"
          ? "LONDON_EXPANSION_NY_BULLISH_CONTINUATION"
          : "LONDON_EXPANSION_NY_BEARISH_CONTINUATION"
    };
  }
  return { reference: "NONE", trigger: activeSession.toUpperCase().replace(/\s+/g, "_"), model: "CRT_SESSION_UNCLASSIFIED" };
}

function tradeTags(signal: TradingSignal): string[] {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const session = replaySessionClassification(signal);
  const expected = expectedBias(signal);
  const crtDirection = signal.context.crt.selectedBias.direction;
  const crtAligned = crtDirection === signal.direction;
  return Array.from(new Set([
    `grade:${signal.grade}`,
    `entry:${signal.plan.entrySource}`,
    `entry-status:${signal.plan.entryStatus}`,
    `stop:${signal.plan.stopSource}`,
    `target:${signal.plan.targetSource}`,
    `crt:${signal.context.crt.selectedBias.kind}`,
    signal.context.crt.validPullback ? "pullback:valid" : "pullback:invalid",
    signal.evidence.find((item) => item.id === "poi")?.status === "pass" ? "poi:mapped" : "poi:missing",
    signal.plan.entryModel.retested ? "retest:yes" : "retest:no",
    signal.evidence.find((item) => item.id === "manipulation")?.status === "pass" ? "manipulation:yes" : "manipulation:no",
    signal.evidence.find((item) => item.id === "choch")?.status === "pass" ? "choch:yes" : "choch:no",
    `session:${activeSession}`,
    `session-route:${session.reference}->${session.trigger}`,
    `session-model:${session.model}`,
    `pd:${signalAnchorZone(signal)}`,
    `regime:${signal.context.regime.type}`,
    `event:${signal.context.eventRisk.level}`,
    signal.context.smtDivergences.some((item) => item.direction === signal.direction) ? "smt:aligned" : "smt:none",
    signalAnchorZone(signal) === expectedPd(signal) ? "pd:aligned" : "pd:mismatch",
    crtAligned || signal.context.bias.daily === expected || signal.context.bias.h4 === expected ? "htf:aligned" : "htf:conflict",
    // Master §8 açık sorusu: yön anchor'dan mı yoksa iki-taraflı bias motorundan mı gelmeli?
    // Kural defteri "bias per-anchor yönü HENÜZ geçersiz kılmaz" diyor; bu tag o "henüz"ü
    // ölçülebilir yapar — bias yönü setup yönüne KARŞI olan işlemler ayrı ölçülür.
    signal.crtAnchor?.biasDirection && signal.crtAnchor.biasDirection !== "neutral"
      && (signal.crtAnchor.biasDirection === "bullish" ? "long" : "short") !== signal.direction
      ? "bias:opposes" : "bias:not-opposing",
    signal.plan.rr >= 2 ? "rr:2plus" : signal.plan.rr >= 1.5 ? "rr:ok" : "rr:low",
    signal.governance.status === "allow" ? "governance:allow" : `governance:${signal.governance.status}`
  ]));
}

// ── 30+ işlem incelemesi ölçümleri (kural değil, veri toplama — analiz 2026-07-21) ──────────

// Korelasyon kümeleri ve USD-normalize yön: EURUSD short ≈ USDJPY long ≈ usd-long.
// Kripto kümesi kendi betasına normalize edilir (BTC long ≈ ETH long ≈ crypto-long).
const SYMBOL_CLUSTERS: Record<string, { cluster: string; usdInverse: boolean }> = {
  EURUSD: { cluster: "dollar-fx", usdInverse: true },
  GBPUSD: { cluster: "dollar-fx", usdInverse: true },
  AUDUSD: { cluster: "dollar-fx", usdInverse: true },
  USDJPY: { cluster: "dollar-fx", usdInverse: false },
  USDCHF: { cluster: "dollar-fx", usdInverse: false },
  XAUUSD: { cluster: "metal", usdInverse: true },
  NAS100: { cluster: "index", usdInverse: true },
  BTCUSD: { cluster: "crypto", usdInverse: true },
  ETHUSD: { cluster: "crypto", usdInverse: true },
  XRPUSD: { cluster: "crypto", usdInverse: true },
  BNBUSD: { cluster: "crypto", usdInverse: true },
  SOLUSD: { cluster: "crypto", usdInverse: true }
};

function clusterExposure(symbol: string, direction: string): { cluster: string; exposure: string } {
  const spec = SYMBOL_CLUSTERS[symbol] ?? { cluster: "other", usdInverse: true };
  if (spec.cluster === "crypto") {
    return { cluster: spec.cluster, exposure: direction === "long" ? "crypto-long" : "crypto-short" };
  }
  const usdLong = spec.usdInverse ? direction === "short" : direction === "long";
  return { cluster: spec.cluster, exposure: usdLong ? "usd-long" : "usd-short" };
}

function buildReviewMeasurements(trades: RuntimeReplayTrade[]): RuntimeReplayReviewMeasurements {
  const triggered = trades.filter((trade) => trade.status !== "not-triggered");
  const eqRrValues = triggered.map((trade) => trade.eqRR).filter((value) => Number.isFinite(value));
  const eqRr = {
    sample: eqRrValues.length,
    mean: eqRrValues.length ? Number((eqRrValues.reduce((sum, value) => sum + value, 0) / eqRrValues.length).toFixed(2)) : 0,
    below1: eqRrValues.filter((value) => value < 1).length,
    below1_5: eqRrValues.filter((value) => value < 1.5).length
  };

  const clusterGroups = new Map<string, { day: string; cluster: string; exposure: string; symbols: Set<string>; trades: number; totalR: number }>();
  for (const trade of triggered) {
    const { cluster, exposure } = clusterExposure(trade.symbol, trade.direction);
    const day = dayKey(trade.signalTime);
    const key = `${day}:${cluster}:${exposure}`;
    const group = clusterGroups.get(key) ?? { day, cluster, exposure, symbols: new Set<string>(), trades: 0, totalR: 0 };
    group.symbols.add(trade.symbol);
    group.trades += 1;
    group.totalR += trade.rMultiple;
    clusterGroups.set(key, group);
  }
  const clusterDays = [...clusterGroups.values()]
    .filter((group) => group.trades >= 2)
    .sort((a, b) => b.trades - a.trades || Math.abs(b.totalR) - Math.abs(a.totalR))
    .map((group) => ({ ...group, symbols: [...group.symbols].sort(), totalR: Number(group.totalR.toFixed(2)) }));

  const bucketize = <T extends string>(keyOf: (trade: RuntimeReplayTrade) => T) => {
    const buckets = new Map<T, { trades: number; totalR: number }>();
    for (const trade of triggered) {
      const key = keyOf(trade);
      const bucket = buckets.get(key) ?? { trades: 0, totalR: 0 };
      bucket.trades += 1;
      bucket.totalR += trade.rMultiple;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        trades: bucket.trades,
        totalR: Number(bucket.totalR.toFixed(2)),
        expectancyR: Number((bucket.totalR / bucket.trades).toFixed(2))
      }))
      .sort((a, b) => b.trades - a.trades);
  };

  const unfilledTrades = trades.filter((trade) => trade.status === "not-triggered");
  const withCf = unfilledTrades.filter((trade) => typeof trade.unfilledCounterfactualR === "number");
  const cfTotalR = withCf.reduce((sum, trade) => sum + (trade.unfilledCounterfactualR ?? 0), 0);
  const unfilled = {
    count: unfilledTrades.length,
    withCounterfactual: withCf.length,
    cfTotalR: Number(cfTotalR.toFixed(2)),
    cfAvgR: withCf.length ? Number((cfTotalR / withCf.length).toFixed(2)) : 0,
    cfWins: withCf.filter((trade) => (trade.unfilledCounterfactualR ?? 0) > 0).length
  };

  return {
    eqRr,
    clusterDays,
    gradeBuckets: bucketize((trade) => trade.grade).map(({ key, ...rest }) => ({ grade: key, ...rest })),
    killzoneBuckets: bucketize((trade) => trade.session).map(({ key, ...rest }) => ({ session: key, ...rest })),
    unfilled
  };
}

// Çekirdek ve 1H izleme hattının ortak trade kurucusu: gelecek mumlar, sonuç değerlendirmesi
// ve trade kaydı tek yerden — iki hat farklı alan setiyle ayrışamaz.
function buildMeasuredReplayTrade(
  signal: TradingSignal,
  time: number,
  market: DemoMarket | undefined,
  maxHoldCandles: number,
  settings: StrategySettings,
  baseTags: string[]
): { trade: RuntimeReplayTrade; outcome: ReplayOutcome } {
  const adjustedFuture = confirmationAdjustedFuture(
    signal,
    market ? futureCandlesForSignal(market, time, maxHoldCandles * confirmTfFactor(signal)) : []
  );
  const outcome = evaluateForwardOutcome(signal, adjustedFuture.candles, [...baseTags, ...adjustedFuture.tags], settings);
  const measuredOutcome = adjustedFuture.missingNote
    ? noTriggerOutcome(signal, [...baseTags, ...adjustedFuture.tags], adjustedFuture.missingNote)
    : outcome;
  const trade: RuntimeReplayTrade = {
    id: `${signal.id}-${time}-replay`,
    symbol: signal.symbol,
    direction: signal.direction,
    signalTime: time,
    ...tradeProfile(signal, "live-ready"),
    grade: signal.grade,
    score: signal.score,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    target: signal.plan.targets[1] ?? signal.plan.targets[0] ?? signal.plan.entry,
    eqRR: Number((Math.abs(signal.plan.entry - (signal.plan.targets[0] ?? signal.plan.entry))
      / Math.max(signal.plan.riskDistance, 1e-9)).toFixed(2)),
    ...measuredOutcome
  };
  return { trade, outcome: measuredOutcome };
}

function tradeProfile(signal: TradingSignal, origin: RuntimeReplayTrade["origin"]) {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const session = replaySessionClassification(signal);
  return {
    origin,
    rr: signal.plan.rr,
    entrySource: signal.plan.entrySource,
    entryStatus: signal.plan.entryStatus,
    stopSource: signal.plan.stopSource,
    targetSource: signal.plan.targetSource,
    session: activeSession,
    sessionReference: session.reference,
    sessionTrigger: session.trigger,
    sessionModel: session.model,
    premiumDiscount: signalAnchorZone(signal),
    dailyBias: signal.context.bias.daily,
    h4Bias: signal.context.bias.h4,
    h1Bias: signal.context.bias.h1,
    regime: signal.context.regime.type,
    eventRisk: signal.context.eventRisk.level,
    governance: signal.governance.status,
    actionWindow: signal.actionWindow.status,
    dataConfidence: signal.context.dataConfidence.score,
    setupWarnings: Array.from(new Set([
      ...signal.plan.planWarnings,
      ...signal.riskWarnings,
      ...signal.context.regime.warnings,
      ...signal.context.eventRisk.warnings,
      ...signal.context.dataConfidence.warnings
    ])).slice(0, 8),
    waitReasons: candidateReasons(signal)
  };
}

function stoppedReason(signal: TradingSignal, maxFavorableR: number): RuntimeReplayOutcomeReason {
  if (signal.context.eventRisk.level !== "clear") return "event-risk";
  if (signal.context.regime.tradeability !== "good" || signal.context.regime.type === "chop" || signal.context.regime.type === "news-expansion") return "range-chop";
  if (signal.context.crt.selectedBias.direction !== signal.direction && signal.context.bias.daily !== expectedBias(signal) && signal.context.bias.h4 !== expectedBias(signal)) return "htf-conflict";
  if (signal.context.bias.h4 !== expectedBias(signal) || signal.context.bias.daily !== expectedBias(signal)) return "partial-htf-conflict";
  if (signal.plan.stopSource === "volatility-floor" || maxFavorableR < 0.25) return "stop-too-tight";
  if (maxFavorableR >= 0.4) return "no-follow-through";
  return "unknown";
}

// One walk over the same candles answers "would a different management rule have paid
// more?" — the AI replay review compares these instead of guessing. Event order inside a
// candle stays conservative (BE scratch and stop before targets), matching the live model.
function crtManagementVariants(signal: TradingSignal, afterEntry: Candle[]): RuntimeReplayTrade["managementVariants"] {
  const eqR = targetR(signal, 0);
  const dolR = targetR(signal, 1);
  let armed = false;
  let maxFavorableR = 0;
  let firstStop = -1;
  let firstEq = -1;
  let firstDol = -1;
  let firstBeScratch = -1;
  let firstEntryAfterEq = -1;
  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    // Arming comes from PREVIOUS candles' extremes, like the live model.
    if (firstBeScratch < 0 && armed && priceTouched(candle, signal.plan.entry)) firstBeScratch = index;
    if (firstStop < 0 && stopHit(signal, candle)) firstStop = index;
    if (firstDol < 0 && targetHit(signal, candle, 1)) firstDol = index;
    if (firstEq < 0 && targetHit(signal, candle, 0)) firstEq = index;
    if (firstEq >= 0 && index > firstEq && firstEntryAfterEq < 0 && priceTouched(candle, signal.plan.entry)) firstEntryAfterEq = index;
    const highR = rAtPrice(signal, executableHigh(candle, signal.direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(signal, executableLow(candle, signal.direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    if (maxFavorableR >= 1) armed = true;
  }
  const before = (a: number, b: number) => a >= 0 && (b < 0 || a <= b);
  const expiredR = expiryCloseR(signal, afterEntry);

  // BE yok: EQ'da %50 realize, kalan yarım orijinal stopla DOL'u bekler.
  const noBe = before(firstStop, firstEq)
    ? -1
    : firstEq >= 0
      ? before(firstDol, firstStop)
        ? Number((0.5 * eqR + 0.5 * dolR).toFixed(2))
        : firstStop >= 0
          ? Number((0.5 * eqR - 0.5).toFixed(2))
          : Number((0.5 * eqR).toFixed(2))
      : expiredR;

  // Partial yok: tam pozisyon DOL hedefli, +1R sonrası stop BE'de.
  const fullDol = before(firstDol, firstStop) && before(firstDol, firstBeScratch)
    ? Number(dolR.toFixed(2))
    : before(firstBeScratch, firstStop)
      ? 0
      : firstStop >= 0
        ? -1
        : expiredR;

  // EQ %50 + BE (eski canlı model): EQ'da yarı realize, +1R sonrası stop BE; kalan yarım DOL'a.
  // Artık counterfactual olarak izlenir — 30+ trade incelemesinde geri dönüş kararı için.
  const eqPartialBe = before(firstBeScratch, firstEq) && before(firstBeScratch, firstStop)
    ? 0
    : before(firstStop, firstEq)
      ? -1
      : firstEq >= 0
        ? before(firstDol, firstEntryAfterEq)
          ? Number((0.5 * eqR + 0.5 * dolR).toFixed(2))
          : Number((0.5 * eqR).toFixed(2))
        : expiredR;

  return { noBe, fullDol, eqPartialBe };
}

function evaluateCrtForwardOutcome(signal: TradingSignal, afterEntry: Candle[], tags: string[], settings: StrategySettings = {}): ReplayOutcome {
  return {
    ...evaluateCrtForwardOutcomeCore(signal, afterEntry, tags, settings),
    managementVariants: crtManagementVariants(signal, afterEntry)
  };
}

function evaluateCrtForwardOutcomeCore(signal: TradingSignal, afterEntry: Candle[], tags: string[], settings: StrategySettings): ReplayOutcome {
  let maxFavorableR = 0;
  let maxAdverseR = 0;
  let eqHitIndex = -1;
  let breakevenArmed = false;
  const eqR = targetR(signal, 0);
  const dolR = targetR(signal, 1);
  const partialTpEnabled = settings.partialTpEnabled !== false;
  // Owner decision 2026-07-16: the primary exit is FULL close at EQ/TP1 — no DOL runner, no BE.
  // Measured on the same 12 entries: eq-full 11.85R vs the old EQ-partial+BE model's 6.12R.
  // The old model stays available via settings.exitModel = "eq-partial-be" and keeps being
  // measured as a management variant, so this stays reversible at the 30+ trade review.
  const exitModel = settings.exitModel === "eq-partial-be" ? "eq-partial-be" : "eq-full";
  const configuredBe = typeof settings.moveToBreakevenAtR === "number" ? settings.moveToBreakevenAtR : 1;
  const breakevenTriggerR = configuredBe > 0 ? configuredBe : Number.POSITIVE_INFINITY;

  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    // Once the trade has paid +1R, the stop lives at entry: a winner is never allowed to
    // become a full -1R loser. Armed from the previous candle's extreme (conservative).
    // (eq-partial-be only — the eq-full model never moves the stop.)
    if (exitModel === "eq-partial-be" && eqHitIndex < 0 && breakevenArmed && priceTouched(candle, signal.plan.entry)) {
      return {
        status: "stopped",
        rMultiple: 0,
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "be-scratch",
        tags: Array.from(new Set([...tags, "crt:be-scratch"])),
        note: "+1R sonrası stop BE'ye alındı; entry retest edildi, 0R scratch."
      };
    }
    const highR = rAtPrice(signal, executableHigh(candle, signal.direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(signal, executableLow(candle, signal.direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    maxAdverseR = Math.min(maxAdverseR, highR, lowR);
    if (maxFavorableR >= breakevenTriggerR) breakevenArmed = true;

    if (eqHitIndex < 0) {
      if (stopHit(signal, candle)) {
        return {
          status: "stopped",
          rMultiple: -1,
          maxFavorableR,
          maxAdverseR,
          candlesHeld: index + 1,
          outcomeReason: stoppedReason(signal, maxFavorableR),
          tags,
          note: "CRT entry sonrası stop, EQ görülmeden önce çalıştı."
        };
      }
      // eq-full: the FIRST target touch closes the whole position (a candle reaching DOL has
      // necessarily spanned EQ, so the conservative same-candle exit is EQ).
      if (exitModel === "eq-full" && targetHit(signal, candle, 0)) {
        return {
          status: "tp1",
          rMultiple: Number(eqR.toFixed(2)),
          maxFavorableR,
          maxAdverseR,
          candlesHeld: index + 1,
          outcomeReason: "eq-full",
          tags: Array.from(new Set([...tags, "crt:eq", "crt:eq-full"])),
          note: "Tam pozisyon EQ/TP1'de kapandı; DOL beklenmez (Hepsi-EQ yönetimi)."
        };
      }
      if (targetHit(signal, candle, 1)) {
        return {
          status: "tp2",
          rMultiple: Number((partialTpEnabled ? 0.5 * eqR + 0.5 * dolR : dolR).toFixed(2)),
          maxFavorableR,
          maxAdverseR,
          candlesHeld: index + 1,
          outcomeReason: "clean-model",
          tags: Array.from(new Set([...tags, "crt:eq", "crt:dol"])),
          note: "CRT DOL görüldü; EQ yönetimi + kalan pozisyon final hedef."
        };
      }
      if (targetHit(signal, candle, 0)) {
        if (partialTpEnabled) eqHitIndex = index;
        continue;
      }
      continue;
    }

    if (targetHit(signal, candle, 1)) {
      return {
        status: "tp2",
        rMultiple: Number((0.5 * eqR + 0.5 * dolR).toFixed(2)),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "clean-model",
        tags: Array.from(new Set([...tags, "crt:eq", "crt:dol"])),
        note: "CRT EQ sonrası DOL görüldü."
      };
    }
    if (breakevenHit(signal, candle)) {
      return {
        status: "tp1",
        rMultiple: Number((0.5 * eqR).toFixed(2)),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "eq-then-be",
        tags: Array.from(new Set([...tags, "crt:eq", "crt:be"])),
        note: "CRT EQ görüldü; yarı realize, kalan pozisyon BE."
      };
    }
  }

  if (eqHitIndex >= 0) {
    return {
      status: "tp1",
      rMultiple: Number((0.5 * eqR).toFixed(2)),
      maxFavorableR,
      maxAdverseR,
      candlesHeld: afterEntry.length,
      outcomeReason: "dol-missed",
      tags: Array.from(new Set([...tags, "crt:eq", "crt:dol-missed"])),
      note: "CRT EQ görüldü fakat DOL süre içinde gelmedi; kalan BE kabul edildi."
    };
  }

  return {
    status: "open",
    rMultiple: expiryCloseR(signal, afterEntry),
    maxFavorableR,
    maxAdverseR,
    candlesHeld: afterEntry.length,
    outcomeReason: "expired",
    tags,
    note: `CRT süre doldu; EQ/DOL görülmedi. Pozisyon pencere sonu executable close ile değerlendi. Max ${maxFavorableR.toFixed(2)}R, adverse ${maxAdverseR.toFixed(2)}R.`
  };
}

// Dolmayan/geciken retest emrinin karşı-olgusu: sinyal anındaki ilk mumun açılışından, aynı
// stop ve hedeflerle girilseydi ne öderdi. %48 dolmama sızıntısının maliyetini ölçer; hiçbir
// gerçek sonucu değiştirmez, yalnız `unfilledCounterfactualR` alanına yazılır.
function unfilledEntryCounterfactualR(signal: TradingSignal, futureCandles: Candle[], settings: StrategySettings): number | undefined {
  const cfEntry = futureCandles[0]?.open;
  if (typeof cfEntry !== "number") return undefined;
  const stop = signal.plan.stopLoss;
  const risk = Math.abs(cfEntry - stop);
  const stopValid = signal.direction === "short" ? stop > cfEntry : stop < cfEntry;
  if (!stopValid || risk <= 0) return undefined;
  const cfSignal = { ...signal, plan: { ...signal.plan, entry: cfEntry, riskDistance: risk } } as TradingSignal;
  const outcome = evaluateCrtForwardOutcome(cfSignal, futureCandles, [], settings);
  if (outcome.status === "not-triggered" || outcome.status === "open") return undefined;
  return Number(outcome.rMultiple.toFixed(2));
}

function evaluateForwardOutcome(signal: TradingSignal, futureCandles: Candle[], tagsExtra: string[] = [], settings: StrategySettings = {}): ReplayOutcome {
  const tags = Array.from(new Set([...tradeTags(signal), ...tagsExtra]));
  if (!futureCandles.length) {
    return { status: "open", rMultiple: 0, maxFavorableR: 0, maxAdverseR: 0, candlesHeld: 0, outcomeReason: "expired", tags, note: "İleri mum yok; sonuç açık kaldı." };
  }

  // CRT entries are resting retest limit orders: they only fill when price actually returns
  // to the level, and a fill hours later belongs to a different market — the order expires.
  const isRetestEntry = signal.strategyId === "crt";
  const immediateEntry = !isRetestEntry && signal.plan.entryStatus === "confirmed";
  const entryIndex = immediateEntry ? 0 : futureCandles.findIndex((candle) => priceTouched(candle, signal.plan.entry));
  if (entryIndex < 0) {
    return {
      status: "not-triggered",
      rMultiple: 0,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesHeld: futureCandles.length,
      outcomeReason: "entry-not-filled",
      tags,
      note: "Entry alanı sonraki mumlarda tetiklenmedi.",
      unfilledCounterfactualR: isRetestEntry ? unfilledEntryCounterfactualR(signal, futureCandles, settings) : undefined
    };
  }
  const fillTimeout = ENTRY_FILL_TIMEOUT_CANDLES * confirmTfFactor(signal);
  if (isRetestEntry && entryIndex >= fillTimeout) {
    return {
      status: "not-triggered",
      rMultiple: 0,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesHeld: entryIndex,
      outcomeReason: "entry-expired",
      tags: Array.from(new Set([...tags, "entry:expired"])),
      note: `Retest emri ${fillTimeout} m15 mumu içinde dolmadı; emir iptal sayıldı.`,
      unfilledCounterfactualR: unfilledEntryCounterfactualR(signal, futureCandles, settings)
    };
  }

  let maxFavorableR = 0;
  let maxAdverseR = 0;
  const afterEntry = futureCandles.slice(entryIndex);
  if (signal.strategyId === "crt") return evaluateCrtForwardOutcome(signal, afterEntry, tags, settings);
  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    const highR = rAtPrice(signal, executableHigh(candle, signal.direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(signal, executableLow(candle, signal.direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    maxAdverseR = Math.min(maxAdverseR, highR, lowR);

    const currentStopHit = stopHit(signal, candle);
    const tp2Hit = targetHit(signal, candle, 1);
    const tp1Hit = targetHit(signal, candle, 0);

    if (currentStopHit) {
      const reason = stoppedReason(signal, maxFavorableR);
      return {
        status: "stopped",
        rMultiple: -1,
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: reason,
        tags,
        note: "Entry sonrası stop görüldü."
      };
    }
    if (tp2Hit) {
      return {
        status: "tp2",
        rMultiple: targetR(signal, 1),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "clean-model",
        tags,
        note: "Entry sonrası TP2 görüldü."
      };
    }
    if (tp1Hit) {
      return {
        status: "tp1",
        rMultiple: targetR(signal, 0),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "clean-model",
        tags,
        note: "Entry sonrası TP1 görüldü."
      };
    }
  }

  return {
    status: "open",
    rMultiple: expiryCloseR(signal, afterEntry),
    maxFavorableR,
    maxAdverseR,
    candlesHeld: afterEntry.length,
    outcomeReason: "expired",
    tags,
    note: `Süre doldu; pencere sonu executable close ile değerlendi. Max ${maxFavorableR.toFixed(2)}R, adverse ${maxAdverseR.toFixed(2)}R.`
  };
}

function noTriggerOutcome(signal: TradingSignal, tagsExtra: string[], note: string): ReplayOutcome {
  return {
    status: "not-triggered",
    rMultiple: 0,
    maxFavorableR: 0,
    maxAdverseR: 0,
    candlesHeld: 0,
    outcomeReason: "entry-not-filled",
    tags: Array.from(new Set([...tradeTags(signal), ...tagsExtra])),
    note
  };
}

function confirmationAdjustedFuture(signal: TradingSignal, futureCandles: Candle[]) {
  const requirement = closeConfirmationRequirement(signal);
  if (!requirement) return { candles: futureCandles, tags: ["confirm:already-valid"], missingNote: "" };
  const confirmIndex = futureCandles.findIndex((candle) => requirement.side === "above"
    ? candle.close > requirement.level
    : candle.close < requirement.level);
  if (confirmIndex < 0) {
    return {
      candles: [],
      tags: ["confirm:not-seen"],
      missingNote: `${requirement.label} kapanış onayı ileri mumlarda gelmedi; trade yok.`
    };
  }
  return {
    candles: futureCandles.slice(confirmIndex),
    tags: ["confirm:future-close"],
    missingNote: ""
  };
}

function candidateDecision(signal: TradingSignal): string {
  if (signal.stage === "ready") return "READY: entry, stop ve TP planı aktif.";
  const closeRequirement = closeConfirmationRequirement(signal);
  if (closeRequirement) {
    return `${closeRequirement.timeframe} mum ${closeRequirement.level} ${closeRequirement.side === "above" ? "üstünde" : "altında"} kapanmalı.`;
  }
  if (signal.plan.entryStatus === "pending") return "Entry/retest alanı bekleniyor.";
  return signal.plan.planWarnings[0] ?? signal.governance.summary ?? "WATCH: setup izleniyor.";
}

function candidateReasons(signal: TradingSignal): string[] {
  const closeRequirement = closeConfirmationRequirement(signal);
  const retest = entryRetestRequirement(signal);
  const failed = signal.decisionSummary.checklist
    .filter((item) => item.status === "fail")
    .map((item) => item.explanation || item.label);
  return Array.from(new Set([
    retest,
    closeRequirement ? `${closeRequirement.label} kapanış onayı bekleniyor.` : undefined,
    signal.governance.blockers[0],
    signal.governance.warnings[0],
    ...signal.plan.planWarnings,
    ...signal.riskWarnings,
    ...failed
  ].filter((item): item is string => Boolean(item))))
    .slice(0, 6);
}

function replayReadyDecision(signal: TradingSignal) {
  if (signal.stage === "ready") return "LIVE READY: entry, stop ve TP planı aktifti.";
  if (signal.plan.entryStatus === "confirmed") return "REPLAY READY: şartlar uygundu, forward sonuç ölçüldü.";
  return "REPLAY READY: WATCH adayıydı; entry/retest ileri mumlarda test edildi.";
}

function replayCandidate(signal: TradingSignal, time: number, stage: RuntimeReplayCandidate["stage"] = signal.stage === "ready" ? "ready" : "watch"): RuntimeReplayCandidate {
  const session = replaySessionClassification(signal);
  return {
    id: `${signal.id}-${time}-${stage}-candidate`,
    symbol: signal.symbol,
    direction: signal.direction,
    signalTime: time,
    stage,
    grade: signal.grade,
    score: signal.score,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    target: signal.plan.targets[1] ?? signal.plan.targets[0] ?? signal.plan.entry,
    rr: signal.plan.rr,
    entrySource: signal.plan.entrySource,
    entryStatus: signal.plan.entryStatus,
    governance: signal.governance.status,
    actionWindow: signal.actionWindow.status,
    decision: stage === "ready" ? replayReadyDecision(signal) : candidateDecision(signal),
    reasons: candidateReasons(signal),
    tags: tradeTags(signal),
    sessionReference: session.reference,
    sessionTrigger: session.trigger,
    sessionModel: session.model
  };
}

function replayEntryRank(signal: TradingSignal): number {
  const gradeBonus = signal.grade === "A+" ? 20 : signal.grade === "A" ? 12 : signal.grade === "B" ? 5 : 0;
  const actionBonus = signal.actionWindow.status === "valid" ? 12 : signal.actionWindow.status === "waiting" ? 4 : -10;
  return signal.score + Math.min(signal.plan.rr, 5) * 5 + gradeBonus + actionBonus;
}

function replayPlanGeometryValid(signal: TradingSignal): boolean {
  const target = signal.plan.targets[1] ?? signal.plan.targets[0];
  if (typeof target !== "number") return false;
  if (![signal.plan.entry, signal.plan.stopLoss, target, signal.plan.riskDistance, signal.plan.rr].every(Number.isFinite)) return false;
  if (signal.plan.riskDistance <= 0) return false;
  const stopValid = signal.direction === "short"
    ? signal.plan.stopLoss > signal.plan.entry
    : signal.plan.stopLoss < signal.plan.entry;
  const targetValid = signal.direction === "short" ? target < signal.plan.entry : target > signal.plan.entry;
  return stopValid && targetValid;
}

function replayEligibleSignal(signal: TradingSignal): boolean {
  // Replay and live alerts must evaluate the exact same event-time decision. Promoting a WATCH
  // after seeing later candles measures a different strategy and inflates the apparent sample.
  return signal.stage === "ready" && replayPlanGeometryValid(signal);
}

function bestSymbol(trades: RuntimeReplayTrade[], candidates: RuntimeReplayCandidate[]): string {
  const bySymbol = symbolSummaries(trades, candidates);
  return [...bySymbol].sort((a, b) => b.totalR - a.totalR || b.readyAlerts - a.readyAlerts || b.watchAlerts - a.watchAlerts)[0]?.symbol ?? "";
}

function symbolSummaries(trades: RuntimeReplayTrade[], candidates: RuntimeReplayCandidate[]) {
  const symbols = Array.from(new Set([...trades.map((trade) => trade.symbol), ...candidates.map((candidate) => candidate.symbol)])).sort();
  return symbols.map((symbol) => {
    const symbolTrades = trades.filter((trade) => trade.symbol === symbol);
    const symbolCandidates = candidates.filter((candidate) => candidate.symbol === symbol);
    const triggered = symbolTrades.filter((trade) => trade.status !== "not-triggered");
    const wins = triggered.filter((trade) => trade.rMultiple > 0).length;
    const scoreSum = symbolCandidates.reduce((sum, candidate) => sum + candidate.score, 0);
    return {
      symbol,
      watchAlerts: symbolCandidates.filter((candidate) => candidate.stage === "watch").length,
      readyAlerts: symbolCandidates.filter((candidate) => candidate.stage === "ready").length,
      candidateAlerts: symbolCandidates.length,
      triggeredTrades: triggered.length,
      avgScore: symbolCandidates.length ? scoreSum / symbolCandidates.length : 0,
      totalR: Number(symbolTrades.reduce((sum, trade) => sum + trade.rMultiple, 0).toFixed(2)),
      winRate: triggered.length ? (wins / triggered.length) * 100 : 0
    };
  }).sort((a, b) => b.readyAlerts - a.readyAlerts || b.watchAlerts - a.watchAlerts || b.avgScore - a.avgScore);
}

function failureReasonSummary(trades: RuntimeReplayTrade[]) {
  const reasons = new Map<RuntimeReplayOutcomeReason, { count: number; totalR: number }>();
  for (const trade of trades) {
    if (trade.rMultiple > 0 && trade.outcomeReason === "clean-model") continue;
    const current = reasons.get(trade.outcomeReason) ?? { count: 0, totalR: 0 };
    current.count += 1;
    current.totalR = Number((current.totalR + trade.rMultiple).toFixed(2));
    reasons.set(trade.outcomeReason, current);
  }
  return [...reasons.entries()]
    .map(([reason, value]) => ({ reason, ...value }))
    .sort((a, b) => b.count - a.count || a.totalR - b.totalR);
}

function sessionIsActive(trade: RuntimeReplayTrade): boolean {
  return isCryptoSymbol(trade.symbol as MarketSymbol) || trade.session !== "Outside";
}

function scenarioStats(
  id: string,
  label: string,
  description: string,
  trades: RuntimeReplayTrade[],
  predicate: (trade: RuntimeReplayTrade) => boolean
): RuntimeReplayFilterScenario {
  const sample = trades.filter(predicate);
  const triggered = sample.filter((trade) => trade.status !== "not-triggered");
  const wins = triggered.filter((trade) => trade.rMultiple > 0);
  const losses = triggered.filter((trade) => trade.rMultiple < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const totalR = Number(sample.reduce((sum, trade) => sum + trade.rMultiple, 0).toFixed(2));
  const expectancyR = triggered.length ? totalR / triggered.length : 0;
  const winRate = triggered.length ? (wins.length / triggered.length) * 100 : 0;
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin;
  const drawdown = maxDrawdown(equityCurveFromReturns(sample.map((trade) => trade.rMultiple)));
  const verdict: RuntimeReplayFilterScenario["verdict"] = triggered.length < MIN_REPLAY_SCENARIO_TRADES
    ? "needs-data"
    : expectancyR <= -0.15 || profitFactor < 0.9
      ? "avoid"
      : expectancyR >= 0.15 && profitFactor >= 1.15
        ? "edge"
        : "neutral";
  return {
    id,
    label,
    description,
    sample: sample.length,
    triggered: triggered.length,
    wins: wins.length,
    losses: losses.length,
    totalR,
    expectancyR: Number(expectancyR.toFixed(2)),
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdown: Number(drawdown.toFixed(2)),
    verdict
  };
}

// Compare the live management model against its counterfactuals over the SAME entered
// trades: same entries, same candles, only the exit rule differs. This is what the AI
// replay review reads instead of recommending "measure BE/partial" as a to-do.
function managementScenarios(trades: RuntimeReplayTrade[]): RuntimeReplayManagementScenario[] {
  const sample = trades.filter((trade) => trade.status !== "not-triggered" && trade.managementVariants);
  const stats = (id: RuntimeReplayManagementScenario["id"], label: string, description: string, rOf: (trade: RuntimeReplayTrade) => number, modelExpectancy: number): RuntimeReplayManagementScenario => {
    const returns = sample.map(rOf);
    const totalR = Number(returns.reduce((sum, value) => sum + value, 0).toFixed(2));
    const expectancyR = sample.length ? Number((totalR / sample.length).toFixed(2)) : 0;
    const grossWin = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    const profitFactor = Number((grossLoss ? grossWin / grossLoss : grossWin).toFixed(2));
    const deltaR = Number((expectancyR - modelExpectancy).toFixed(2));
    const verdict: RuntimeReplayManagementScenario["verdict"] = sample.length < MIN_REPLAY_SCENARIO_TRADES
      ? "needs-data"
      : id === "model" || Math.abs(deltaR) < 0.05
        ? "similar"
        : deltaR > 0
          ? "better"
          : "worse";
    return { id, label, description, trades: sample.length, totalR, expectancyR, profitFactor, deltaR, verdict };
  };
  const modelTotal = sample.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const modelExpectancy = sample.length ? Number((modelTotal / sample.length).toFixed(2)) : 0;
  return [
    stats("model", "Mevcut model (Hepsi EQ'da)", "Tam pozisyon ilk hedefte (EQ) kapanır, DOL beklenmez.", (trade) => trade.rMultiple, modelExpectancy),
    stats("eq-partial-be", "EQ %50 + BE (eski model)", "EQ'da %50 partial + %50 DOL'a, +1R sonrası stop BE.", (trade) => trade.managementVariants?.eqPartialBe ?? trade.rMultiple, modelExpectancy),
    stats("no-be", "BE yok", "EQ'da %50 partial, stop asla taşınmaz; kalan yarım DOL veya stop.", (trade) => trade.managementVariants?.noBe ?? trade.rMultiple, modelExpectancy),
    stats("full-dol", "Partial yok", "Tam pozisyon DOL hedefli, +1R sonrası stop BE.", (trade) => trade.managementVariants?.fullDol ?? trade.rMultiple, modelExpectancy)
  ];
}

function filterScenarios(trades: RuntimeReplayTrade[]): RuntimeReplayFilterScenario[] {
  return [
    scenarioStats(
      "live-ready",
      "Sadece canlı READY",
      "WATCH sonradan entry gibi sayılmadan, bot gerçekten READY dediği işlemler.",
      trades,
      (trade) => trade.origin === "live-ready"
    ),
    scenarioStats(
      "htf-aligned",
      "HTF uyumlu",
      "Daily veya H4 trade yönüyle aynı olan işlemler.",
      trades,
      (trade) => trade.tags.includes("htf:aligned")
    ),
    scenarioStats(
      "pd-aligned",
      "PD doğru",
      "Short premium, long discount bölgesinden gelen işlemler.",
      trades,
      (trade) => trade.tags.includes("pd:aligned")
    ),
    scenarioStats(
      "session-active",
      "Session içi",
      "FX/endeks için London veya New York; BTC için session filtresi yok.",
      trades,
      sessionIsActive
    ),
    scenarioStats(
      "bias-not-opposing",
      "İki-taraflı bias karşı değil",
      "Master §8 açık sorusu: güvenli bir karşı bias'ı gate yapmak R'ı artırır mı? (şu an sadece skor kırar)",
      trades,
      (trade) => !trade.tags.includes("bias:opposes")
    ),
    scenarioStats(
      "eq-rr-floor",
      "EQ-RR ≥ 1",
      "Kapı DOL'a bakar ama çıkış EQ'da: EQ mesafesi en az 1R olan işlemler (30+ inceleme adayı).",
      trades,
      (trade) => trade.eqRR >= 1
    ),
    scenarioStats(
      "strict-core",
      "Sıkı çekirdek",
      "Canlı READY + HTF uyumlu + PD doğru + session içi.",
      trades,
      (trade) => trade.origin === "live-ready" && trade.tags.includes("htf:aligned") && trade.tags.includes("pd:aligned") && sessionIsActive(trade)
    ),
    scenarioStats(
      "smt-aligned",
      "SMT aligned",
      "SMT artık bonus değil; bu satır gerçekten edge veriyor mu diye izlenir.",
      trades,
      (trade) => trade.tags.includes("smt:aligned")
    )
  ];
}

function watchReasonSummary(candidates: RuntimeReplayCandidate[]) {
  const counts = new Map<string, number>();
  for (const candidate of candidates.filter((item) => item.stage === "watch")) {
    const reason = candidate.reasons[0] ?? candidate.decision;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function tagLabel(tag: string): string {
  const [group, value] = tag.split(":");
  if (group === "reason") {
    if (value === "clean-model") return "Temiz model";
    if (value === "eq-then-be") return "EQ sonra BE";
    if (value === "dol-missed") return "DOL gelmedi";
    if (value === "stop-too-tight") return "Stop dar";
    if (value === "event-risk") return "Event riski";
    if (value === "range-chop") return "Range/chop";
    if (value === "htf-conflict") return "HTF conflict";
    if (value === "entry-not-filled") return "Entry dolmadı";
    if (value === "expired") return "Süre doldu";
    return "Bilinmeyen neden";
  }
  if (group === "pd") return value === "mismatch" ? "PD mismatch" : value === "aligned" ? "PD aligned" : `PD ${value}`;
  if (group === "htf") return value === "conflict" ? "HTF conflict" : "HTF aligned";
  if (group === "smt") return value === "none" ? "SMT yok" : "SMT aligned";
  if (group === "crt") return `CRT ${value}`;
  if (group === "pullback") return value === "valid" ? "Valid pullback" : "Pullback invalid";
  if (group === "poi") return value === "mapped" || value === "touched" ? "POI var" : "POI yok";
  if (group === "manipulation") return value === "yes" ? "Manipulation var" : "Manipulation yok";
  if (group === "choch") return value === "yes" ? "ChoCH var" : "ChoCH yok";
  if (group === "rr") return value === "2plus" ? "RR 2+" : value === "ok" ? "RR uygun" : "RR düşük";
  if (group === "entry-status") return `Entry ${value}`;
  return `${group} ${value}`;
}

function calibrationFromTrades(trades: RuntimeReplayTrade[], watchAlerts: number): RuntimeReplayCalibration[] {
  const insights: RuntimeReplayCalibration[] = [];
  const triggered = trades.filter((trade) => trade.status !== "not-triggered");
  if (!triggered.length) {
    insights.push({
      label: "READY üretimi",
      value: "0",
      detail: watchAlerts > 0
        ? `${watchAlerts} WATCH var ama READY yok. POI/manipulation/ChoCH şartları fazla sıkı veya son 1 ay CRT model gelmemiş.`
        : "Son pencerede model setup üretmedi; veri ve market koşulu bekleniyor.",
      verdict: "investigate"
    });
    return insights;
  }
  if (triggered.length < MIN_REPLAY_RULE_TRADES) {
    return [{
      label: "Örneklem",
      value: `${triggered.length}/${MIN_REPLAY_RULE_TRADES}`,
      detail: "Kural değiştirmek için veri az. Aynı kurallarla örnek biriktir; sembol veya setup kapatma kararı çıkarma.",
      verdict: "investigate"
    }];
  }

  const tagStats = new Map<string, { count: number; totalR: number; wins: number }>();
  const keepTags = new Set([
    "pullback:valid",
    "poi:mapped",
    "retest:yes",
    "manipulation:yes",
    "choch:yes",
    "pd:aligned",
    "htf:aligned",
    "smt:aligned",
    "rr:ok",
    "rr:2plus",
    "governance:allow"
  ]);
  const isPreEntryTag = (tag: string) => {
    const [group, value] = tag.split(":");
    if (["reason", "replay", "risk", "entry-fill"].includes(group)) return false;
    if (group === "crt" && ["eq", "eq-full", "partial", "dol"].includes(value)) return false;
    return true;
  };
  for (const trade of triggered) {
    for (const tag of trade.tags.filter(isPreEntryTag)) {
      const current = tagStats.get(tag) ?? { count: 0, totalR: 0, wins: 0 };
      current.count += 1;
      current.totalR += trade.rMultiple;
      if (trade.rMultiple > 0) current.wins += 1;
      tagStats.set(tag, current);
    }
  }

  for (const [tag, stat] of [...tagStats.entries()].filter(([, stat]) => stat.count >= MIN_REPLAY_BUCKET_TRADES)) {
    const avgR = stat.totalR / stat.count;
    if (avgR <= -0.35) {
      insights.push({
        label: tagLabel(tag),
        value: `${avgR.toFixed(2)}R`,
        detail: `${stat.count} örnekte negatif. Bu koşul READY'i WATCH'a düşürmek için aday.`,
        verdict: "tighten"
      });
    } else if (avgR >= 0.45 && keepTags.has(tag)) {
      insights.push({
        label: tagLabel(tag),
        value: `${avgR.toFixed(2)}R`,
        detail: `${stat.count} örnekte pozitif. Bu filtre korunmalı, hatta skor ağırlığı artırılabilir.`,
        verdict: "keep"
      });
    }
  }

  const reasons = failureReasonSummary(trades);
  const topReason = reasons[0];
  if (topReason) {
    insights.push({
      label: `Ana kayıp nedeni: ${tagLabel(`reason:${topReason.reason}`)}`,
      value: `${topReason.count}`,
      detail: `${topReason.totalR.toFixed(2)}R toplam etki. Stop/event/rejim filtrelerini buna göre sıkılaştır.`,
      verdict: "investigate"
    });
  }

  const watchPromoted = trades.filter((trade) => trade.origin === "watch-promoted");
  if (watchPromoted.length >= 3) {
    const promotedTotal = watchPromoted.reduce((sum, trade) => sum + trade.rMultiple, 0);
    const promotedExpectancy = promotedTotal / watchPromoted.length;
    insights.push({
      label: "WATCH replay entry",
      value: `${promotedExpectancy.toFixed(2)}R`,
      detail: promotedExpectancy < 0
        ? `${watchPromoted.length} WATCH-promoted örneği negatif. Canlı mantıkta WATCH asla entry gibi davranmamalı; kapanış teyidi şart.`
        : `${watchPromoted.length} WATCH-promoted örneği pozitif. Bu koşullar ayrı bir setup varyantı olarak incelenebilir.`,
      verdict: promotedExpectancy < 0 ? "tighten" : "investigate"
    });
  }

  return insights
    .sort((a, b) => {
      const priority = { tighten: 0, investigate: 1, keep: 2, relax: 3 } as const;
      return priority[a.verdict] - priority[b.verdict];
    })
    .slice(0, 8);
}

function breakdownLabel(key: string): string {
  const [group, value] = key.split(":");
  if (group === "origin") return value === "live-ready" ? "Live READY" : "WATCH promoted";
  if (group === "direction") return value === "long" ? "Long setup" : "Short setup";
  if (group === "grade") return `Grade ${value}`;
  if (group === "entry") return `Entry ${value}`;
  if (group === "stop") return `Stop ${value}`;
  if (group === "session") return `Session ${value}`;
  if (group === "session-route") return `Session route ${value}`;
  if (group === "session-model") return `Session model ${value.replace(/_/g, " ")}`;
  if (group === "pd") return `PD ${value}`;
  if (group === "regime") return `Regime ${value}`;
  if (group === "htf") return value === "aligned" ? "HTF aligned" : "HTF conflict";
  if (group === "smt") return value === "aligned" ? "SMT aligned" : "SMT yok";
  return key;
}

function setupBreakdowns(trades: RuntimeReplayTrade[]): RuntimeReplaySetupBreakdown[] {
  const groups = new Map<string, RuntimeReplayTrade[]>();
  for (const trade of trades) {
    const keys = [
      `origin:${trade.origin}`,
      `direction:${trade.direction}`,
      `grade:${trade.grade}`,
      `entry:${trade.entrySource}`,
      `stop:${trade.stopSource}`,
      `session:${trade.session}`,
      `session-route:${trade.sessionReference ?? "NONE"}->${trade.sessionTrigger ?? trade.session}`,
      `session-model:${trade.sessionModel ?? "CRT_SESSION_UNCLASSIFIED"}`,
      `pd:${trade.premiumDiscount}`,
      `regime:${trade.regime}`,
      `htf:${trade.tags.includes("htf:aligned") ? "aligned" : "conflict"}`,
      `smt:${trade.tags.includes("smt:aligned") ? "aligned" : "none"}`
    ];
    for (const key of keys) {
      const current = groups.get(key) ?? [];
      current.push(trade);
      groups.set(key, current);
    }
  }

  return [...groups.entries()]
    .filter(([, sample]) => sample.length >= 2)
    .map(([key, sample]) => {
      const triggered = sample.filter((trade) => trade.status !== "not-triggered");
      const wins = triggered.filter((trade) => trade.rMultiple > 0);
      const losses = triggered.filter((trade) => trade.rMultiple < 0);
      const stopped = triggered.filter((trade) => trade.status === "stopped");
      const totalR = Number(sample.reduce((sum, trade) => sum + trade.rMultiple, 0).toFixed(2));
      const expectancyR = triggered.length ? totalR / triggered.length : 0;
      const winRate = triggered.length ? (wins.length / triggered.length) * 100 : 0;
      const avgMfeR = sample.reduce((sum, trade) => sum + trade.maxFavorableR, 0) / sample.length;
      const avgMaeR = sample.reduce((sum, trade) => sum + trade.maxAdverseR, 0) / sample.length;
      const verdict: RuntimeReplaySetupBreakdown["verdict"] = triggered.length < MIN_REPLAY_BUCKET_TRADES
        ? "needs-data"
        : expectancyR <= -0.25 || (stopped.length >= wins.length * 2 && losses.length > 0)
          ? "avoid"
          : expectancyR >= 0.35 && winRate >= 35
            ? "edge"
            : "neutral";
      return {
        key,
        label: breakdownLabel(key),
        sample: sample.length,
        triggered: triggered.length,
        wins: wins.length,
        losses: losses.length,
        stopped: stopped.length,
        totalR,
        expectancyR: Number(expectancyR.toFixed(2)),
        winRate: Number(winRate.toFixed(1)),
        avgMfeR: Number(avgMfeR.toFixed(2)),
        avgMaeR: Number(avgMaeR.toFixed(2)),
        verdict,
        note: verdict === "avoid"
          ? "Bu koşul altında setuplar negatife dönmüş; READY yerine WATCH veya blok adayı."
          : verdict === "edge"
            ? "Bu koşul pozitif ayrışıyor; skor ağırlığı korunabilir."
            : verdict === "needs-data"
              ? "Örnek az; karar için daha fazla replay lazım."
              : "Net edge yok; tek başına karar filtresi olmasın."
      };
    })
    .sort((a, b) => {
      const priority = { avoid: 0, edge: 1, neutral: 2, "needs-data": 3 } as const;
      return priority[a.verdict] - priority[b.verdict] || a.expectancyR - b.expectancyR || b.sample - a.sample;
    })
    .slice(0, 14);
}

function failureDiagnosis(trade: RuntimeReplayTrade): string {
  if (trade.status === "not-triggered") return "Entry alanı dolmamış; bu setup trade değil, bekleme istatistiği.";
  if (trade.origin === "watch-promoted" && trade.rMultiple < 0) return "WATCH iken trade'e çevrilmiş ve zarar etmiş; kapanış teyidi veya live READY şartı güçlendirilmeli.";
  if (trade.outcomeReason === "htf-conflict") return "HTF bias ters; aynı yön D/H4 onayı olmadan READY zayıf kalıyor.";
  if (trade.outcomeReason === "range-chop") return "Range/chop içinde hedefe akış yok; rejim filtresi sıkılaşmalı.";
  if (trade.outcomeReason === "stop-too-tight") return "MFE düşük veya volatility-floor stop çalışmış; stop modeli/entry chase kontrolü incelenmeli.";
  if (trade.outcomeReason === "event-risk") return "Event riski trade'i bozmuş; haber/saat filtresi hard gate olmalı.";
  if (trade.outcomeReason === "eq-then-be") return "EQ yönetimi çalışmış ama DOL akışı yok; bu koşul final hedef için zayıf olabilir.";
  if (trade.outcomeReason === "dol-missed") return "EQ geldi fakat DOL süre içinde gelmedi; target seçimi veya session momentum filtresi incelenmeli.";
  if (trade.maxFavorableR < 0.35 && trade.rMultiple < 0) return "Trade neredeyse hiç doğru yöne gitmeden stop olmuş; entry modeli erken veya yanlış yönde.";
  if (trade.maxFavorableR >= 1 && trade.rMultiple < 0) return "1R üstü fırsat verip stop olmuş; partial/BE yönetimi incelenmeli.";
  return "Kayıp trade; tag kırılımında hangi koşul tekrarlıyor bakılmalı.";
}

function failureCases(trades: RuntimeReplayTrade[]): RuntimeReplayFailureCase[] {
  return trades
    .filter((trade) => trade.rMultiple <= 0 || trade.status === "not-triggered")
    .sort((a, b) => a.rMultiple - b.rMultiple || a.maxFavorableR - b.maxFavorableR)
    .slice(0, 16)
    .map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      signalTime: trade.signalTime,
      status: trade.status,
      rMultiple: trade.rMultiple,
      outcomeReason: trade.outcomeReason,
      origin: trade.origin,
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      target: trade.target,
      rr: trade.rr,
      grade: trade.grade,
      score: trade.score,
      entrySource: trade.entrySource,
      entryStatus: trade.entryStatus,
      stopSource: trade.stopSource,
      targetSource: trade.targetSource,
      session: trade.session,
      premiumDiscount: trade.premiumDiscount,
      dailyBias: trade.dailyBias,
      h4Bias: trade.h4Bias,
      h1Bias: trade.h1Bias,
      regime: trade.regime,
      eventRisk: trade.eventRisk,
      governance: trade.governance,
      actionWindow: trade.actionWindow,
      dataConfidence: trade.dataConfidence,
      maxFavorableR: trade.maxFavorableR,
      maxAdverseR: trade.maxAdverseR,
      candlesHeld: trade.candlesHeld,
      setupWarnings: trade.setupWarnings.slice(0, 5),
      waitReasons: trade.waitReasons.slice(0, 5),
      tags: trade.tags.slice(0, 14),
      diagnosis: failureDiagnosis(trade)
    }));
}

function replayDiagnosis(trades: RuntimeReplayTrade[], breakdowns: RuntimeReplaySetupBreakdown[]): string[] {
  if (!trades.length) return ["Replay entry yok; önce live READY şartları ve veri kapsamı kontrol edilmeli."];
  const promoted = trades.filter((trade) => trade.origin === "watch-promoted");
  const live = trades.filter((trade) => trade.origin === "live-ready");
  const avoid = breakdowns.filter((item) => item.verdict === "avoid").slice(0, 3);
  // When the live system produced zero READY entries, every headline number below is a
  // watch-promoted counterfactual ("had you entered the eligible watch early"), NOT the live
  // system's performance. Say this first and unmistakably so no PF/R is read as live edge.
  const counterfactualR = Number(promoted.reduce((sum, trade) => sum + trade.rMultiple, 0).toFixed(2));
  const notes = [
    live.length === 0 && promoted.length > 0
      ? `⚠ Canlı-READY girişi: 0. Aşağıdaki tüm P&L (${counterfactualR}R) WATCH-promoted counterfactual'dır — "READY'yi beklemeyip eligible-watch'ta girseydin" senaryosu, canlı performans DEĞİL. Bu sonuç doktrinin sıkı olduğunu gösterir: kusursuz A-grade setup nadir, canlı sistem RAID ön-uyarısı dışında bildirim üretmez.`
      : undefined,
    live.length === 0 && promoted.length > 0
      ? "Karar seni bekliyor: (a) sıkı kal — az ama öz, RAID uyarısıyla erken haber; (b) eşiği eligible-watch seviyesine indir — daha çok READY ama daha düşük seçicilik. Kural değiştirmeden önce 30+ trade örneklem şart."
      : undefined,
    live.length > 0 && promoted.length > live.length
      ? `Replay'in çoğu WATCH-promoted (${promoted.length}/${trades.length}); canlı strateji başarısı gibi okunmamalı.`
      : undefined,
    avoid.length
      ? `Negatif koşullar: ${avoid.map((item) => `${item.label} ${item.expectancyR.toFixed(2)}R`).join(", ")}.`
      : undefined,
    trades.filter((trade) => trade.maxFavorableR >= 1 && trade.rMultiple < 0).length >= 2
      ? "Bazı trade'ler 1R fırsat verip stop olmuş; BE/partial yönetimi ölçülmeli."
      : undefined,
    trades.filter((trade) => trade.outcomeReason === "htf-conflict").length >= 2
      ? "HTF conflict tekrar ediyor; READY için D/H4 yön uyumu sertleşebilir."
      : undefined
  ].filter((item): item is string => Boolean(item));
  return notes.length ? notes : ["Replay'de tek bir bariz bozukluk yok; sembol ve setup bazlı daha uzun örnek gerekli."];
}

function streak(returns: number[], winning: boolean): number {
  let best = 0;
  let current = 0;
  for (const value of returns) {
    const match = winning ? value > 0 : value < 0;
    current = match ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

export function runMonthlyRuntimeReplay({
  markets,
  strategy,
  settings,
  windowDays = DEFAULT_WINDOW_DAYS,
  maxHoldCandles = DEFAULT_MAX_HOLD_CANDLES,
  scanEveryCandles = DEFAULT_SCAN_EVERY_CANDLES
}: RuntimeReplayInput): BacktestResult {
  const endedAt = latestReplayTime(markets);
  const earliest = earliestReplayTime(markets);
  const startedAt = Math.max(earliest, endedAt - windowDays * DAY_MS);
  const dataAvailableDays = endedAt > earliest ? (endedAt - earliest) / DAY_MS : 0;
  const replayedDays = endedAt > startedAt ? (endedAt - startedAt) / DAY_MS : 0;
  const setupStates = new Map<string, SetupState>();
  const dayRiskStates = new Map<string, DayRiskState>();
  // 1H anchor izleme hattı: kendi setup/risk durumu — çekirdek girişlerin gün kotasını yemez.
  const trackingSetupStates = new Map<string, SetupState>();
  const trackingDayRiskStates = new Map<string, DayRiskState>();
  const trackingTrades: RuntimeReplayTrade[] = [];
  const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
  const trades: RuntimeReplayTrade[] = [];
  const candidates: RuntimeReplayCandidate[] = [];
  let scannedWindows = 0;
  let watchAlerts = 0;
  let readyAlerts = 0;
  let liveReadyEntries = 0;
  const watchPromotedEntries = 0;

  for (const time of replayTimes(markets, startedAt, endedAt, scanEveryCandles)) {
    const contexts = attachSmtDivergences(
      markets
        .map((market) => ({ market, timeframes: timeframesAt(market, time) }))
        .filter(({ timeframes }) => enoughWarmupTimeframes(timeframes))
        .map(({ market, timeframes }) => buildMarketContext(market.symbol, timeframes))
        .filter(enoughWarmup)
    );
    scannedWindows += contexts.length;

    const entryCandidates: ReplayEntryCandidate[] = [];

    for (const context of contexts) {
      // Replay canlı botun yaptığını birebir yansıtmalı: intradayAnchorMode "live" ise 1H
      // birinci sınıf ailedir ve başlık metriklerine girer; "tracking" ise 1H'yi headline'a
      // sokmadan ayrı bir gölge hatta (live modda ikinci bir tarama) ölçeriz.
      const intradayLive = settings.intradayAnchorMode === "live";
      const scannedSignals = strategy.scan({ context, settings }).signals;

      if (!intradayLive) {
        const trackingScan = strategy.scan({ context, settings: { ...settings, intradayAnchorMode: "live" } }).signals;
        const trackingSignal = trackingScan.find((item) => item.crtAnchor?.rangeTf === "1h"
          && item.stage !== "invalidated" && item.stage !== "missed");
        if (trackingSignal && replayEligibleSignal(trackingSignal)) {
          const trackingKey = `1h:${setupKey(trackingSignal)}`;
          const previousTracking = trackingSetupStates.get(trackingKey);
          const trackingState = previousTracking && time - previousTracking.lastSeen <= SETUP_COOLDOWN_MS
            ? previousTracking
            : { lastSeen: time, countedWatch: false, countedReady: false };
          trackingState.lastSeen = time;
          const trackingDay = dayStateFor(trackingDayRiskStates, time);
          if (!trackingState.countedReady && canTakeReplayEntry(trackingDay, trackingSignal)) {
            const market = marketBySymbol.get(trackingSignal.symbol);
            const built = buildMeasuredReplayTrade(trackingSignal, time, market, maxHoldCandles, settings, ["replay:1h-tracking", "anchor:1h", "risk:daily-capped"]);
            trackingTrades.push(built.trade);
            applyReplayRisk(trackingDay, trackingSignal, built.outcome);
            trackingState.countedReady = true;
          }
          trackingSetupStates.set(trackingKey, trackingState);
        }
      }

      // Live modda 1H çekirdek seçime dahildir (RANGE_TF_RANK onu en sona sıraladığı için
      // ancak en iyi sinyal oysa görünür); tracking modda çekirdek 1h-dışı ilk sinyaldir.
      const signal = scannedSignals.find((item) => intradayLive || item.crtAnchor?.rangeTf !== "1h");
      if (!signal || signal.stage === "invalidated" || signal.stage === "missed") continue;

      const key = setupKey(signal);
      const previous = setupStates.get(key);
      const state = previous && time - previous.lastSeen <= SETUP_COOLDOWN_MS
        ? previous
        : { lastSeen: time, countedWatch: false, countedReady: false };
      state.lastSeen = time;

      if (signal.stage === "watch" && !state.countedWatch) {
        watchAlerts += 1;
        candidates.push(replayCandidate(signal, time));
        state.countedWatch = true;
      }

      const replayEligible = replayEligibleSignal(signal);
      if (replayEligible && !state.countedReady) {
        entryCandidates.push({ signal, time, state, rank: replayEntryRank(signal) });
      }

      setupStates.set(key, state);
    }

    let entriesThisScan = 0;
    for (const candidate of entryCandidates.sort((a, b) => b.rank - a.rank)) {
      if (entriesThisScan >= REPLAY_MAX_ENTRIES_PER_SCAN) break;
      const dayState = dayStateFor(dayRiskStates, candidate.time);
      if (!canTakeReplayEntry(dayState, candidate.signal)) continue;

      candidates.push(replayCandidate(candidate.signal, candidate.time, "ready"));
      const market = marketBySymbol.get(candidate.signal.symbol);
      const built = buildMeasuredReplayTrade(
        candidate.signal,
        candidate.time,
        market,
        maxHoldCandles,
        settings,
        ["replay:live-ready", "risk:daily-capped"]
      );
      trades.push(built.trade);
      applyReplayRisk(dayState, candidate.signal, built.outcome);
      readyAlerts += 1;
      liveReadyEntries += 1;
      entriesThisScan += 1;
      candidate.state.countedReady = true;
    }
  }

  const returns = trades.map((trade) => trade.rMultiple);
  const triggered = trades.filter((trade) => trade.status !== "not-triggered");
  const wins = triggered.filter((trade) => trade.rMultiple > 0);
  const losses = triggered.filter((trade) => trade.rMultiple < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const equityCurve = equityCurveFromReturns(returns);
  const totalR = Number(returns.reduce((sum, value) => sum + value, 0).toFixed(2));
  const bySymbol = symbolSummaries(trades, candidates);
  const breakdowns = setupBreakdowns(trades);
  const failures = failureCases(trades);
  const tp1Trades = trades.filter((trade) => trade.status === "tp1").length;
  const tp2Trades = trades.filter((trade) => trade.status === "tp2").length;
  const stoppedTrades = trades.filter((trade) => trade.status === "stopped").length;
  const notTriggered = trades.filter((trade) => trade.status === "not-triggered").length;
  const openTrades = trades.filter((trade) => trade.status === "open").length;
  const sampleWarning = [
    dataAvailableDays + 0.5 < windowDays
      ? `Mevcut data ${dataAvailableDays.toFixed(1)} gün; tam ${windowDays} gün için provider 15m geçmişi gerekir.`
      : undefined,
    `Replay risk capped: sembol başına günde ${REPLAY_MAX_SYMBOL_DAILY_TRADES} entry, günlük stop ${REPLAY_DAILY_STOP_R}R.`
  ].filter((item): item is string => Boolean(item)).join(" ");

  return {
    totalTrades: triggered.length,
    winRate: triggered.length ? (wins.length / triggered.length) * 100 : 0,
    lossRate: triggered.length ? (losses.length / triggered.length) * 100 : 0,
    averageRR: trades.length ? trades.reduce((sum, trade) => sum + Math.max(0, trade.maxFavorableR), 0) / trades.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin,
    maxDrawdown: maxDrawdown(equityCurve),
    maxWinStreak: streak(returns, true),
    maxLossStreak: streak(returns, false),
    bestKillzone: "Runtime replay",
    bestSymbol: bestSymbol(trades, candidates),
    bestSetupGrade: [...trades].sort((a, b) => b.rMultiple - a.rMultiple)[0]?.grade ?? "",
    bestPremiumDiscountLocation: "Measured from closed-candle replay",
    worstCondition: stoppedTrades > wins.length ? "Stops dominate TP hits" : "Sample still building",
    equityCurve,
    replay: {
      mode: "runtime-replay",
      strategyId: strategy.id,
      windowDays,
      scanEveryCandles,
      availableDays: replayedDays,
      startedAt,
      endedAt,
      scannedWindows,
      readyAlerts,
      watchAlerts,
      liveReadyEntries,
      watchPromotedEntries,
      triggeredTrades: triggered.length,
      notTriggered,
      openTrades,
      stoppedTrades,
      tp1Trades,
      tp2Trades,
      totalR,
      expectancyR: triggered.length ? totalR / triggered.length : 0,
      bySymbol,
      calibration: calibrationFromTrades(trades, watchAlerts),
      filterScenarios: filterScenarios(trades),
      managementScenarios: managementScenarios(trades),
      setupBreakdowns: breakdowns,
      failureCases: failures,
      failureReasons: failureReasonSummary(trades),
      watchReasonSummary: watchReasonSummary(candidates),
      replayDiagnosis: replayDiagnosis(trades, breakdowns),
      reviewMeasurements: buildReviewMeasurements(trades),
      trackingScenarios: [
        scenarioStats(
          "anchor-1h-tracking",
          "1H anchor (izleme)",
          "Master §8'in 1H→5M eşlemesi ayrı ailede ölçülür; başlık metriklerine karışmaz, READY üretmez.",
          trackingTrades,
          () => true
        )
      ],
      trackingTrades: trackingTrades.slice(-40).reverse(),
      trades: trades.slice(-80).reverse(),
      candidates: candidates.slice(-120).reverse(),
      sampleWarning
    }
  };
}

export const __runtimeReplayInternals = {
  evaluateForwardOutcome,
  timeframesAt,
  replayPlanGeometryValid,
  calibrationFromTrades,
  buildReviewMeasurements,
  clusterExposure
};
