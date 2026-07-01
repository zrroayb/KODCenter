import type { MarketSymbol } from "../ict/types";
import type { RuntimeMarketMemory } from "./marketMemory";

export function createSessionRuntimeMemory(activeSymbol: MarketSymbol): RuntimeMarketMemory {
  return {
    activeSymbol,
    lastScanTime: Date.now(),
    latestBias: "neutral",
    recentSignals: [],
    rejectedSetups: [],
    liquidityMap: [],
    scanHistory: []
  };
}
