import type { MarketSymbol } from "./types";

export function isCryptoSymbol(symbol: MarketSymbol): boolean {
  return symbol === "BTCUSD";
}
