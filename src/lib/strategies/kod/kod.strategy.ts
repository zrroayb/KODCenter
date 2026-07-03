import { buildDecisionSummary } from "../../brain/financialBrain";
import type { Candle, ExecutionCostStress, FairValueGap, MarketContext, MarketSymbol, SignalEvidenceItem, SignalStage, StopSource, TargetSource, TradeDirection, TradePlan, TradingSignal } from "../../ict/types";
import { executableClose, executableHigh, executableLow } from "../../data/bidAsk";
import { calculatePositionSize } from "../../risk/positionSizing";
import { defaultAccountModel } from "../../risk/accountModel";
import { estimateExecutionCosts } from "../../risk/executionCosts";
import { performanceFromSignals } from "../../analytics/performance";
import { buildIctSequence, type IctSequence } from "../../intelligence/ictSequenceEngine";
import { buildActionWindow, evaluateSignalOutcome } from "../../intelligence/outcomeEngine";
import { buildSetupGovernance } from "../../intelligence/setupGovernance";
import type { BacktestInput, StrategyInput, StrategyModule, StrategyResult } from "../types";
import { buildKodEntryModel } from "./entryModel";
import { kodRuleResults } from "./kod.rules";
import { kodGrade, kodScore } from "./kod.scoring";

const KOD_STRATEGY_ID = "kod-turtle-soup-reclaim";
const DEFAULT_MINIMUM_RR = 1.5;
const SYMBOL_MIN_BUFFER: Record<MarketSymbol, number> = {
  XAUUSD: 0.8,
  NAS100: 12,
  EURUSD: 0.0002,
  GBPUSD: 0.0002,
  BTCUSD: 120
};

const STOP_PROFILE_MULTIPLIERS = {
  aggressive: { buffer: 0.75, floor: 0.82 },
  normal: { buffer: 1, floor: 1 },
  conservative: { buffer: 1.35, floor: 1.25 }
} as const;
const MAX_READY_CHASE_R = 0.35;

type StopProfile = keyof typeof STOP_PROFILE_MULTIPLIERS;

type StopCandidate = {
  source: StopSource;
  level: number;
};

type TargetCandidate = {
  source: TargetSource;
  level: number;
};

type SignalLifecycle = {
  stage: Extract<SignalStage, "watch" | "ready" | "invalidated" | "missed">;
  warnings: string[];
};

function inferDirection(context: MarketContext): TradeDirection {
  const latestSweep = context.sweeps.find((sweep) => sweep.reclaimed);
  if (latestSweep?.side === "buy-side") return "short";
  if (latestSweep?.side === "sell-side") return "long";
  if (context.bias.h4 === "bearish") return "short";
  return "long";
}

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function latestByIndex<T extends { candleIndex: number }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function stopSourceLabel(source: StopSource): string {
  if (source === "sweep") return "sweep";
  if (source === "fvg") return "FVG";
  if (source === "swing") return "recent swing";
  return "volatility floor";
}

function recentStructureLevel(candles: Candle[], direction: TradeDirection): number | undefined {
  const sample = candles.slice(Math.max(0, candles.length - 18), Math.max(0, candles.length - 1));
  if (!sample.length) return undefined;
  return direction === "short"
    ? Math.max(...sample.map((candle) => candle.high))
    : Math.min(...sample.map((candle) => candle.low));
}

function stopCandidates(context: MarketContext, direction: TradeDirection, candles: Candle[], entry: number, planGap?: FairValueGap): StopCandidate[] {
  const expectedSweepSide = direction === "short" ? "buy-side" : "sell-side";
  const sweep = latestByIndex(context.sweeps.filter((item) => item.side === expectedSweepSide && item.reclaimed));
  const fvg = planGap?.direction === direction ? planGap : undefined;
  const swing = recentStructureLevel(candles, direction);
  const candidates: StopCandidate[] = [];
  if (sweep) candidates.push({ source: "sweep", level: sweep.level });
  if (fvg) candidates.push({ source: "fvg", level: direction === "short" ? fvg.high : fvg.low });
  if (typeof swing === "number") candidates.push({ source: "swing", level: swing });
  return candidates;
}

function selectStructureStop(candidates: StopCandidate[], direction: TradeDirection): StopCandidate {
  return candidates.reduce((selected, candidate) => {
    if (direction === "short") return candidate.level > selected.level ? candidate : selected;
    return candidate.level < selected.level ? candidate : selected;
  });
}

