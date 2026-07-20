import type { MarketContext, TradingSignal } from "../ict/types";
import { signalDecisionClass } from "../signals/signalClassification";
import { getStrategy } from "../strategies/registry";
import type { RejectedSetup } from "../strategies/types";
import { ruleAllowsContext, ruleAllowsSignal } from "../userRules/applyRules";
import type { UserRules } from "../userRules/userRules";

const SIGNAL_STAGE_RANK: Record<TradingSignal["stage"], number> = {
  ready: 4,
  watch: 3,
  missed: 2,
  invalidated: 1
};

const SETUP_PHASE_RANK: Record<string, number> = {
  ready: 3,
  model: 2,
  raid: 1,
  context: 0
};

export type ScanRuntimeResult = {
  signals: TradingSignal[];
  hiddenSignals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  rejected: RejectedSetup[];
};

export function compareSignalsByDecision(a: TradingSignal, b: TradingSignal) {
  const invalidDifference = Number(signalDecisionClass(a) === "invalid") - Number(signalDecisionClass(b) === "invalid");
  if (invalidDifference) return invalidDifference;

  const stageDifference = (SIGNAL_STAGE_RANK[b.stage] ?? 0) - (SIGNAL_STAGE_RANK[a.stage] ?? 0);
  if (stageDifference) return stageDifference;

  if (a.stage === "watch" && b.stage === "watch") {
    const blockerDifference = a.governance.blockers.length - b.governance.blockers.length;
    if (blockerDifference) return blockerDifference;

    const rrReadyDifference = Number(b.plan.rr >= 1.5) - Number(a.plan.rr >= 1.5);
    if (rrReadyDifference) return rrReadyDifference;

    const phaseDifference = (SETUP_PHASE_RANK[String(b.crtAnchor?.setupPhase)] ?? 0)
      - (SETUP_PHASE_RANK[String(a.crtAnchor?.setupPhase)] ?? 0);
    if (phaseDifference) return phaseDifference;
  }

  return b.score - a.score || b.plan.rr - a.plan.rr;
}

export function scanContexts(
  contexts: MarketContext[],
  strategyId: string,
  rules: UserRules
): ScanRuntimeResult {
  const strategy = getStrategy(strategyId);
  const results = contexts
    .filter((context) => ruleAllowsContext(context, rules))
    .map((context) => strategy.scan({
      context,
      settings: {
        ...strategy.defaultSettings,
        minimumRR: rules.minimumRR,
        stopProfile: rules.stopProfile,
        useExecutionCosts: rules.useExecutionCosts,
        slippageStress: rules.slippageStress,
        partialTpEnabled: rules.partialTpEnabled,
        moveToBreakevenAtR: rules.moveToBreakevenAtR,
        maxDailyRiskPct: rules.maxDailyRiskPct,
        avoidNews: rules.avoidNews,
        useHtfAlignmentFilter: rules.useHtfAlignmentFilter
      }
    }));

  const rawSignals = results.flatMap((result) => result.signals);
  const activeSignals = rawSignals
    .filter((signal) => signal.stage !== "invalidated" && signal.stage !== "missed")
    .sort(compareSignalsByDecision);
  const tradeCandidates = activeSignals.filter((signal) => signalDecisionClass(signal) !== "invalid");
  const invalidCandidates = activeSignals.filter((signal) => signalDecisionClass(signal) === "invalid");
  const visibleCandidates = tradeCandidates.filter((signal) => ruleAllowsSignal(signal, rules));
  const visibleSignals = visibleCandidates.slice(0, rules.maxSignalsPerScan);
  const hiddenCandidates = [
    ...invalidCandidates,
    ...tradeCandidates.filter((signal) => !ruleAllowsSignal(signal, rules)),
    ...visibleCandidates.slice(rules.maxSignalsPerScan)
  ];
  const seenHiddenSignals = new Set<string>();
  const hiddenSignals = hiddenCandidates
    .filter((signal) => {
      if (seenHiddenSignals.has(signal.id)) return false;
      seenHiddenSignals.add(signal.id);
      return true;
    })
    .slice(0, 24);
  const inactiveSignals = rawSignals
    .filter((signal) => signal.stage === "invalidated" || signal.stage === "missed")
    .sort(compareSignalsByDecision);

  return {
    signals: visibleSignals,
    hiddenSignals,
    inactiveSignals: inactiveSignals.slice(0, 24),
    rejected: results.flatMap((result) => result.rejectedSetups)
  };
}

// Telegram parity gate: an alert may only fire for a READY signal the site actually lists.
// hiddenSignals hold what the rules/cap/decision-class deliberately rejected — alerting on
// them produces "the bot pinged but the site shows nothing".
export function alertableReadySignals(result: ScanRuntimeResult): TradingSignal[] {
  const seen = new Set<string>();
  return result.signals
    .filter((signal) => signal.stage === "ready")
    .filter((signal) => {
      if (seen.has(signal.id)) return false;
      seen.add(signal.id);
      return true;
    });
}
