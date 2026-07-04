import type { DemoMarket } from "../../data/demoData";
import {
  equityCurveFromReturns,
  maxDrawdown,
  type BacktestResult,
  type RuntimeReplayCalibration,
  type RuntimeReplayCandidate,
  type RuntimeReplayFailureCase,
  type RuntimeReplayOutcomeReason,
  type RuntimeReplaySetupBreakdown,
  type RuntimeReplayTrade
} from "../analytics/performance";
import { aggregateCandles, trimCandles } from "../data/candleAggregation";
import { executableHigh, executableLow } from "../data/bidAsk";
import type { Candle, MarketContext, MarketSymbol, TradingSignal } from "../ict/types";
import { buildMarketContext, type MarketTimeframes } from "../intelligence/marketContext";
import { attachSmtDivergences } from "../intelligence/smtEngine";
import { closeConfirmationRequirement, entryRetestRequirement } from "../signals/waitingGuidance";
import type { StrategyModule, StrategySettings } from "../strategies/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MAX_HOLD_CANDLES = 96;
const DEFAULT_SCAN_EVERY_CANDLES = 4;
const SETUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const REPLAY_READY_MIN_SCORE = 50;
const REPLAY_READY_MIN_RR = 1;
const REPLAY_MAX_DAILY_TRADES = 3;
const REPLAY_MAX_SYMBOL_DAILY_TRADES = 1;
const REPLAY_MAX_ENTRIES_PER_SCAN = 1;
const REPLAY_DAILY_STOP_R = -2;

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

type ReplayOutcome = Pick<RuntimeReplayTrade, "status" | "rMultiple" | "maxFavorableR" | "maxAdverseR" | "candlesHeld" | "outcomeReason" | "tags" | "note">;

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
  return Math.max(...markets.flatMap((market) => executionCandles(market).slice(-1).map((candle) => candle.time)), 0);
}

function earliestReplayTime(markets: DemoMarket[]): number {
  const firstTimes = markets.flatMap((market) => executionCandles(market).slice(0, 1).map((candle) => candle.time));
  return firstTimes.length ? Math.min(...firstTimes) : 0;
}

function sliceByTime(candles: Candle[], time: number, count: number): Candle[] {
  return trimCandles(candles.filter((candle) => candle.time <= time), count);
}

function timeframesAt(market: DemoMarket, time: number): MarketTimeframes {
  const m15 = sliceByTime(market.timeframes.m15, time, 220);
  const h1 = sliceByTime(market.timeframes.h1, time, 180);
  const h4 = sliceByTime(market.timeframes.h4, time, 140);
  const daily = sliceByTime(market.timeframes.daily, time, 220);
  const m5 = sliceByTime(market.timeframes.m5, time, 220);
  return {
    daily,
    h4: h4.length ? h4 : trimCandles(aggregateCandles(h1, "4h"), 140),
    h1: h1.length ? h1 : trimCandles(aggregateCandles(m15, "1h"), 180),
    m15,
    m5
  };
}

function enoughWarmup(context: MarketContext): boolean {
  return context.timeframes.m15.length >= 80 && context.timeframes.h1.length >= 30 && context.timeframes.h4.length >= 12 && context.timeframes.daily.length >= 20;
}

function enoughWarmupTimeframes(timeframes: MarketTimeframes): boolean {
  return timeframes.m15.length >= 80 && timeframes.h1.length >= 30 && timeframes.h4.length >= 12 && timeframes.daily.length >= 20;
}

function replayTimes(markets: DemoMarket[], startedAt: number, endedAt: number, scanEveryCandles: number): number[] {
  const allTimes = Array.from(new Set(
    markets.flatMap((market) =>
      executionCandles(market)
        .filter((candle) => candle.time >= startedAt && candle.time <= endedAt)
        .map((candle) => candle.time)
    )
  )).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(scanEveryCandles));
  return allTimes.filter((_, index) => index % step === 0 || index === allTimes.length - 1);
}

