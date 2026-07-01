import type { DecisionChecklistItem, QualityGrade } from "../ict/types";

const GRADE_BASE: Record<QualityGrade, number> = {
  "A+": 88,
  A: 78,
  B: 66,
  C: 52,
  D: 38
};

export function confidenceScore(grade: QualityGrade, checklist: DecisionChecklistItem[], warningCount: number): number {
  const passed = checklist.filter((item) => item.status === "pass").length;
  const failed = checklist.filter((item) => item.status === "fail").length;
  const checklistBoost = checklist.length ? (passed / checklist.length) * 18 : 0;
  return Math.max(0, Math.min(100, Math.round(GRADE_BASE[grade] + checklistBoost - failed * 10 - warningCount * 4)));
}
