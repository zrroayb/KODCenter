import { candleBody, candleRange } from "../ict/candles";
import type { Candle, Displacement, FairValueGap, MarketStructureShift, TradeDirection } from "../ict/types";

export function detectDisplacements(candles: Candle[]): Displacement[] {
  const result: Displacement[] = [];
  const sample = candles.slice(-12);
  const averageRange = sample.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(sample.length, 1);
  sample.forEach((candle, offset) => {
    const bodyRatio = candleBody(candle) / candleRange(candle);
    const rangeAtr = candleRange(candle) / Math.max(averageRange, 0.000001);
    if (bodyRatio < 0.58 || rangeAtr < 1.05) return;
    const direction: TradeDirection = candle.close > candle.open ? "long" : "short";
    result.push({
      direction,
      candleIndex: candles.length - sample.length + offset,
      bodyRatio,
      rangeAtr
    });
  });
  return result;
}

function latestPivot(candles: Candle[], side: "high" | "low", lookback = 36): { level: number; index: number } | undefined {
  const start = Math.max(2, candles.length - lookback);
  const end = Math.max(start, candles.length - 2);
  const pivots: Array<{ level: number; index: number }> = [];
  for (let index = start; index < end; index += 1) {
    const left = candles[index - 1];
    const candle = candles[index];
    const right = candles[index + 1];
    if (side === "high" && candle.high > left.high && candle.high >= right.high) {
      pivots.push({ level: candle.high, index });
    }
    if (side === "low" && candle.low < left.low && candle.low <= right.low) {
      pivots.push({ level: candle.low, index });
    }
  }
  return pivots[pivots.length - 1];
}

export function detectMarketStructureShifts(candles: Candle[]): MarketStructureShift[] {
  if (candles.length < 10) return [];
  const latest = candles[candles.length - 1];
  const lookback = candles.slice(-10, -1);
  const pivotHigh = latestPivot(candles, "high");
  const pivotLow = latestPivot(candles, "low");
  const priorHigh = pivotHigh?.level ?? Math.max(...lookback.map((candle) => candle.high));
  const priorLow = pivotLow?.level ?? Math.min(...lookback.map((candle) => candle.low));
  const shifts: MarketStructureShift[] = [];
  if (latest.close > priorHigh) shifts.push({ direction: "long", level: priorHigh, candleIndex: candles.length - 1 });
  if (latest.close < priorLow) shifts.push({ direction: "short", level: priorLow, candleIndex: candles.length - 1 });
  return shifts;
}

export function detectFairValueGaps(candles: Candle[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  for (let index = Math.max(2, candles.length - 40); index < candles.length; index += 1) {
    const left = candles[index - 2];
    const middle = candles[index - 1];
    const right = candles[index];
    const sample = candles.slice(Math.max(0, index - 20), index + 1);
    const averageRange = sample.reduce((sum, candle) => sum + candleRange(candle), 0) / Math.max(sample.length, 1);
    const minGapSize = Math.max(averageRange * 0.1, Math.abs(right.close) * 0.00001);
    const middleRange = candleRange(middle);
    const middleBodyRatio = candleBody(middle) / Math.max(middleRange, 0.000001);
    const middleIsBullishDisplacement = middle.close > middle.open && middleBodyRatio >= 0.52 && middleRange >= averageRange * 0.75;
    const middleIsBearishDisplacement = middle.close < middle.open && middleBodyRatio >= 0.52 && middleRange >= averageRange * 0.75;

    if (right.low > left.high) {
      const gapSize = right.low - left.high;
      const midpoint = (left.high + right.low) / 2;
      const future = candles.slice(index + 1);
      const fullyFilled = future.some((candle) => candle.low <= left.high);
      if (!middleIsBullishDisplacement || gapSize < minGapSize || fullyFilled) continue;
      gaps.push({
        direction: "long",
        low: left.high,
        high: right.low,
        midpoint,
        candleIndex: index,
        mitigated: future.some((candle) => candle.low <= midpoint)
      });
    }
    if (right.high < left.low) {
      const gapSize = left.low - right.high;
      const midpoint = (right.high + left.low) / 2;
      const future = candles.slice(index + 1);
      const fullyFilled = future.some((candle) => candle.high >= left.low);
      if (!middleIsBearishDisplacement || gapSize < minGapSize || fullyFilled) continue;
      gaps.push({
        direction: "short",
        low: right.high,
        high: left.low,
        midpoint,
        candleIndex: index,
        mitigated: future.some((candle) => candle.high >= midpoint)
      });
    }
  }
  return gaps;
}
