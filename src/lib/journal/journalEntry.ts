import type { TradingSignal } from "../ict/types";
import type { JournalEntry } from "./types";

export function journalEntryFromSignal(signal: TradingSignal): JournalEntry {
  const now = Date.now();
  return {
    tradeId: signal.id,
    createdAt: now,
    updatedAt: now,
    strategy: signal.strategyId,
    symbol: signal.symbol,
    direction: signal.direction,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    target: signal.plan.targets[0],
    tradeAction: "watch",
    result: "open",
    ruleViolations: []
  };
}
