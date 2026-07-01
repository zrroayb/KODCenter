import type { DecisionChecklistItem, DecisionSummary } from "../ict/types";

export function checklistItem(label: string, status: DecisionChecklistItem["status"], explanation: string): DecisionChecklistItem {
  return { label, status, explanation };
}

export function createDecisionSummary(input: DecisionSummary): DecisionSummary {
  return input;
}