function targetCandidates(context: MarketContext, direction: TradeDirection, entry: number): TargetCandidate[] {
  const profitSide = direction === "short" ? "sell-side" : "buy-side";
  const rangeTarget = direction === "short" ? context.dealingRange.low : context.dealingRange.high;
  const candidates: TargetCandidate[] = [];
  for (const objective of (context.liquidityObjectives ?? []).filter((item) => item.side === profitSide)) {
    if ((direction === "short" && objective.level < entry) || (direction === "long" && objective.level > entry)) {
      candidates.push({ source: "liquidity", level: objective.level });
    }
  }
  if ((direction === "short" && rangeTarget < entry) || (direction === "long" && rangeTarget > entry)) {
    candidates.push({ source: "dealing-range", level: rangeTarget });
  }
  for (const pool of context.liquidityPools.filter((item) => item.side === profitSide)) {
    if ((direction === "short" && pool.level < entry) || (direction === "long" && pool.level > entry)) {
      candidates.push({ source: "liquidity", level: pool.level });
    }
  }
  const distinct = candidates.filter((candidate, index) =>
    candidates.findIndex((item) => Math.abs(item.level - candidate.level) < Math.abs(entry) * 0.000001) === index
  );
  return distinct.sort((a, b) => Math.abs(a.level - entry) - Math.abs(b.level - entry));
}

function projectionTarget(entry: number, riskDistance: number, direction: TradeDirection, multiple: number): number {
  return direction === "short" ? entry - riskDistance * multiple : entry + riskDistance * multiple;
}

function stopProfileFromSettings(value: unknown): StopProfile {
  return value === "aggressive" || value === "conservative" ? value : "normal";
}

function executionCostStressFromSettings(settings: StrategyInput["settings"]): ExecutionCostStress {
  if (settings.useExecutionCosts === false) return "off";
  return settings.slippageStress === "high" ? "high" : "normal";
}

