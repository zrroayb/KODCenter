import type { MarketSymbol } from "../ict/types";

export type UserRules = {
  stopProfile: "aggressive" | "normal" | "conservative";
  useExecutionCosts: boolean;
  slippageStress: "normal" | "high";
  minimumRR: number;
  minimumScore: number;
  partialTpEnabled: boolean;
  moveToBreakevenAtR: number;
  maxDailyRiskPct: number;
  avoidNews: boolean;
  allowedSymbols: MarketSymbol[];
  allowedKillzones: string[];
  usePremiumDiscountFilter: boolean;
  useJudasSwingFilter: boolean;
  useHtfAlignmentFilter: boolean;
  maxSignalsPerScan: number;
};
