import type { TradingSignal } from "../ict/types";
import type { JournalEntry, JournalSignalSnapshot } from "./types";

function rounded(value: number) {
  return Number.isFinite(value) ? value.toPrecision(10) : "na";
}

export function journalSetupKey(signal: TradingSignal): string {
  const anchor = signal.crtAnchor;
  return [
    signal.strategyId,
    signal.symbol,
    signal.direction,
    anchor?.rangeTf ?? signal.timeframe,
    anchor?.origin ?? "standard",
    anchor ? rounded(anchor.rangeHigh) : "na",
    anchor ? rounded(anchor.rangeLow) : "na",
    rounded(signal.plan.entry)
  ].join(":");
}

export function journalSignalSnapshot(signal: TradingSignal): JournalSignalSnapshot {
  return {
    stage: signal.stage,
    grade: signal.grade,
    score: signal.score,
    rr: signal.plan.rr,
    grossRR: signal.plan.grossRR,
    entrySource: signal.plan.entrySource,
    entryStatus: signal.plan.entryStatus,
    stopSource: signal.plan.stopSource,
    targetSource: signal.plan.targetSource,
    rangeTf: signal.crtAnchor?.rangeTf,
    confirmTf: signal.crtAnchor?.confirmTf ?? signal.timeframe,
    origin: signal.crtAnchor?.origin,
    setupPhase: signal.crtAnchor?.setupPhase,
    premiumDiscount: signal.context.premiumDiscount.zone,
    session: signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside",
    regime: signal.context.regime.type,
    eventRisk: signal.context.eventRisk.level,
    dataConfidence: signal.context.dataConfidence.score,
    bias: { ...signal.context.bias },
    decision: signal.decisionSummary.shortSummary,
    invalidation: signal.decisionSummary.invalidation[0],
    blockers: [...signal.governance.blockers],
    warnings: Array.from(new Set([...signal.governance.warnings, ...signal.plan.planWarnings, ...signal.riskWarnings])),
    checklist: signal.decisionSummary.checklist.map((item) => ({ label: item.label, status: item.status })),
    evidence: signal.evidence.map((item) => ({ label: item.label, status: item.status }))
  };
}

export function journalEntryFromSignal(signal: TradingSignal): JournalEntry {
  const now = Date.now();
  const snapshot = journalSignalSnapshot(signal);
  return {
    tradeId: signal.id,
    setupKey: journalSetupKey(signal),
    createdAt: now,
    updatedAt: now,
    strategy: signal.strategyId,
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    target: signal.plan.targets[1] ?? signal.plan.targets[0],
    tradeAction: "watch",
    result: "open",
    ruleViolations: [],
    signalSnapshot: snapshot,
    latestSignalSnapshot: snapshot,
    history: []
  };
}
