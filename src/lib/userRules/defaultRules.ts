import type { UserRules } from "./userRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./scorePolicy";

export const defaultRules: UserRules = {
  stopProfile: "normal",
  useExecutionCosts: true,
  slippageStress: "normal",
  minimumRR: 1.5,
  minimumScore: MIN_VISIBLE_SIGNAL_SCORE,
  partialTpEnabled: true,
  moveToBreakevenAtR: 1,
  maxDailyRiskPct: 2,
  avoidNews: false,
  allowedSymbols: ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"],
  allowedKillzones: ["Asia", "London", "New York AM", "London Close", "Outside"],
  usePremiumDiscountFilter: false,
  useJudasSwingFilter: false,
  useHtfAlignmentFilter: false,
  maxSignalsPerScan: 18
};
