import type { Candle, Timeframe, TradeDirection } from "../../ict/types";

export type TurtleSoupPattern = {
  direction: TradeDirection;
  rangeCandleIndex: number;
  turtleCandleIndex: number;
  entryCandleIndex: number;
  rangeHigh: number;
  rangeLow: number;
  rangeMidpoint: number;
  sweepLevel: number;
  reclaimLevel: number;
  entry: number;
  stopExtreme: number;
  tp1: number;
  tp2: number;
  wick: number;
  body: number;
  wickRatio: number;
  wickFactor: number;
  rangeBodyRatio: number;
  rangeDirectionMatches: boolean;
  midpointRespected: boolean;
  summary: string;
};

export type TurtleSoupOptions = {
  lookbackCandles?: number;
  wickFactor?: number;
  minRangeBodyRatio?: number;
  requireOppositeRangeClose?: boolean;
};

const DEFAULT_LOOKBACK_CANDLES = 6;
const DEFAULT_MIN_RANGE_BODY_RATIO = 0.35;

export function turtleSoupWickFactor(timeframe: Timeframe): number {
  if (timeframe === "15m" || timeframe === "5m") return 3;
  return 2;
}

function candleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

function candleRange(candle: Candle): number {
  return Math.max(candle.high - candle.low, 0.000001);
}

function wickRatio(wick: number, body: number): number {
  return wick / Math.max(body, 0.000001);
}

function entryAfter(candles: Candle[], turtleCandleIndex: number): { entry: number; entryCandleIndex: number } {
  const next = candles[turtleCandleIndex + 1];
  if (next) return { entry: next.open, entryCandleIndex: turtleCandleIndex + 1 };
  // Market data providers usually hand us closed candles only. The next forming open is
  // effectively the last close until a live tick feed exists, matching the MT5 alert timing.
  return { entry: candles[turtleCandleIndex].close, entryCandleIndex: turtleCandleIndex };
}

function bullishPattern(candles: Candle[], rangeIndex: number, turtleIndex: number, wickFactorValue: number, minRangeBodyRatio: number, requireOppositeRangeClose: boolean): TurtleSoupPattern | undefined {
  const rangeCandle = candles[rangeIndex];
  const turtleCandle = candles[turtleIndex];
  const body = candleBody(turtleCandle);
  if (body <= 0 || turtleCandle.close <= turtleCandle.open) return undefined;

  const rangeMidpoint = (rangeCandle.high + rangeCandle.low) / 2;
  const lowerWick = Math.min(turtleCandle.open, turtleCandle.close) - turtleCandle.low;
  const ratio = wickRatio(lowerWick, body);
  const rangeBodyRatio = candleBody(rangeCandle) / candleRange(rangeCandle);
  const rangeDirectionMatches = rangeCandle.close < rangeCandle.open;
  const midpointRespected = turtleCandle.high < rangeMidpoint;

  if (requireOppositeRangeClose && !rangeDirectionMatches) return undefined;
  if (rangeBodyRatio < minRangeBodyRatio) return undefined;
  if (!(turtleCandle.low < rangeCandle.low && turtleCandle.close > rangeCandle.low)) return undefined;
  if (ratio < wickFactorValue) return undefined;
  if (!midpointRespected) return undefined;

  const { entry, entryCandleIndex } = entryAfter(candles, turtleIndex);
  return {
    direction: "long",
    rangeCandleIndex: rangeIndex,
    turtleCandleIndex: turtleIndex,
    entryCandleIndex,
    rangeHigh: rangeCandle.high,
    rangeLow: rangeCandle.low,
    rangeMidpoint,
    sweepLevel: turtleCandle.low,
    reclaimLevel: rangeCandle.low,
    entry,
    stopExtreme: turtleCandle.low,
    tp1: rangeMidpoint,
    tp2: rangeCandle.high,
    wick: lowerWick,
    body,
    wickRatio: ratio,
    wickFactor: wickFactorValue,
    rangeBodyRatio,
    rangeDirectionMatches,
    midpointRespected,
    summary: `Bullish Turtle Soup: önceki range low purge edildi, mum low üstüne kapandı, lower wick ${ratio.toFixed(1)}x body.`
  };
}

