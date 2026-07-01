import type { DecisionSummary, MarketContext, QualityGrade, TradeDirection, TradePlan } from "../ict/types";
import { confidenceScore } from "./confidence";
import { createDecisionSummary } from "./decisionSummary";
import { buildChecklist, reasoningText } from "./reasoning";
import { decisionWarnings, invalidationText } from "./warnings";

export function buildDecisionSummary(input: {
  context: MarketContext;
  direction: TradeDirection;
  plan: TradePlan;
  grade: QualityGrade;
  riskWarnings: string[];
}): DecisionSummary {
  const checklist = buildChecklist(input.context, input.direction, input.plan);
  const warnings = decisionWarnings(input.context, input.direction, input.plan, input.riskWarnings);
  const reasoning = reasoningText(input.context, input.direction, input.plan);
  return createDecisionSummary({
    ...reasoning,
    checklist,
    warnings,
    invalidation: invalidationText(input.direction, input.plan),
    confidence: confidenceScore(input.grade, checklist, warnings.length)
  });
}
