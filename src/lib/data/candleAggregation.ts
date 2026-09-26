import type { Candle, Timeframe } from "../ict/types";
import { timeframeToMs } from "./timeframes";
import { tzOffsetHours } from "../session/sessionClock";

const HOUR_MS = 60 * 60 * 1000;

function bucketEnd(bucketTime: number, targetTimeframe: Timeframe): number {
  if (targetTimeframe === "1M") {
    const date = new Date(bucketTime);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  return bucketTime + timeframeToMs(targetTimeframe);
}

function sourceStep(candles: Candle[]): number {
  const diffs = candles
    .slice(1)
    .map((candle, index) => candle.time - candles[index].time)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? 0;
}

function mergeBucket(bucket: Candle[], bucketTime: number, targetTimeframe: Timeframe, latestSourceClose: number): Candle {
  const first = bucket[0];
  const last = bucket[bucket.length - 1];
  return {
    time: bucketTime,
    open: first.open,
    high: Math.max(...bucket.map((candle) => candle.high)),
    low: Math.min(...bucket.map((candle) => candle.low)),
    close: last.close,
    volume: bucket.reduce((sum, candle) => sum + candle.volume, 0),
    closed: bucket.every((candle) => candle.closed !== false) && bucketEnd(bucketTime, targetTimeframe) <= latestSourceClose
  };
}

export type AggregationOptions = {
  // FX / futures weeks open Sunday ~17:00 New York: a Sunday-dated bar is the NEW week's first
  // session, not the old week's last (2026-09-26). Crypto (Binance) weeks run Monday–Sunday UTC,
  // so it keeps the default.
  sundayOpensWeek?: boolean;
};

function bucketStart(time: number, targetTimeframe: Timeframe, options: AggregationOptions = {}): number {
  // Weekly and monthly candles must align to the calendar: epoch-based 7d buckets start on
  // Thursdays and fixed 30d "months" drift across real month boundaries, which corrupts any
  // HTF bias read from those candles.
  if (targetTimeframe === "1w") {
    const date = new Date(time);
    const day = date.getUTCDay();
    // Buckets stay labeled by their Monday date; a Sunday bar moves to the following Monday.
    const daysFromMonday = options.sundayOpensWeek && day === 0 ? -1 : (day + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday);
  }
  if (targetTimeframe === "1M") {
    const date = new Date(time);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  if (targetTimeframe === "4h") {
    // CRT reads 4H candles off New York-close charts: the daily opens at 17:00 New York, so
    // 4H candles open at 17/21/01/05/09/13 NY — the 01/05/09 trio are the session candles
    // the doctrine is built around. Epoch-UTC buckets point at entirely different candles.
    const offset = tzOffsetHours("America/New_York", time);
    const anchorShift = ((((17 - offset) % 24) + 24) % 24) * HOUR_MS;
    const bucketSize = timeframeToMs("4h");
    return Math.floor((time - anchorShift) / bucketSize) * bucketSize + anchorShift;
  }
  const bucketSize = timeframeToMs(targetTimeframe);
  return Math.floor(time / bucketSize) * bucketSize;
}

export function aggregateCandles(candles: Candle[], targetTimeframe: Timeframe, options: AggregationOptions = {}): Candle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const step = sourceStep(sorted);
  const latest = sorted.at(-1)!;
  const latestSourceClose = latest.closed === false ? latest.time : latest.time + step;
  const buckets = new Map<number, Candle[]>();

  for (const candle of sorted) {
    const bucketTime = bucketStart(candle.time, targetTimeframe, options);
    const bucket = buckets.get(bucketTime) ?? [];
    bucket.push(candle);
    buckets.set(bucketTime, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketTime, bucket]) => mergeBucket(bucket, bucketTime, targetTimeframe, latestSourceClose));
}

export function trimCandles(candles: Candle[], count: number): Candle[] {
  return candles.slice(Math.max(candles.length - count, 0));
}
