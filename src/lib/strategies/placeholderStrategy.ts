import type { BacktestResult } from "../analytics/performance";

export function emptyBacktestResult(): BacktestResult {
  return {
    totalTrades: 0,
    winRate: 0,
    lossRate: 0,
    averageRR: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    bestSymbol: "",
    bestKillzone: "",
    bestSetupGrade: "",
    bestPremiumDiscountLocation: "",
    worstCondition: "",
    equityCurve: []
  };
}