function bearishPattern(candles: Candle[], rangeIndex: number, turtleIndex: number, wickFactorValue: number, minRangeBodyRatio: number, requireOppositeRangeClose: boolean): TurtleSoupPattern | undefined {
  const rangeCandle = candles[rangeIndex];
  const turtleCandle = candles[turtleIndex];
  const body = candleBody(turtleCandle);
  if (body <= 0 || turtleCandle.close >= turtleCandle.open) return undefined;

  const rangeMidpoint = (rangeCandle.high + rangeCandle.low) / 2;
  const upperWick = turtleCandle.high - Math.max(turtleCandle.open, turtleCandle.close);
  const ratio = wickRatio(upperWick, body);
  const rangeBodyRatio = candleBody(rangeCandle) / candleRange(rangeCandle);
  const rangeDirectionMatches = rangeCandle.close > rangeCandle.open;
  const midpointRespected = turtleCandle.low > rangeMidpoint;

  if (requireOppositeRangeClose && !rangeDirectionMatches) return undefined;
  if (rangeBodyRatio < minRangeBodyRatio) return undefined;
  if (!(turtleCandle.high > rangeCandle.high && turtleCandle.close < rangeCandle.high)) return undefined;
  if (ratio < wickFactorValue) return undefined;
  if (!midpointRespected) return undefined;

  const { entry, entryCandleIndex } = entryAfter(candles, turtleIndex);
  return {
    direction: "short",
    rangeCandleIndex: rangeIndex,
    turtleCandleIndex: turtleIndex,
    entryCandleIndex,
    rangeHigh: rangeCandle.high,
    rangeLow: rangeCandle.low,
    rangeMidpoint,
    sweepLevel: turtleCandle.high,
    reclaimLevel: rangeCandle.high,
    entry,
    stopExtreme: turtleCandle.high,
    tp1: rangeMidpoint,
    tp2: rangeCandle.low,
    wick: upperWick,
    body,
    wickRatio: ratio,
    wickFactor: wickFactorValue,
    rangeBodyRatio,
    rangeDirectionMatches,
    midpointRespected,
    summary: `Bearish Turtle Soup: önceki range high purge edildi, mum high altına kapandı, upper wick ${ratio.toFixed(1)}x body.`
  };
}

export function detectLatestTurtleSoup(candles: Candle[], timeframe: Timeframe, options: TurtleSoupOptions = {}): TurtleSoupPattern | undefined {
  if (candles.length < 2) return undefined;
  const wickFactorValue = options.wickFactor ?? turtleSoupWickFactor(timeframe);
  const minRangeBodyRatio = options.minRangeBodyRatio ?? DEFAULT_MIN_RANGE_BODY_RATIO;
  const requireOppositeRangeClose = options.requireOppositeRangeClose ?? true;
  const lookbackCandles = Math.max(1, options.lookbackCandles ?? DEFAULT_LOOKBACK_CANDLES);
  const firstTurtleIndex = Math.max(1, candles.length - lookbackCandles);

  for (let turtleIndex = candles.length - 1; turtleIndex >= firstTurtleIndex; turtleIndex -= 1) {
    const rangeIndex = turtleIndex - 1;
    const bullish = bullishPattern(candles, rangeIndex, turtleIndex, wickFactorValue, minRangeBodyRatio, requireOppositeRangeClose);
    if (bullish) return bullish;
    const bearish = bearishPattern(candles, rangeIndex, turtleIndex, wickFactorValue, minRangeBodyRatio, requireOppositeRangeClose);
    if (bearish) return bearish;
  }
  return undefined;
}
