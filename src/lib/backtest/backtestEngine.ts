import type { MarketContext } from "../ict/types";
import { getStrategy, strategyRegistry } from "../strategies/registry";

export function runDemoBacktest(contexts: MarketContext[]) {
  const strategy = getStrategy(strategyRegistry[0].id);
  return strategy.backtest({ contexts, settings: strategy.defaultSettings });
}
