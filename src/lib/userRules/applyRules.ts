import type { MarketContext, TradingSignal } from "../ict/types";
import { effectiveMinimumScore } from "./scorePolicy";
import type { UserRules } from "./userRules";

export function ruleAllowsContext(context: MarketContext, rules: UserRules): boolean {
  return rules.allowedSymbols.includes(context.symbol);
}

export function ruleAllowsSignal(signal: TradingSignal, rules: UserRules): boolean {
  if (signal.stage === "invalidated" || signal.stage === "missed") return false;
  if (signal.score < effectiveMinimumScore(rules.minimumScore)) return false;
  // Each strategy gates READY on its own exit RR (CRT: DOL net RR vs crtExitMinimumRR); the plan
  // carries that threshold. Plans without one fall back to the generic rule.
  if (signal.stage === "ready" && signal.plan.rr < (signal.plan.minimumRR ?? rules.minimumRR)) return false;
  // HTF yön ve key level kapıları stratejide (crt.strategy blockers + readyEligible) — burada
  // tekrar uygulanmaz.
  return true;
}
