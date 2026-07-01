export type AccountModel = {
  accountSize: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  preferredRR: number;
  minimumRR: number;
};

export const defaultAccountModel: AccountModel = {
  accountSize: 10_000,
  riskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxTradesPerDay: 3,
  preferredRR: 2,
  minimumRR: 1.5
};
