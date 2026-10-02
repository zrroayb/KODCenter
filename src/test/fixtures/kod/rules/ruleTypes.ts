export type RuleResult = {
  passed: boolean;
  scoreImpact: number;
  reason: string;
};

export type Rule<TContext> = {
  id: string;
  label: string;
  evaluate: (context: TContext) => RuleResult;
};