function roundedLevel(value: number, symbol: MarketSymbol): string {
  const decimals = symbol === "EURUSD" || symbol === "GBPUSD" ? 5 : symbol === "BTCUSD" || symbol === "NAS100" ? 1 : 2;
  return value.toFixed(decimals);
}

function setupKey(signal: TradingSignal): string {
  return [
    signal.symbol,
    signal.direction,
    signal.plan.entrySource,
    signal.plan.stopSource,
    signal.plan.targetSource,
    signal.context.premiumDiscount.zone,
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
  if (state.trades >= REPLAY_MAX_DAILY_TRADES) return false;
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
    .filter((candle) => candle.time > signalTime)
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

function targetR(signal: TradingSignal, targetIndex: 0 | 1): number {
  const target = signal.plan.targets[targetIndex] ?? signal.plan.targets[0] ?? signal.plan.entry;
  return Math.max(0, Math.abs(target - signal.plan.entry) / Math.max(signal.plan.riskDistance, 0.000001));
}

function expectedBias(signal: TradingSignal) {
  return signal.direction === "short" ? "bearish" : "bullish";
}

function expectedPd(signal: TradingSignal) {
  return signal.direction === "short" ? "premium" : "discount";
}

function tradeTags(signal: TradingSignal): string[] {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const expected = expectedBias(signal);
  return Array.from(new Set([
    `grade:${signal.grade}`,
    `entry:${signal.plan.entrySource}`,
    `entry-status:${signal.plan.entryStatus}`,
    `stop:${signal.plan.stopSource}`,
    `target:${signal.plan.targetSource}`,
    `session:${activeSession}`,
    `pd:${signal.context.premiumDiscount.zone}`,
    `regime:${signal.context.regime.type}`,
    `event:${signal.context.eventRisk.level}`,
    signal.context.smtDivergences.some((item) => item.direction === signal.direction) ? "smt:aligned" : "smt:none",
    signal.context.premiumDiscount.zone === expectedPd(signal) ? "pd:aligned" : "pd:mismatch",
    signal.context.bias.daily === expected || signal.context.bias.h4 === expected ? "htf:aligned" : "htf:conflict",
    signal.plan.rr >= 2 ? "rr:2plus" : signal.plan.rr >= 1.5 ? "rr:ok" : "rr:low",
    signal.governance.status === "allow" ? "governance:allow" : `governance:${signal.governance.status}`
  ]));
}

function tradeProfile(signal: TradingSignal, origin: RuntimeReplayTrade["origin"]) {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  return {
    origin,
    rr: signal.plan.rr,
    entrySource: signal.plan.entrySource,
    entryStatus: signal.plan.entryStatus,
    stopSource: signal.plan.stopSource,
    targetSource: signal.plan.targetSource,
    session: activeSession,
    premiumDiscount: signal.context.premiumDiscount.zone,
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
  if (signal.context.bias.daily !== expectedBias(signal) && signal.context.bias.h4 !== expectedBias(signal)) return "htf-conflict";
  if (signal.plan.stopSource === "volatility-floor" || maxFavorableR < 0.25) return "stop-too-tight";
  return "unknown";
}

function evaluateForwardOutcome(signal: TradingSignal, futureCandles: Candle[], tagsExtra: string[] = []): ReplayOutcome {
  const tags = Array.from(new Set([...tradeTags(signal), ...tagsExtra]));
  if (!futureCandles.length) {
    return { status: "open", rMultiple: 0, maxFavorableR: 0, maxAdverseR: 0, candlesHeld: 0, outcomeReason: "expired", tags, note: "İleri mum yok; sonuç açık kaldı." };
  }

  const immediateEntry = signal.plan.entryStatus === "confirmed";
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
      note: "Entry alanı sonraki mumlarda tetiklenmedi."
    };
  }

  let maxFavorableR = 0;
  let maxAdverseR = 0;
  const afterEntry = futureCandles.slice(entryIndex);
  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    const highR = rAtPrice(signal, executableHigh(candle, signal.direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(signal, executableLow(candle, signal.direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    maxAdverseR = Math.min(maxAdverseR, highR, lowR);

    const stopHit = signal.direction === "short"
      ? executableHigh(candle, "buy") >= signal.plan.stopLoss
      : executableLow(candle, "sell") <= signal.plan.stopLoss;
    const tp2Hit = typeof signal.plan.targets[1] === "number" && (signal.direction === "short"
      ? executableLow(candle, "buy") <= signal.plan.targets[1]
      : executableHigh(candle, "sell") >= signal.plan.targets[1]);
    const tp1Hit = typeof signal.plan.targets[0] === "number" && (signal.direction === "short"
      ? executableLow(candle, "buy") <= signal.plan.targets[0]
      : executableHigh(candle, "sell") >= signal.plan.targets[0]);

    if (stopHit) {
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
    rMultiple: Math.max(-1, Math.min(maxFavorableR, 0.5)),
    maxFavorableR,
    maxAdverseR,
    candlesHeld: afterEntry.length,
    outcomeReason: "expired",
    tags,
    note: `Süre doldu; max ${maxFavorableR.toFixed(2)}R, adverse ${maxAdverseR.toFixed(2)}R.`
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
    target: signal.plan.targets[0] ?? signal.plan.entry,
    rr: signal.plan.rr,
    entrySource: signal.plan.entrySource,
    entryStatus: signal.plan.entryStatus,
    governance: signal.governance.status,
    actionWindow: signal.actionWindow.status,
    decision: stage === "ready" ? replayReadyDecision(signal) : candidateDecision(signal),
    reasons: candidateReasons(signal),
    tags: tradeTags(signal)
  };
}

function evidencePassed(signal: TradingSignal, id: string): boolean {
  return signal.evidence.find((item) => item.id === id)?.status === "pass";
}

function replayEntryRank(signal: TradingSignal): number {
  const gradeBonus = signal.grade === "A+" ? 20 : signal.grade === "A" ? 12 : signal.grade === "B" ? 5 : 0;
  const actionBonus = signal.actionWindow.status === "valid" ? 12 : signal.actionWindow.status === "waiting" ? 4 : -10;
  const smtBonus = signal.context.smtDivergences.some((item) => item.direction === signal.direction) ? 6 : 0;
  return signal.score + Math.min(signal.plan.rr, 5) * 5 + gradeBonus + actionBonus + smtBonus;
}

function replayEligibleSignal(signal: TradingSignal, minimumRR: number): boolean {
  if (signal.stage === "ready") return true;
  if (signal.stage !== "watch") return false;
  if (signal.governance.status === "block") return false;
  if (signal.context.eventRisk.level !== "clear") return false;
  if (signal.context.regime.tradeability === "blocked") return false;
  if (signal.context.dataConfidence.score < 68) return false;
  if (signal.score < REPLAY_READY_MIN_SCORE) return false;
  if (signal.plan.rr < Math.max(minimumRR, REPLAY_READY_MIN_RR)) return false;
  if (signal.plan.entryStatus === "fallback") return false;
  if (signal.plan.entrySource === "fallback-close") return false;
  if (signal.context.premiumDiscount.zone !== expectedPd(signal)) return false;
  if (signal.context.bias.daily !== expectedBias(signal) && signal.context.bias.h4 !== expectedBias(signal)) return false;
  if (!evidencePassed(signal, "sweep")) return false;
  if (!evidencePassed(signal, "mss")) return false;
  if (signal.actionWindow.status === "expired" || signal.actionWindow.status === "inactive") return false;
  return true;
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
  if (group === "rr") return value === "2plus" ? "RR 2+" : value === "ok" ? "RR uygun" : "RR düşük";
  if (group === "entry-status") return `Entry ${value}`;
  return `${group} ${value}`;
}

function calibrationFromTrades(trades: RuntimeReplayTrade[], watchAlerts: number): RuntimeReplayCalibration[] {
  const insights: RuntimeReplayCalibration[] = [];
  if (!trades.length) {
    insights.push({
      label: "READY üretimi",
      value: "0",
      detail: watchAlerts > 0
        ? `${watchAlerts} WATCH var ama READY yok. Entry/MSS/FVG şartları fazla sıkı veya son 1 ay model gelmemiş.`
        : "Son pencerede model setup üretmedi; veri ve market koşulu bekleniyor.",
      verdict: "investigate"
    });
    return insights;
  }

  const tagStats = new Map<string, { count: number; totalR: number; wins: number }>();
  for (const trade of trades) {
    for (const tag of trade.tags) {
      const current = tagStats.get(tag) ?? { count: 0, totalR: 0, wins: 0 };
      current.count += 1;
      current.totalR += trade.rMultiple;
      if (trade.rMultiple > 0) current.wins += 1;
      tagStats.set(tag, current);
    }
  }

  for (const [tag, stat] of [...tagStats.entries()].filter(([, stat]) => stat.count >= 2)) {
    const avgR = stat.totalR / stat.count;
    if (avgR <= -0.35) {
      insights.push({
        label: tagLabel(tag),
        value: `${avgR.toFixed(2)}R`,
        detail: `${stat.count} örnekte negatif. Bu koşul READY'i WATCH'a düşürmek için aday.`,
        verdict: "tighten"
      });
    } else if (avgR >= 0.45) {
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
      const verdict: RuntimeReplaySetupBreakdown["verdict"] = sample.length < 4
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
  const notes = [
    promoted.length > live.length
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
  const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
  const trades: RuntimeReplayTrade[] = [];
  const candidates: RuntimeReplayCandidate[] = [];
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : 1.5;
  let scannedWindows = 0;
  let watchAlerts = 0;
  let readyAlerts = 0;
  let liveReadyEntries = 0;
  let watchPromotedEntries = 0;

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
      const signal = strategy.scan({ context, settings }).signals[0];
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

      const replayEligible = replayEligibleSignal(signal, minimumRR);
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
      const origin: RuntimeReplayTrade["origin"] = candidate.signal.stage === "ready" ? "live-ready" : "watch-promoted";
      const baseTags = origin === "live-ready"
        ? ["replay:live-ready", "risk:daily-capped"]
        : ["replay:watch-promoted", "risk:daily-capped"];
      const adjustedFuture = confirmationAdjustedFuture(
        candidate.signal,
        market ? futureCandlesForSignal(market, candidate.time, maxHoldCandles) : []
      );
      const outcome = evaluateForwardOutcome(
        candidate.signal,
        adjustedFuture.candles,
        [...baseTags, ...adjustedFuture.tags]
      );
      const measuredOutcome = adjustedFuture.missingNote
        ? noTriggerOutcome(candidate.signal, [...baseTags, ...adjustedFuture.tags], adjustedFuture.missingNote)
        : outcome;
      trades.push({
        id: `${candidate.signal.id}-${candidate.time}-replay`,
        symbol: candidate.signal.symbol,
        direction: candidate.signal.direction,
        signalTime: candidate.time,
        ...tradeProfile(candidate.signal, origin),
        grade: candidate.signal.grade,
        score: candidate.signal.score,
        entry: candidate.signal.plan.entry,
        stopLoss: candidate.signal.plan.stopLoss,
        target: candidate.signal.plan.targets[0] ?? candidate.signal.plan.entry,
        ...measuredOutcome
      });
      applyReplayRisk(dayState, candidate.signal, measuredOutcome);
      readyAlerts += 1;
      if (origin === "live-ready") liveReadyEntries += 1;
      else watchPromotedEntries += 1;
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
    `Replay risk capped: günde max ${REPLAY_MAX_DAILY_TRADES} entry, sembol başına ${REPLAY_MAX_SYMBOL_DAILY_TRADES}, günlük stop ${REPLAY_DAILY_STOP_R}R.`
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
      setupBreakdowns: breakdowns,
      failureCases: failures,
      failureReasons: failureReasonSummary(trades),
      watchReasonSummary: watchReasonSummary(candidates),
      replayDiagnosis: replayDiagnosis(trades, breakdowns),
      trades: trades.slice(-80).reverse(),
      candidates: candidates.slice(-120).reverse(),
      sampleWarning
    }
  };
}
