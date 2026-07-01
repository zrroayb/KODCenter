import type { TradingSignal } from "../ict/types";

export interface SignalRepository {
  saveSignal(signal: TradingSignal): Promise<void>;
  getSignals(): Promise<TradingSignal[]>;
}
