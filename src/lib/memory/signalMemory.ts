import type { TradingSignal } from "../ict/types";

export type SignalMemory = {
  recentSignals: TradingSignal[];
};

export function addSignal(memory: SignalMemory, signal: TradingSignal): SignalMemory {
  return { recentSignals: [signal, ...memory.recentSignals].slice(0, 30) };
}
