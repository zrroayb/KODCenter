import type { MarketSymbol } from "./types";

const CRYPTO_SYMBOLS: ReadonlySet<MarketSymbol> = new Set(["BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"]);

export function isCryptoSymbol(symbol: MarketSymbol): boolean {
  return CRYPTO_SYMBOLS.has(symbol);
}
