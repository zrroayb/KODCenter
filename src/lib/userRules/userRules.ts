import type { MarketSymbol } from "../ict/types";

export type UserRules = {
  stopProfile: "aggressive" | "normal" | "conservative";
  useExecutionCosts: boolean;
  slippageStress: "normal" | "high";
  minimumRR: number;
  // CRT exits the whole position at EQ (eq-full); its READY gate is the EQ net RR.
  crtExitMinimumRR: number;
  minimumScore: number;
  partialTpEnabled: boolean;
  moveToBreakevenAtR: number;
  maxDailyRiskPct: number;
  // Account model (was a hard-coded constant): sizing and daily-risk warnings read these.
  accountSize: number;
  riskPerTradePct: number;
  maxTradesPerDay: number;
  avoidNews: boolean;
  allowedSymbols: MarketSymbol[];
  allowedKillzones: string[];
  usePremiumDiscountFilter: boolean;
  useJudasSwingFilter: boolean;
  useHtfAlignmentFilter: boolean;
  maxSignalsPerScan: number;
};
