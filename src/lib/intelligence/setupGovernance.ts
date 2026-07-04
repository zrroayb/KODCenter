import type { DecisionChecklistItem, MarketContext, SignalGovernance, SignalOutcome, TradePlan } from "../ict/types";
import type { IctSequenceStatus } from "./ictSequenceEngine";

function item(label: string, status: DecisionChecklistItem["status"], explanation: string): DecisionChecklistItem {
  return { label, status, explanation };
}

export function buildSetupGovernance(input: {
  context: MarketContext;
  plan: TradePlan;
  outcome: SignalOutcome;
  sequenceStatus: IctSequenceStatus;
  avoidNews: boolean;
}): SignalGovernance {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let scoreImpact = 0;

  if (input.avoidNews && input.context.eventRisk.noTrade) {
    blockers.push(`Haber/no-trade: ${input.context.eventRisk.summary}`);
    scoreImpact -= 25;
  } else if (input.context.eventRisk.level === "watch") {
    warnings.push(`Yakın event: ${input.context.eventRisk.summary}`);
    scoreImpact -= 8;
  }

  if (input.context.regime.tradeability === "blocked") {
    blockers.push(`Rejim uygun değil: ${input.context.regime.summary}`);
    scoreImpact += input.context.regime.scoreImpact;
  } else if (input.context.regime.tradeability === "caution") {
    warnings.push(input.context.regime.summary);
    scoreImpact += input.context.regime.scoreImpact;
  } else {
    scoreImpact += input.context.regime.scoreImpact;
  }

  if (input.context.dataConfidence.score < 35) {
    blockers.push(`Veri güveni çok düşük: ${input.context.dataConfidence.summary}`);
    scoreImpact -= 20;
  } else if (input.context.dataConfidence.score < 68) {
    warnings.push(input.context.dataConfidence.summary);
    scoreImpact -= 8;
  }

  if (input.context.retracement.currentPct > 88) {
    warnings.push(`Deep retracement: ${input.context.retracement.summary}`);
    scoreImpact -= 6;
  }
  const activeOrderBlock = [...input.context.orderBlocks].reverse().find((item) => item.direction === (input.plan.entry < input.plan.stopLoss ? "short" : "long"));
  if (activeOrderBlock?.mitigated) {
    warnings.push("OB daha önce mitigated; tepki kalitesi düşebilir.");
    scoreImpact -= 4;
  }

  if (input.outcome.status === "stopped") {
    blockers.push("Replay sonucu stop/invalidation görmüş; yeni setup bekle.");
    scoreImpact -= 30;
  }
  if (input.outcome.status === "tp1" || input.outcome.status === "tp2") {
    blockers.push("Replay sonucu hedef görülmüş; geç entry kovalanmaz.");
    scoreImpact -= 25;
  }
  if (input.sequenceStatus === "invalid") {
    blockers.push("ICT sequence invalid: setup sırası bozulmuş.");
    scoreImpact -= 18;
  }
  if (input.plan.rr < 1.5) {
    warnings.push("Net RR minimum kurumsal eşiğin altında.");
  }

  const checklist = [
    item("Event risk", input.context.eventRisk.noTrade ? "fail" : input.context.eventRisk.level === "watch" ? "neutral" : "pass", input.context.eventRisk.summary),
    item("Market regime", input.context.regime.tradeability === "blocked" ? "fail" : input.context.regime.tradeability === "caution" ? "neutral" : "pass", input.context.regime.summary),
    item("Data confidence", input.context.dataConfidence.score < 35 ? "fail" : input.context.dataConfidence.score < 68 ? "neutral" : "pass", input.context.dataConfidence.summary),
    item("Retracement", input.context.retracement.currentPct > 88 ? "neutral" : "pass", input.context.retracement.summary),
    item("Outcome replay", input.outcome.status === "stopped" || input.outcome.status === "tp1" || input.outcome.status === "tp2" ? "fail" : input.outcome.status === "open" ? "pass" : "neutral", input.outcome.summary)
  ];

  const status: SignalGovernance["status"] = blockers.length ? "block" : warnings.length ? "caution" : "allow";
  return {
    status,
    scoreImpact,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    checklist,
    summary: blockers[0] ?? warnings[0] ?? "Governance temiz: event, veri, rejim ve replay uygun."
  };
}
