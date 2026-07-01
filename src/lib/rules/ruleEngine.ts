import type { Rule, RuleResult } from "./ruleTypes";

export function evaluateRules<TContext>(rules: Rule<TContext>[], context: TContext): RuleResult[] {
  return rules.map((rule) => rule.evaluate(context));
}

export function scoreRules(results: RuleResult[]): number {
  return results.reduce((score, result) => score + result.scoreImpact, 0);
}
