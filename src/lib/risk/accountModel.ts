import { defaultRules } from "../userRules/defaultRules";

export type AccountModel = {
  accountSize: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  preferredRR: number;
  minimumRR: number;
};

type AccountSettings = Partial<Record<"accountSize" | "riskPerTradePct" | "maxDailyRiskPct" | "maxTradesPerDay" | "minimumRR", unknown>>;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

// The account lives in the user rules (Ayarlar), not a hard-coded constant (2026-09-26).
export function accountFromSettings(settings: AccountSettings): AccountModel {
  return {
    accountSize: positive(settings.accountSize, defaultRules.accountSize),
    riskPerTradePct: positive(settings.riskPerTradePct, defaultRules.riskPerTradePct),
    maxDailyLossPct: positive(settings.maxDailyRiskPct, defaultRules.maxDailyRiskPct),
    maxTradesPerDay: positive(settings.maxTradesPerDay, defaultRules.maxTradesPerDay),
    preferredRR: 2,
    minimumRR: positive(settings.minimumRR, defaultRules.minimumRR)
  };
}

export const defaultAccountModel: AccountModel = accountFromSettings(defaultRules);
