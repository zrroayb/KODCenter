import { crtStrategy } from "./crt/crt.strategy";
import { trendContinuationStrategy } from "./trendContinuation/trendContinuation.strategy";
import type { StrategyModule } from "./types";

export const strategyRegistry: StrategyModule[] = [crtStrategy, trendContinuationStrategy];

// Canlı taramada birlikte koşan playbook'lar: CRT Reversal + Trend Continuation. İkisi ayrı
// yön/entry/hedef mantığıyla çalışır, sonuçlar tek listede etiketiyle (strategyId) gösterilir.
export const PLAYBOOK_STRATEGIES: StrategyModule[] = [crtStrategy, trendContinuationStrategy];

export function getStrategy(strategyId: string): StrategyModule {
  const found = strategyRegistry.find((strategy) => strategy.id === strategyId);
  if (!found) return crtStrategy;
  return found;
}
