import type { Candle } from "./types";

export function candleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

export function candleRange(candle: Candle): number {
  return Math.max(candle.high - candle.low, 0.000001);
}

export function averageTrueRange(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const sample = ranges.slice(-period);
  return sample.reduce((sum, value) => sum + value, 0) / Math.max(sample.length, 1);
}

export function completedCandles(candles: Candle[]): Candle[] {
  return candles.filter((candle) => candle.closed !== false);
}

export function latestClosed(candles: Candle[]): Candle {
  const completed = completedCandles(candles);
  return completed[Math.max(0, completed.length - 1)] ?? candles[Math.max(0, candles.length - 1)];
}

export function highestHigh(candles: Candle[]): number {
  return Math.max(...candles.map((candle) => candle.high));
}

export function lowestLow(candles: Candle[]): number {
  return Math.min(...candles.map((candle) => candle.low));
}
