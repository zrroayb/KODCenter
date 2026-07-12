import { crtStrategy } from "./crt/crt.strategy";
import type { StrategyModule } from "./types";

export const strategyRegistry: StrategyModule[] = [crtStrategy];

export function getStrategy(strategyId: string): StrategyModule {
  const found = strategyRegistry.find((strategy) => strategy.id === strategyId);
  if (!found) return crtStrategy;
  return found;
}
