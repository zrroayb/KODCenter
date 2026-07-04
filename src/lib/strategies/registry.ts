import { crtStrategy } from "./crt/crt.strategy";
import { kodStrategy } from "./kod/kod.strategy";
import type { StrategyModule } from "./types";

export const strategyRegistry: StrategyModule[] = [crtStrategy, kodStrategy];

export function getStrategy(strategyId: string): StrategyModule {
  const found = strategyRegistry.find((strategy) => strategy.id === strategyId);
  if (!found) return crtStrategy;
  return found;
}
