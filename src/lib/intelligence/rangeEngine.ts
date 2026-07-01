import { highestHigh, lowestLow } from "../ict/candles";
import type { Candle, DealingRange } from "../ict/types";

export function buildDealingRange(candles: Candle[], source = "Recent swing range"): DealingRange {
  const sample = candles.slice(-40);
  const high = highestHigh(sample);
  const low = lowestLow(sample);
  return {
    high,
    low,
    midpoint: (high + low) / 2,
    source
  };
}
