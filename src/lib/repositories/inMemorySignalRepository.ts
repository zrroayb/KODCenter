import type { TradingSignal } from "../ict/types";
import type { SignalRepository } from "./types";

export class InMemorySignalRepository implements SignalRepository {
  private signals: TradingSignal[] = [];

  // Future implementation can use database.
  // MVP intentionally uses memory only.
  async saveSignal(signal: TradingSignal): Promise<void> {
    this.signals = [signal, ...this.signals];
  }

  async getSignals(): Promise<TradingSignal[]> {
    return [...this.signals];
  }
}
