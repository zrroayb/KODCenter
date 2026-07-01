import type { MarketContext } from "../ict/types";
import { kodStrategy } from "../strategies/kod/kod.strategy";

export function runDemoBacktest(contexts: MarketContext[]) {
  return kodStrategy.backtest({ contexts, settings: kodStrategy.defaultSettings });
}
