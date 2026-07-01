import type { ExecutionCostStress, MarketSymbol } from "../ict/types";

type SymbolExecutionCost = {
  spread: number;
  slippage: number;
  commission: number;
};

export type ExecutionCostResult = SymbolExecutionCost & {
  stress: ExecutionCostStress;
  total: number;
  grossReward: number;
  netReward: number;
  riskAfterCosts: number;
  grossRR: number;
  netRR: number;
};

const SYMBOL_EXECUTION_COSTS: Record<MarketSymbol, SymbolExecutionCost> = {
  XAUUSD: { spread: 0.35, slippage: 0.25, commission: 0.05 },
  NAS100: { spread: 4, slippage: 4, commission: 0 },
  EURUSD: { spread: 0.00008, slippage: 0.00004, commission: 0.00002 },
  GBPUSD: { spread: 0.0001, slippage: 0.00005, commission: 0.00002 },
  BTCUSD: { spread: 35, slippage: 60, commission: 15 }
};

const STRESS_MULTIPLIER: Record<ExecutionCostStress, number> = {
  off: 0,
  normal: 1,
  high: 1.75
};

export function estimateExecutionCosts(input: {
  symbol: MarketSymbol;
  entry: number;
  stopLoss: number;
  target: number;
  stress: ExecutionCostStress;
}): ExecutionCostResult {
  const base = SYMBOL_EXECUTION_COSTS[input.symbol];
  const multiplier = STRESS_MULTIPLIER[input.stress];
  const spread = base.spread * multiplier;
  const slippage = base.slippage * multiplier;
  const commission = base.commission * multiplier;
  const total = spread + slippage + commission;
  const risk = Math.abs(input.entry - input.stopLoss);
  const grossReward = Math.abs(input.target - input.entry);
  const riskAfterCosts = risk + total;
  const netReward = Math.max(0, grossReward - total);
  const grossRR = risk > 0 ? grossReward / risk : 0;
  const netRR = riskAfterCosts > 0 ? netReward / riskAfterCosts : 0;

  return {
    stress: input.stress,
    spread,
    slippage,
    commission,
    total,
    grossReward,
    netReward,
    riskAfterCosts,
    grossRR,
    netRR
  };
}
