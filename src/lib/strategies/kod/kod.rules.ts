import type { MarketContext, TradeDirection, TradePlan } from "../../ict/types";
import type { IctSequence } from "../../intelligence/ictSequenceEngine";
import {
  DisplacementCondition,
  FvgCondition,
  KillzoneCondition,
  LiquiditySweptCondition,
  MssCondition,
  PriceInPremiumCondition,
  RiskRewardCondition,
  SmtCondition
} from "../../rules/conditions";
import { evaluateRules } from "../../rules/ruleEngine";
import type { RuleResult } from "../../rules/ruleTypes";

function sequenceCondition(sequence?: IctSequence): RuleResult {
  if (!sequence) {
    return { passed: false, reason: "ICT sequence hesaplanamadı.", scoreImpact: -10 };
  }
  if (sequence.ready) {
    return { passed: true, reason: sequence.summary, scoreImpact: 14 };
  }
  if (sequence.hardBlockers.length) {
    return { passed: false, reason: sequence.hardBlockers[0], scoreImpact: -14 };
  }
  return { passed: false, reason: sequence.summary, scoreImpact: -8 };
}

export function kodRuleResults(context: MarketContext, direction: TradeDirection, rr: number, minimumRR: number, plan?: TradePlan, sequence?: IctSequence): RuleResult[] {
  return evaluateRules(
    [
      PriceInPremiumCondition(direction),
      LiquiditySweptCondition(direction),
      DisplacementCondition(direction),
      MssCondition(direction),
      FvgCondition(direction, plan),
      SmtCondition(direction),
      KillzoneCondition(),
      RiskRewardCondition(rr, minimumRR)
    ],
    context
  ).concat(sequenceCondition(sequence));
}
