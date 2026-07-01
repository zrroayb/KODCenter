import { averageTrueRange } from "../ict/candles";
import type { Candle, VolatilityContext } from "../ict/types";

export function buildVolatilityContext(candles: Candle[]): VolatilityContext {
  const ranges = candles.slice(-20).map((candle) => candle.high - candle.low);
  const averageRange = ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
  return {
    atr: averageTrueRange(candles, 14),
    averageRange
  };
}
