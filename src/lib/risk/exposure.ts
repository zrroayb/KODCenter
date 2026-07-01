import type { TradingSignal } from "../ict/types";

export function exposureWarnings(signals: TradingSignal[]): string[] {
  const usdFxCount = signals.filter((signal) => signal.symbol === "EURUSD" || signal.symbol === "GBPUSD").length;
  return usdFxCount > 1 ? ["Multiple USD FX signals may be correlated."] : [];
}
