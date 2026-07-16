import type { Candle, MarketSymbol } from "../../ict/types";
import { tzOffsetHours } from "../../session/sessionClock";
import { SB_STRATEGY_PROFILE, type SbDataQuality, type SbRangeQuality, type SilverBulletReferenceRange } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const NY = "America/New_York";

// Resolve a New York wall-clock hour on the NY-local date of `at` to a UTC timestamp.
// Two-pass so a DST transition between `at` and the target hour cannot skew the boundary
// (never a fixed UTC offset — Master §6).
export function nyHourToUtc(at: number, hour: number, minute = 0): number {
  let offset = tzOffsetHours(NY, at);
  for (let pass = 0; pass < 2; pass += 1) {
    const local = new Date(at + offset * HOUR_MS);
    const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * HOUR_MS;
    const candidateOffset = tzOffsetHours(NY, candidate);
    if (candidateOffset === offset) return candidate;
    offset = candidateOffset;
  }
  const local = new Date(at + offset * HOUR_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * HOUR_MS;
}

export function nyTradingDayId(at: number): string {
  const offset = tzOffsetHours(NY, at);
  const local = new Date(at + offset * HOUR_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function medianStep(candles: Candle[]): number {
  const steps = candles.slice(1).map((candle, index) => candle.time - candles[index].time).filter((value) => value > 0).sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? 5 * 60 * 1000;
}

function averageBarRange(candles: Candle[], endExclusiveTime: number, count = 20): number {
  const prior = candles.filter((candle) => candle.time < endExclusiveTime).slice(-count);
  const ranges = prior.map((candle) => candle.high - candle.low).filter((value) => value > 0);
  if (!ranges.length) return 0;
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function previousReferenceSizes(candles: Candle[], currentStartUtc: number, maxDays = 6): number[] {
  const sizes: number[] = [];
  for (let day = 1; day <= maxDays; day += 1) {
    const probe = currentStartUtc - day * 24 * HOUR_MS;
    const start = nyHourToUtc(probe, 9);
    const end = nyHourToUtc(probe, 10);
    const bars = candles.filter((candle) => candle.time >= start && candle.time < end);
    if (bars.length < 4) continue;
    const high = Math.max(...bars.map((bar) => bar.high));
    const low = Math.min(...bars.map((bar) => bar.low));
    if (high > low) sizes.push(high - low);
  }
  return sizes;
}

function classifyQuality(rangeSize: number, atrPerBar: number, barCount: number, previousSizes: number[]): SbRangeQuality {
  if (rangeSize <= 0) return "invalid";
  if (previousSizes.length >= 2) {
    const sorted = [...previousSizes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0) {
      const ratio = rangeSize / median;
      if (ratio > 2.5) return "exhausted";
      if (ratio > 1.8) return "expanded";
      if (ratio < 0.6) return "compressed";
      return "normal";
    }
  }
  // Fallback: compare the hourly range against a typical hour of movement on this TF.
  const typicalHour = atrPerBar * Math.max(barCount, 1);
  if (typicalHour <= 0) return "normal";
  const ratio = rangeSize / typicalHour;
  if (ratio > 3) return "exhausted";
  if (ratio > 2) return "expanded";
  if (ratio < 0.8) return "compressed";
  return "normal";
}

// Builds the 09:00–10:00 New York reference candle from intraday bars for the NY trading day of
// `now`. Locked at 10:00 NY — candles at/after 10:00 never modify it (Master §7: no repaint).
export function buildSilverBulletReferenceRange(input: {
  symbol: MarketSymbol;
  candles: Candle[];
  now: number;
}): SilverBulletReferenceRange | undefined {
  const { symbol, candles, now } = input;
  if (!candles.length) return undefined;
  const startUtc = nyHourToUtc(now, 9);
  const endUtc = nyHourToUtc(now, 10);
  if (now < startUtc) return undefined;

  const step = medianStep(candles);
  const expectedBars = Math.max(1, Math.round((endUtc - startUtc) / step));
  const inWindow = candles
    .filter((candle) => candle.time >= startUtc && candle.time < endUtc && candle.time <= now)
    .sort((a, b) => a.time - b.time);
  const uniqueTimes = new Set(inWindow.map((candle) => candle.time));
  const hasDuplicates = uniqueTimes.size !== inWindow.length;
  const isLocked = now >= endUtc;

  let dataQuality: SbDataQuality = "valid";
  if (hasDuplicates) dataQuality = "duplicate_bars";
  else if (!inWindow.length) dataQuality = "invalid";
  else if (isLocked && inWindow.length < Math.ceil(expectedBars * 0.9)) dataQuality = "incomplete";

  if (!inWindow.length) return undefined;

  const high = Math.max(...inWindow.map((bar) => bar.high));
  const low = Math.min(...inWindow.map((bar) => bar.low));
  const highBar = inWindow.find((bar) => bar.high === high) ?? inWindow[0];
  const lowBar = inWindow.find((bar) => bar.low === low) ?? inWindow[0];
  const atr = averageBarRange(candles, startUtc);
  const rangeSize = high - low;
  const previousSizes = previousReferenceSizes(candles, startUtc);
  const quality = dataQuality === "valid" && isLocked
    ? classifyQuality(rangeSize, atr, expectedBars, previousSizes)
    : dataQuality !== "valid" ? "invalid" : "normal";

  return {
    referenceRangeId: `${symbol}:${nyTradingDayId(startUtc)}:0900NY`,
    strategyProfile: SB_STRATEGY_PROFILE,
    symbol,
    tradingDayId: nyTradingDayId(startUtc),
    timezone: NY,
    startUtc,
    endUtc,
    open: inWindow[0].open,
    high,
    low,
    close: inWindow[inWindow.length - 1].close,
    midpoint: (high + low) / 2,
    rangeSize,
    atr,
    rangeAtrRatio: atr > 0 ? rangeSize / atr : 0,
    highTimestamp: highBar.time,
    lowTimestamp: lowBar.time,
    highFirst: highBar.time <= lowBar.time,
    quality,
    isComplete: isLocked && dataQuality === "valid",
    dataQuality,
    barCount: inWindow.length
  };
}
