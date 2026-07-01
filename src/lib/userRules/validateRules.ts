import type { UserRules } from "./userRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./scorePolicy";

export function validateRules(rules: UserRules): string[] {
  const errors: string[] = [];
  if (rules.minimumRR < 0) errors.push("Minimum RR cannot be negative.");
  if (rules.minimumScore < MIN_VISIBLE_SIGNAL_SCORE) errors.push("Minimum score cannot be below C grade.");
  if (rules.maxSignalsPerScan < 1) errors.push("Max signals per scan must be at least 1.");
  if (rules.moveToBreakevenAtR < 0) errors.push("Break-even trigger cannot be negative.");
  if (rules.maxDailyRiskPct < 0) errors.push("Max daily risk cannot be negative.");
  return errors;
}
