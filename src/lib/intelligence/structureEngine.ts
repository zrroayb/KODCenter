import { candleBody, candleRange } from "../ict/candles";
import type { Candle, Displacement, FairValueGap, MarketStructureShift, OrderBlock, RetracementContext, SwingPoint, TradeDirection } from "../ict/types";

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

function confirmedSwingAt(candles: Candle[], index: number, wing: number): SwingPoint | undefined {
  const candle = candles[index];
  const left = candles.slice(index - wing, index);
  const right = candles.slice(index + 1, index + wing + 1);
  if (left.length < wing || right.length < wing) return undefined;
  const isHigh = left.every((item) => candle.high >= item.high) && right.every((item) => candle.high > item.high);
  const isLow = left.every((item) => candle.low <= item.low) && right.every((item) => candle.low < item.low);
  if (!isHigh && !isLow) return undefined;
  return {
    side: isHigh ? "high" : "low",
    level: isHigh ? candle.high : candle.low,
    candleIndex: index,
    strength: wing >= 4 ? "major" : "minor"
  };
}

function removeConsecutiveSameSide(points: SwingPoint[]): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || previous.side !== point.side) {
      result.push(point);
      continue;
    }
    const keepCurrent = point.side === "high" ? point.level > previous.level : point.level < previous.level;
    if (keepCurrent) result[result.length - 1] = point;
  }
  return result;
}

export function detectSwingPoints(candles: Candle[], wing = 3, lookback = 180): SwingPoint[] {
  if (candles.length < wing * 2 + 1) return [];
  const start = Math.max(wing, candles.length - lookback);
  const end = candles.length - wing;
  const points: SwingPoint[] = [];
  for (let index = start; index < end; index += 1) {
    const point = confirmedSwingAt(candles, index, wing);
    if (point) points.push(point);
  }
  return removeConsecutiveSameSide(points);
}

function fallbackPivot(candles: Candle[], side: "high" | "low", lookback = 36): SwingPoint | undefined {
  const swings = detectSwingPoints(candles, 2, lookback).filter((point) => point.side === side);
  if (swings.length) return swings[swings.length - 1];
  const sample = candles.slice(Math.max(0, candles.length - lookback), Math.max(0, candles.length - 1));
  if (!sample.length) return undefined;
  const sampleIndex = sample.reduce((best, candle, index) => {
    if (side === "high") return candle.high > sample[best].high ? index : best;
    return candle.low < sample[best].low ? index : best;
  }, 0);
  const candle = sample[sampleIndex];
  return {
    side,
    level: side === "high" ? candle.high : candle.low,
    candleIndex: Math.max(0, candles.length - lookback) + sampleIndex,
    strength: "minor"
  };
}

export function detectMarketStructureShifts(candles: Candle[]): MarketStructureShift[] {
  if (candles.length < 10) return [];
  const swings = detectSwingPoints(candles, 3);
  const candidates = swings.length ? swings : [
    fallbackPivot(candles, "high"),
    fallbackPivot(candles, "low")
  ].filter((item): item is SwingPoint => Boolean(item));
  const rawShifts: Array<Omit<MarketStructureShift, "kind">> = [];
  let lastBreakDirection: TradeDirection | undefined;

  for (const point of candidates) {
    const direction: TradeDirection = point.side === "high" ? "long" : "short";
    const brokenIndex = candles.findIndex((candle, index) => {
      if (index <= point.candleIndex + 1) return false;
      return direction === "long" ? candle.close > point.level : candle.close < point.level;
    });
    if (brokenIndex < 0) continue;
    rawShifts.push({
      direction,
      level: point.level,
      candleIndex: brokenIndex,
      brokenIndex
    });
  }
  return rawShifts
    .sort((a, b) => a.candleIndex - b.candleIndex)
    .map((shift) => {
      const kind = lastBreakDirection && lastBreakDirection !== shift.direction ? "choch" : "bos";
      lastBreakDirection = shift.direction;
      return { ...shift, kind };
    });
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
      const mitigatedIndex = future.findIndex((candle) => candle.low <= right.low);
      gaps.push({
        direction: "long",
        low: left.high,
        high: right.low,
        midpoint,
        candleIndex: index,
        mitigated: mitigatedIndex >= 0,
        mitigatedIndex: mitigatedIndex >= 0 ? index + 1 + mitigatedIndex : undefined
      });
    }
    if (right.high < left.low) {
      const gapSize = left.low - right.high;
      const midpoint = (right.high + left.low) / 2;
      const future = candles.slice(index + 1);
      const fullyFilled = future.some((candle) => candle.high >= left.low);
      if (!middleIsBearishDisplacement || gapSize < minGapSize || fullyFilled) continue;
      const mitigatedIndex = future.findIndex((candle) => candle.high >= right.high);
      gaps.push({
        direction: "short",
        low: right.high,
        high: left.low,
        midpoint,
        candleIndex: index,
        mitigated: mitigatedIndex >= 0,
        mitigatedIndex: mitigatedIndex >= 0 ? index + 1 + mitigatedIndex : undefined
      });
    }
  }
  return gaps;
}

