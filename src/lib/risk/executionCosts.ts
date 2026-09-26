import type { ExecutionCostStress, MarketSymbol } from "../ict/types";
import { SYMBOL_SPEC } from "../ict/symbolSpec";

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
  const base = SYMBOL_SPEC[input.symbol];
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