function setupStartIndex(context: MarketContext, direction: TradeDirection, plan?: TradePlan): number {
  const expectedSweepSide = direction === "short" ? "buy-side" : "sell-side";
  const planGapIndex = plan && (plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest")
    ? plan.entryModel.fairValueGap?.candleIndex
    : undefined;
  const indexes = [
    latestByIndex(context.sweeps.filter((sweep) => sweep.side === expectedSweepSide && sweep.reclaimed))?.candleIndex,
    latestByIndex(context.displacements.filter((item) => item.direction === direction))?.candleIndex,
    latestByIndex(context.marketStructureShifts.filter((item) => item.direction === direction))?.candleIndex,
    planGapIndex
  ].filter((index): index is number => typeof index === "number");

  return indexes.length ? Math.max(...indexes) : Math.max(0, executionCandles(context).length - 1);
}

function candlesSinceSetup(context: MarketContext, direction: TradeDirection, plan?: TradePlan): Candle[] {
  const candles = executionCandles(context);
  return candles.slice(Math.min(Math.max(setupStartIndex(context, direction, plan), 0), Math.max(candles.length - 1, 0)));
}

function evaluateSignalLifecycle(context: MarketContext, direction: TradeDirection, plan: TradePlan, readyCandidate: boolean): SignalLifecycle {
  const candles = candlesSinceSetup(context, direction, plan);
  const latest = candles[candles.length - 1];
  const stopTouched = candles.some((candle) =>
    direction === "short" ? executableHigh(candle, "buy") >= plan.stopLoss : executableLow(candle, "sell") <= plan.stopLoss
  );
  const firstTarget = plan.targets[0];
  const targetTouched = typeof firstTarget === "number"
    ? candles.some((candle) =>
        direction === "short" ? executableLow(candle, "buy") <= firstTarget : executableHigh(candle, "sell") >= firstTarget
      )
    : false;

  if (stopTouched) {
    return {
      stage: "invalidated",
      warnings: ["Setup stop/invalidation gördü; yeni setup beklenmeli."]
    };
  }

  if (targetTouched) {
    return {
      stage: "missed",
      warnings: ["Setup hedefe gitmiş; geç entry kovalanmamalı."]
    };
  }

  if (latest && plan.entryStatus === "confirmed") {
    const executablePrice = executableClose(latest, direction === "short" ? "sell" : "buy");
    const movedInProfit = direction === "short" ? plan.entry - executablePrice : executablePrice - plan.entry;
    const movedR = movedInProfit / Math.max(plan.riskDistance, 0.000001);
    if (movedR > MAX_READY_CHASE_R) {
      return {
        stage: "missed",
        warnings: [`Entry kaçtı: fiyat girişten ${movedR.toFixed(2)}R uzaklaştı; yeni retest/setup beklenmeli.`]
      };
    }
  }

  return {
    stage: readyCandidate ? "ready" : "watch",
    warnings: []
  };
}

export function buildStructureRiskPlan(
  context: MarketContext,
  direction: TradeDirection,
  minimumRR = DEFAULT_MINIMUM_RR,
  stopProfile: StopProfile = "normal",
  executionCostStress: ExecutionCostStress = "normal"
): TradePlan {
  const candles = context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  const entryModel = buildKodEntryModel(context, direction);
  const entry = entryModel.level;
  const minBuffer = SYMBOL_MIN_BUFFER[context.symbol];
  const profile = STOP_PROFILE_MULTIPLIERS[stopProfile];
  const stopBuffer = Math.max(context.volatility.atr * 0.2 * profile.buffer, context.volatility.averageRange * 0.15 * profile.buffer, minBuffer);
  const minimumRiskDistance = Math.max(context.volatility.atr * profile.floor, context.volatility.averageRange * 0.8 * profile.floor, minBuffer * 2);
  const candidates = stopCandidates(context, direction, candles, entry, entryModel.fairValueGap);
  const selectedStop = candidates.length
    ? selectStructureStop(candidates, direction)
    : { source: "volatility-floor" as const, level: entry };
  const structureStop = direction === "short" ? selectedStop.level + stopBuffer : selectedStop.level - stopBuffer;
  const structureRiskDistance = Math.abs(entry - structureStop);
  const structureStopIsValid = direction === "short" ? structureStop > entry : structureStop < entry;
  const planWarnings: string[] = [];
  let stopSource: StopSource = selectedStop.source;
  let stopLoss = structureStop;

  if (!structureStopIsValid || structureRiskDistance < minimumRiskDistance) {
    stopSource = "volatility-floor";
    stopLoss = direction === "short" ? entry + minimumRiskDistance : entry - minimumRiskDistance;
    planWarnings.push("Structure stop entry'ye çok yakın; volatility floor uygulandı.");
  }

  const riskDistance = Math.abs(entry - stopLoss);
  const targets = targetCandidates(context, direction, entry);
  const primary = targets[0] ?? { source: "projection" as const, level: projectionTarget(entry, riskDistance, direction, 2) };
  const secondary = targets[1]?.level ?? projectionTarget(entry, riskDistance, direction, primary.source === "projection" ? 3 : 2);
  const executionCosts = estimateExecutionCosts({
    symbol: context.symbol,
    entry,
    stopLoss,
    target: primary.level,
    stress: executionCostStress
  });
  const grossRR = executionCosts.grossRR;
  const rr = executionCosts.netRR;

  if (rr < minimumRR) {
    const reason = grossRR >= minimumRR
      ? `Friction sonrası net RR ${rr.toFixed(2)}; gross ${grossRR.toFixed(2)}, minimum ${minimumRR}. READY değil.`
      : `Gerçek structure stop geniş: net RR ${rr.toFixed(2)}, minimum ${minimumRR}. READY değil.`;
    planWarnings.push(reason);
  }

  return {
    entry,
    entrySource: entryModel.source,
    entryStatus: entryModel.status,
    entryModel,
    stopLoss,
    targets: [primary.level, secondary],
    invalidation: stopLoss,
    rr,
    grossRR,
    riskDistance,
    stopSource,
    stopBuffer,
    targetSource: primary.source,
    executionCosts,
    planWarnings: Array.from(new Set([
      `Stop ${stopSourceLabel(stopSource)} arkasına ${stopBuffer.toFixed(5)} buffer ile kondu (${stopProfile}).`,
      `Entry ${entryModel.source} / ${entryModel.status}: ${entryModel.level.toFixed(5)}.`,
      ...entryModel.warnings,
      ...(executionCostStress !== "off" ? [`Spread/slippage dahil net RR ${rr.toFixed(2)}; gross RR ${grossRR.toFixed(2)}.`] : []),
      ...planWarnings
    ]))
  };
}

function candleTime(context: MarketContext, index: number | undefined): number | undefined {
  const candles = executionCandles(context);
  return typeof index === "number" ? candles[index]?.time : undefined;
}

function buildSignalEvidence(
  context: MarketContext,
  direction: TradeDirection,
  plan: TradePlan,
  lifecycle: SignalLifecycle,
  riskPolicy: string,
  sequence: IctSequence
): SignalEvidenceItem[] {
  const expectedSweepSide = direction === "short" ? "buy-side" : "sell-side";
  const sweep = latestByIndex(context.sweeps.filter((item) => item.side === expectedSweepSide && item.reclaimed));
  const displacement = latestByIndex(context.displacements.filter((item) => item.direction === direction));
  const mss = latestByIndex(context.marketStructureShifts.filter((item) => item.direction === direction));
  const fvg = (plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest") ? plan.entryModel.fairValueGap : undefined;
  const fvgLabel = plan.entrySource === "ifvg-retest" ? "iFVG" : "FVG";
  const smt = latestByIndex(context.smtDivergences.filter((item) => item.direction === direction));
  const objective = (context.liquidityObjectives ?? [])
    .filter((item) => item.side === (direction === "short" ? "sell-side" : "buy-side"))
    .sort((a, b) => Math.abs(a.level - plan.entry) - Math.abs(b.level - plan.entry))[0];
  const expectedPd = direction === "short" ? "premium" : "discount";
  const expectedBias = direction === "short" ? "bearish" : "bullish";

  return [
    {
      id: "ict-sequence",
      label: "ICT sequence",
      status: sequence.ready ? "pass" : sequence.hardBlockers.length ? "warning" : "neutral",
      detail: `${sequence.summary} Quality ${sequence.qualityScore}.`,
      timeframe: "15m",
      candleIndex: sequence.mss?.candleIndex ?? sequence.displacement?.candleIndex ?? sequence.sweep?.candleIndex,
      time: candleTime(context, sequence.mss?.candleIndex ?? sequence.displacement?.candleIndex ?? sequence.sweep?.candleIndex),
      price: sequence.mss?.level ?? sequence.sweep?.level
    },
    {
      id: "governance",
      label: "Governance",
      status: "neutral",
      detail: `${context.regime.summary} · ${context.eventRisk.summary} · ${context.dataConfidence.summary}`,
      timeframe: "15m"
    },
    {
      id: "market-regime",
      label: "Market regime",
      status: context.regime.tradeability === "good" ? "pass" : context.regime.tradeability === "caution" ? "neutral" : "warning",
      detail: `${context.regime.type}: ${context.regime.summary} Efficiency ${context.regime.efficiency.toFixed(2)}, vol ${context.regime.volatilityRatio.toFixed(2)}x.`,
      timeframe: "15m"
    },
    {
      id: "event-risk",
      label: "Event risk",
      status: context.eventRisk.noTrade ? "warning" : context.eventRisk.level === "watch" ? "neutral" : "pass",
      detail: context.eventRisk.summary,
      timeframe: "15m"
    },
    {
      id: "data-confidence",
      label: "Data confidence",
      status: context.dataConfidence.score >= 68 ? "pass" : context.dataConfidence.score >= 35 ? "neutral" : "warning",
      detail: context.dataConfidence.summary,
      timeframe: "15m"
    },
    {
      id: "entry-model",
      label: "Entry model",
      status: plan.entryStatus === "confirmed" ? "pass" : plan.entryStatus === "pending" ? "neutral" : "warning",
      detail: `${plan.entrySource} ${plan.entryStatus}; retest ${plan.entryModel.retested ? "var" : "yok"}, CISD/MSS ${plan.entryModel.cisdConfirmed ? "var" : "yok"}.`,
      timeframe: "15m",
      price: plan.entry
    },
    {
      id: "htf-bias",
      label: "HTF bias",
      status: context.bias.daily === expectedBias || context.bias.h4 === expectedBias ? "pass" : "warning",
      detail: `Daily/H4/H1: ${context.bias.daily} / ${context.bias.h4} / ${context.bias.h1}`,
      timeframe: "4h"
    },
    {
      id: "pd-zone",
      label: "Premium / Discount",
      status: context.premiumDiscount.zone === expectedPd || context.premiumDiscount.zone === "equilibrium" ? "pass" : "warning",
      detail: `${direction.toUpperCase()} için ideal ${expectedPd}; şu an ${context.premiumDiscount.zone}.`,
      price: context.premiumDiscount.midpoint
    },
    {
      id: "sweep",
      label: "Liquidity sweep",
      status: sweep ? "pass" : "fail",
      detail: sweep ? `${sweep.side} reclaim ${sweep.level.toFixed(5)}` : `${expectedSweepSide} sweep + reclaim yok.`,
      timeframe: "15m",
      candleIndex: sweep?.candleIndex,
      time: candleTime(context, sweep?.candleIndex),
      price: sweep?.level
    },
    {
      id: "displacement",
      label: "Displacement",
      status: displacement ? "pass" : "fail",
      detail: displacement ? `${direction} impulse, body ${displacement.bodyRatio.toFixed(2)}, range ${displacement.rangeAtr.toFixed(2)} ATR.` : `${direction} displacement yok.`,
      timeframe: "15m",
      candleIndex: displacement?.candleIndex,
      time: candleTime(context, displacement?.candleIndex)
    },
    {
      id: "mss",
      label: "MSS",
      status: mss ? "pass" : "fail",
      detail: mss ? `${direction} MSS close ${mss.level.toFixed(5)}` : `${direction} MSS kapanışı yok.`,
      timeframe: "15m",
      candleIndex: mss?.candleIndex,
      time: candleTime(context, mss?.candleIndex),
      price: mss?.level
    },
    {
      id: "fvg",
      label: "FVG / iFVG",
      status: fvg ? (fvg.mitigated ? "warning" : "pass") : "warning",
      detail: fvg ? `${fvgLabel} entry zone ${fvg.low.toFixed(5)}-${fvg.high.toFixed(5)}${fvg.mitigated ? " retest/mitigated" : ""}.` : "Planlı FVG/iFVG yok; entry MSS/close fallback üzerinden.",
      timeframe: "15m",
      candleIndex: fvg?.candleIndex,
      time: candleTime(context, fvg?.candleIndex),
      price: fvg?.midpoint
    },
    {
      id: "smt",
      label: "SMT",
      status: smt ? "pass" : "neutral",
      detail: smt ? smt.note : "SMT pair teyidi yok veya uygun pair verisi yok.",
      timeframe: "15m",
      candleIndex: smt?.candleIndex,
      time: smt?.time,
      price: smt?.localExtreme
    },
    {
      id: "liquidity-objective",
      label: "Liquidity objective",
      status: objective ? "pass" : "warning",
      detail: objective ? `${objective.kind} ${objective.level.toFixed(5)} · ${objective.source}` : "PDH/PDL/PWH/PWL/PMH/PML tarafında uygun objective yok.",
      timeframe: objective?.timeframe,
      price: objective?.level
    },
    {
      id: "risk-plan",
      label: "Risk plan",
      status: plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning",
      detail: `Entry ${plan.entry.toFixed(5)}, SL ${plan.stopLoss.toFixed(5)}, TP1 ${plan.targets[0].toFixed(5)}, net RR 1:${plan.rr.toFixed(2)}, gross 1:${plan.grossRR.toFixed(2)}.`,
      timeframe: "15m",
      price: plan.entry
    },
    {
      id: "execution-cost",
      label: "Execution cost",
      status: plan.executionCosts.stress === "off" ? "neutral" : plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning",
      detail: plan.executionCosts.stress === "off"
        ? "Spread/slippage modeli kapalı."
        : `Stress ${plan.executionCosts.stress}; spread ${plan.executionCosts.spread.toFixed(5)}, slippage ${plan.executionCosts.slippage.toFixed(5)}, toplam ${plan.executionCosts.total.toFixed(5)}.`,
      timeframe: "15m"
    },
    {
      id: "risk-policy",
      label: "Risk policy",
      status: "neutral",
      detail: riskPolicy,
      timeframe: "15m"
    },
    {
      id: "lifecycle",
      label: "Lifecycle",
      status: lifecycle.stage === "ready" ? "pass" : lifecycle.stage === "watch" ? "neutral" : "warning",
      detail: lifecycle.warnings[0] ?? (lifecycle.stage === "ready" ? "Setup aktif ve READY." : "Setup izleme modunda."),
      timeframe: "15m"
    }
  ];
}

function signalFromContext(context: MarketContext, settings: StrategyInput["settings"]): TradingSignal {
  const direction = inferDirection(context);
  const execution = executionCandles(context);
  const latestExecutionCandle = execution[execution.length - 1];
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const stopProfile = stopProfileFromSettings(settings.stopProfile);
  const executionCostStress = executionCostStressFromSettings(settings);
  const riskPolicy = [
    `stop ${stopProfile}`,
    executionCostStress === "off" ? "spread/slippage kapalı" : `spread/slippage ${executionCostStress}`,
    settings.partialTpEnabled ? "partial TP açık" : "partial TP kapalı",
    `BE ${typeof settings.moveToBreakevenAtR === "number" ? settings.moveToBreakevenAtR : 1}R`,
    `max günlük risk ${typeof settings.maxDailyRiskPct === "number" ? settings.maxDailyRiskPct : 2}%`,
    settings.avoidNews ? "haber filtresi manuel kontrol" : "haber filtresi kapalı"
  ].join(" · ");
  const rawPlan = buildStructureRiskPlan(context, direction, minimumRR, stopProfile, executionCostStress);
  const sequence = buildIctSequence(context, direction, rawPlan);
  const ruleResults = kodRuleResults(context, direction, rawPlan.rr, minimumRR, rawPlan, sequence);
  const baseScore = kodScore(ruleResults);
  const outcome = evaluateSignalOutcome(context, direction, rawPlan, sequence.setupStartIndex);
  const governance = buildSetupGovernance({
    context,
    plan: rawPlan,
    outcome,
    sequenceStatus: sequence.status,
    avoidNews: settings.avoidNews !== false
  });
  const score = Math.max(0, Math.min(100, baseScore + governance.scoreImpact));
  const grade = kodGrade(score);
  const readyCandidate = governance.status !== "block" && sequence.ready && rawPlan.rr >= minimumRR && rawPlan.entryStatus === "confirmed";
  const lifecycle = evaluateSignalLifecycle(context, direction, rawPlan, readyCandidate);
  const actionWindow = buildActionWindow(context, rawPlan, outcome, lifecycle.stage);
  const planWarnings = Array.from(new Set([
    ...rawPlan.planWarnings,
    ...sequence.warnings,
    ...sequence.hardBlockers,
    ...governance.blockers,
    ...governance.warnings,
    ...context.regime.warnings,
    ...context.eventRisk.warnings,
    ...context.dataConfidence.warnings,
    outcome.summary,
    actionWindow.summary,
    ...lifecycle.warnings
  ]));
  const plan = { ...rawPlan, planWarnings };
  const position = calculatePositionSize({
    account: defaultAccountModel,
    symbol: context.symbol,
    entry: plan.entry,
    stopLoss: plan.stopLoss,
    target: plan.targets[0]
  });
  const decisionSummary = buildDecisionSummary({
    context,
    direction,
    plan,
    grade,
    riskWarnings: position.warnings
  });
  return {
    id: `${context.symbol}-${direction}-${latestExecutionCandle?.time ?? Date.now()}`,
    strategyId: KOD_STRATEGY_ID,
    symbol: context.symbol,
    direction,
    stage: lifecycle.stage,
    grade,
    score,
    createdAt: Date.now(),
    timeframe: "15m",
    plan,
    context,
    decisionSummary,
    evidence: [
      ...buildSignalEvidence(context, direction, plan, lifecycle, riskPolicy, sequence),
      {
        id: "outcome-replay",
        label: "Outcome replay",
        status: outcome.status === "stopped" ? "warning" : outcome.status === "tp1" || outcome.status === "tp2" ? "warning" : outcome.entryTouched ? "pass" : "neutral",
        detail: outcome.summary,
        timeframe: "15m",
        candleIndex: outcome.exitCandleIndex ?? outcome.entryCandleIndex
      },
      {
        id: "action-window",
        label: "Action window",
        status: actionWindow.status === "valid" ? "pass" : actionWindow.status === "expired" || actionWindow.status === "inactive" ? "warning" : "neutral",
        detail: actionWindow.summary,
        timeframe: "15m",
        time: actionWindow.validUntil
      }
    ],
    riskWarnings: position.warnings,
    outcome,
    governance,
    actionWindow
  };
}

export const kodStrategy: StrategyModule = {
  id: KOD_STRATEGY_ID,
  name: "ICT Kiss of Death",
  description: "HTF draw, Turtle Soup raid/reclaim, displacement, MSS, FVG and risk-first manual plan.",
  requiredTimeframes: ["1d", "4h", "1h", "15m", "5m"],
  defaultSettings: {
    minimumRR: 1.5,
    mode: "watch_ready",
    useExecutionCosts: true,
    slippageStress: "normal",
    noAutoExecution: true
  },
  scan(input: StrategyInput): StrategyResult {
    const signal = signalFromContext(input.context, input.settings);
    const rejectedSetups =
      signal.stage === "ready"
        ? []
        : [{ symbol: input.context.symbol, strategyId: this.id, reason: signal.decisionSummary.warnings[0] ?? "Waiting for cleaner KOD confirmation.", score: signal.score }];
    return { signals: [signal], rejectedSetups };
  },
  backtest(input: BacktestInput) {
    const signals = input.contexts.map((context) => signalFromContext(context, input.settings));
    return performanceFromSignals(signals);
  }
};
