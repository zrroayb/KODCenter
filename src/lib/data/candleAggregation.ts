import type { Candle, Timeframe } from "../ict/types";
import { timeframeToMs } from "./timeframes";

function mergeBucket(bucket: Candle[], bucketTime: number): Candle {
  const first = bucket[0];
  const last = bucket[bucket.length - 1];
  return {
    time: bucketTime,
    open: first.open,
    high: Math.max(...bucket.map((candle) => candle.high)),
    low: Math.min(...bucket.map((candle) => candle.low)),
    close: last.close,
    volume: bucket.reduce((sum, candle) => sum + candle.volume, 0)
  };
}

function bucketStart(time: number, targetTimeframe: Timeframe): number {
  // Weekly and monthly candles must align to the calendar: epoch-based 7d buckets start on
  // Thursdays and fixed 30d "months" drift across real month boundaries, which corrupts any
  // HTF bias read from those candles.
  if (targetTimeframe === "1w") {
    const date = new Date(time);
    const daysFromMonday = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday);
  }
  if (targetTimeframe === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  const bucketSize = timeframeToMs(targetTimeframe);
  return Math.floor(time / bucketSize) * bucketSize;
}

export function aggregateCandles(candles: Candle[], targetTimeframe: Timeframe): Candle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, Candle[]>();

  for (const candle of sorted) {
    const bucketTime = bucketStart(candle.time, targetTimeframe);
    const bucket = buckets.get(bucketTime) ?? [];
    bucket.push(candle);
    buckets.set(bucketTime, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketTime, bucket]) => mergeBucket(bucket, bucketTime));
}

export function trimCandles(candles: Candle[], count: number): Candle[] {
  return candles.slice(Math.max(candles.length - count, 0));
}
