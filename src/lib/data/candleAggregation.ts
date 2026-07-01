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

export function aggregateCandles(candles: Candle[], targetTimeframe: Timeframe): Candle[] {
  if (candles.length === 0) return [];
  const bucketSize = timeframeToMs(targetTimeframe);
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, Candle[]>();

  for (const candle of sorted) {
    const bucketTime = Math.floor(candle.time / bucketSize) * bucketSize;
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
