import type { TradingSignal } from "../ict/types";

export function setupStats(signals: TradingSignal[]): Record<string, number> {
  return signals.reduce<Record<string, number>>((stats, signal) => {
    stats[signal.strategyId] = (stats[signal.strategyId] ?? 0) + 1;
    return stats;
  }, {});
}
