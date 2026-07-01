import type { QualityGrade } from "../../ict/types";
import type { RuleResult } from "../../rules/ruleTypes";

export function kodScore(results: RuleResult[]): number {
  const raw = results.reduce((score, result) => score + result.scoreImpact, 50);
  return Math.max(0, Math.min(100, raw));
}

export function kodGrade(score: number): QualityGrade {
  if (score >= 88) return "A+";
  if (score >= 76) return "A";
  if (score >= 64) return "B";
  if (score >= 50) return "C";
  return "D";
}
