import { completedCandles } from "../ict/candles";
import type { Candle } from "../ict/types";

// The CRT range of a timeframe = its previous CLOSED candle (same definition as the CRT engine's
// rangeFromCandle). Drawn from that candle's open time to the right edge, so the current period
// is read against it: sweep of High/Low, return inside, EQ (0.5).
export type ChartCrtRange = {
  high: number;
  low: number;
  eq: number;
  // Open time (ms) of the reference candle — the line starts here.
  time: number;
};

export function previousClosedRange(candles: Candle[]): ChartCrtRange | undefined {
  const reference = completedCandles(candles).at(-1);
  if (!reference || !(reference.high > reference.low)) return undefined;
  return {
    high: reference.high,
    low: reference.low,
    eq: (reference.high + reference.low) / 2,
    time: reference.time
  };
}