export function detectOrderBlocks(candles: Candle[], swings = detectSwingPoints(candles, 3)): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const crossed = new Set<number>();
  for (const swing of swings) {
    const direction: TradeDirection = swing.side === "high" ? "long" : "short";
    const breakIndex = candles.findIndex((candle, index) => {
      if (index <= swing.candleIndex + 1) return false;
      return direction === "long" ? candle.close > swing.level : candle.close < swing.level;
    });
    if (breakIndex < 0 || crossed.has(swing.candleIndex)) continue;
    crossed.add(swing.candleIndex);
    const segment = candles.slice(swing.candleIndex + 1, breakIndex);
    if (!segment.length) continue;
    const relativeIndex = direction === "long"
      ? segment.reduce((best, candle, index) => candle.low <= segment[best].low ? index : best, 0)
      : segment.reduce((best, candle, index) => candle.high >= segment[best].high ? index : best, 0);
    const candleIndex = swing.candleIndex + 1 + relativeIndex;
    const blockCandle = candles[candleIndex];
    const future = candles.slice(breakIndex + 1);
    const mitigatedIndex = future.findIndex((item) =>
      direction === "long" ? item.low <= blockCandle.high : item.high >= blockCandle.low
    );
    const volumeScore = [candles[breakIndex], candles[breakIndex - 1], candles[breakIndex - 2]]
      .filter((item): item is Candle => Boolean(item))
      .reduce((sum, item) => sum + item.volume, 0);
    const highVolume = (candles[breakIndex]?.volume ?? 0) + (candles[breakIndex - 1]?.volume ?? 0);
    const lowVolume = candles[breakIndex - 2]?.volume ?? 0;
    const maxVolume = Math.max(highVolume, lowVolume, 1);
    blocks.push({
      direction,
      low: blockCandle.low,
      high: blockCandle.high,
      midpoint: (blockCandle.low + blockCandle.high) / 2,
      candleIndex,
      mitigated: mitigatedIndex >= 0,
      mitigatedIndex: mitigatedIndex >= 0 ? breakIndex + 1 + mitigatedIndex : undefined,
      volumeScore,
      strengthPct: Math.round((Math.min(highVolume, lowVolume) / maxVolume) * 100)
    });
  }
  return blocks;
}

export function buildRetracementContext(candles: Candle[], swings = detectSwingPoints(candles, 3)): RetracementContext {
  const latest = candles[candles.length - 1];
  const lastHigh = [...swings].reverse().find((point) => point.side === "high");
  const lastLow = [...swings].reverse().find((point) => point.side === "low");
  if (!latest || !lastHigh || !lastLow || lastHigh.level === lastLow.level) {
    return {
      direction: "neutral",
      currentPct: 0,
      deepestPct: 0,
      summary: "Retracement için yeterli confirmed swing yok."
    };
  }

  const span = Math.max(Math.abs(lastHigh.level - lastLow.level), 0.000001);
  const bullish = lastHigh.candleIndex > lastLow.candleIndex;
  const fromIndex = Math.min(lastHigh.candleIndex, lastLow.candleIndex);
  const sample = candles.slice(fromIndex);
  if (bullish) {
    const currentPct = Math.max(0, Math.min(200, ((lastHigh.level - latest.low) / span) * 100));
    const deepestPct = Math.max(...sample.map((candle) => Math.max(0, ((lastHigh.level - candle.low) / span) * 100)));
    return {
      direction: "bullish",
      currentPct,
      deepestPct,
      swingHigh: lastHigh.level,
      swingLow: lastLow.level,
      summary: `Bullish swing retracement ${currentPct.toFixed(1)}%, deepest ${deepestPct.toFixed(1)}%.`
    };
  }

  const currentPct = Math.max(0, Math.min(200, ((latest.high - lastLow.level) / span) * 100));
  const deepestPct = Math.max(...sample.map((candle) => Math.max(0, ((candle.high - lastLow.level) / span) * 100)));
  return {
    direction: "bearish",
    currentPct,
    deepestPct,
    swingHigh: lastHigh.level,
    swingLow: lastLow.level,
    summary: `Bearish swing retracement ${currentPct.toFixed(1)}%, deepest ${deepestPct.toFixed(1)}%.`
  };
}
