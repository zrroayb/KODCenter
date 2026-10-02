import { crtStrategy } from "./crt/crt.strategy";
import type { StrategyModule } from "./types";

export const strategyRegistry: StrategyModule[] = [crtStrategy];

// Canlı taramada koşan playbook'lar: yalnız CRT (Trend Continuation 2026-10-02'de kaldırıldı).
export const PLAYBOOK_STRATEGIES: StrategyModule[] = [crtStrategy];

export function getStrategy(strategyId: string): StrategyModule {
  const found = strategyRegistry.find((strategy) => strategy.id === strategyId);
  if (!found) return crtStrategy;
  return found;
}
