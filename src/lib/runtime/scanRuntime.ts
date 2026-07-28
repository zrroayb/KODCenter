import type { MarketContext, TradingSignal } from "../ict/types";
import { signalDecisionClass } from "../signals/signalClassification";
import { getStrategy, PLAYBOOK_STRATEGIES } from "../strategies/registry";
import type { RejectedSetup, StrategyModule } from "../strategies/types";
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

  // Chop (zıt raid çakışması) = tradeable değil; aynı stage içinde en dibe iner.
  const chopDifference = Number(Boolean(a.chopConflict)) - Number(Boolean(b.chopConflict));
  if (chopDifference) return chopDifference;

  // Trende karşı (counter-trend) fade'ler aynı stage içinde trend-yönü sinyallerin ALTINDA sıralanır
  // — headline/karar bir counter-trend fade olmasın; continuation/with-trend varsa o öne çıksın.
  const counterTrendDifference = Number(Boolean(a.counterTrend)) - Number(Boolean(b.counterTrend));
  if (counterTrendDifference) return counterTrendDifference;

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
  // İki playbook birlikte koşar: CRT Reversal + Trend Continuation. strategyId artık "birincil"
  // playbook'u işaret eder; listede yoksa yine tüm playbook'lar taranır. Her sinyal kendi
  // strategyId etiketini taşır, böylece aynı setup iki isimle görünmez (reversal vs continuation
  // yapısal olarak birbirini dışlar: reclaim+karşı CHoCH vs same-direction BOS kabulü).
  const primary = getStrategy(strategyId);
  const strategies: StrategyModule[] = [primary, ...PLAYBOOK_STRATEGIES.filter((strategy) => strategy.id !== primary.id)];
  const allowedContexts = contexts.filter((context) => ruleAllowsContext(context, rules));
  const results = strategies.flatMap((strategy) =>
    allowedContexts.map((context) => strategy.scan({
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
    }))
  );

  const rawSignals = results.flatMap((result) => result.signals);
  const activeSignals = rawSignals
    .filter((signal) => signal.stage !== "invalidated" && signal.stage !== "missed")
    .sort(compareSignalsByDecision);
  const tradeCandidates = activeSignals.filter((signal) => signalDecisionClass(signal) !== "invalid");
  const invalidCandidates = activeSignals.filter((signal) => signalDecisionClass(signal) === "invalid");
  const visibleCandidates = tradeCandidates.filter((signal) => ruleAllowsSignal(signal, rules));
  // HTF (1d/1w) watch/ready = büyük-resim context; global cap onu ASLA gizlememeli (2026-07-28:
  // BTC 1d long C/58, LTF watch'ların altında cap dışı kalıp kayboluyordu). Cap'i doldururuz, sonra
  // cap dışı kalan HTF setup'ları geri ekleriz — chop/counter-trend olmayanlar.
  const isHtfContext = (signal: TradingSignal) =>
    (signal.crtAnchor?.rangeTf === "1d" || signal.crtAnchor?.rangeTf === "1w")
    && (signal.stage === "ready" || signal.stage === "watch")
    && !signal.chopConflict;
  const cappedVisible = visibleCandidates.slice(0, rules.maxSignalsPerScan);
  const cutHtfContext = visibleCandidates.slice(rules.maxSignalsPerScan).filter(isHtfContext);
  const visibleSignals = [...cappedVisible, ...cutHtfContext];
  const promotedIds = new Set(visibleSignals.map((signal) => signal.id));
  const hiddenCandidates = [
    ...invalidCandidates,
    ...tradeCandidates.filter((signal) => !ruleAllowsSignal(signal, rules)),
    ...visibleCandidates.slice(rules.maxSignalsPerScan).filter((signal) => !promotedIds.has(signal.id))
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
