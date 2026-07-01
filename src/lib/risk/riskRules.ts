import type { AccountModel } from "./accountModel";
import type { PositionSizeResult } from "./positionSizing";

export function evaluateRiskRules(result: PositionSizeResult, account: AccountModel): string[] {
  const warnings = [...result.warnings];
  if (result.rr < account.minimumRR) warnings.push("Risk reward is below selected threshold.");
  if (result.riskDistance <= 0) warnings.push("Risk distance is invalid.");
  return Array.from(new Set(warnings));
}
