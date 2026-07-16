import type { Candle, MarketSymbol, Ohlc } from "../ict/types";

const SYNTHETIC_SPREAD: Record<MarketSymbol, number> = {
  XAUUSD: 0.35,
  NAS100: 4,
  EURUSD: 0.00008,
  GBPUSD: 0.0001,
  USDJPY: 0.012,
  AUDUSD: 0.0001,
  USDCHF: 0.00012,
  BTCUSD: 35,
  ETHUSD: 2,
  XRPUSD: 0.002,
  BNBUSD: 0.5,
  SOLUSD: 0.09
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
  const configuredSpread = SYNTHETIC_SPREAD[symbol];
  const halfSpread = Number.isFinite(configuredSpread) ? configuredSpread / 2 : 0;
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

// NaN is NOT nullish: `NaN ?? fallback` keeps the NaN, and one poisoned bid/ask silently turns
// every downstream Math.max/R computation into NaN (seen live: a forming Yahoo candle produced
// NaN synthetic quotes and the whole replay reported NaN R). Guard with Number.isFinite instead.
function finitePrice(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

export function executableHigh(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return finitePrice(candle.ask?.high, candle.high);
  return finitePrice(candle.bid?.high, candle.high);
}

export function executableLow(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return finitePrice(candle.ask?.low, candle.low);
  return finitePrice(candle.bid?.low, candle.low);
}

export function executableClose(candle: Candle, side: "buy" | "sell"): number {
  if (side === "buy") return finitePrice(candle.ask?.close, candle.close);
  return finitePrice(candle.bid?.close, candle.close);
}
