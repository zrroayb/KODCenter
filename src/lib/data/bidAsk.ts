import type { Candle, MarketSymbol, Ohlc } from "../ict/types";

const SYNTHETIC_SPREAD: Record<MarketSymbol, number> = {
  XAUUSD: 0.35,
  NAS100: 4,
  EURUSD: 0.00008,
  GBPUSD: 0.0001,
  BTCUSD: 35
};

function shift(ohlc: Ohlc, amount: number): Ohlc {
  return {
    open: ohlc.open + amount,
    high: ohlc.high + amount,
    low: ohlc.low + amount,
    close: ohlc.close + amount
  };
}

export function enrichWithSyntheticBidAsk(candles: Candle[], symbol: MarketSymbol): Candle[] {
  const halfSpread = SYNTHETIC_SPREAD[symbol] / 2;
  return candles.map((candle) => {
    const mid: Ohlc = {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    };
    return {
      ...candle,
      mid,
      bid: shift(mid, -halfSpread),
      ask: shift(mid, halfSpread),
      priceComponent: "mid" as const,
      feed: "synthetic-bid-ask" as const
    };
  });
}

export function executableHigh(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return candle.ask?.high ?? candle.high;
  return candle.bid?.high ?? candle.high;
}

export function executableLow(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return candle.ask?.low ?? candle.low;
  return candle.bid?.low ?? candle.low;
}

export function executableClose(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return candle.ask?.close ?? candle.close;
  return candle.bid?.close ?? candle.close;
}
