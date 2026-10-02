import { completedCandles } from "../ict/candles";
import type { Candle } from "../ict/types";

// CRT is a 3-candle cycle (CRT Secrets): Candle 1 = accumulation (the range, wick high/low),
// Candle 2 = manipulation (wick sweep of a C1 extreme, closing back inside), Candle 3 =
// distribution (the only candle that is traded). The chart draws the ACTIVE Candle 1:
// - if the last closed candle swept ONE side of the candle before it with a wick and closed back
//   inside, that older candle is C1 and the forming candle is C3 (trade window);
// - otherwise the last closed candle is C1 and the forming candle is C2 (wait for the sweep).
export type ChartCrtRange = {
  high: number;
  low: number;
  eq: number;
  // Open time (ms) of Candle 1 — the lines start here and extend right.
  time: number;
  phase: "c2" | "c3";
  sweptSide?: "high" | "low";
};

function rangeOf(candle: Candle) {
  return { high: candle.high, low: candle.low, eq: (candle.high + candle.low) / 2, time: candle.time };
}

export function activeCrtRange(candles: Candle[]): ChartCrtRange | undefined {
  const closed = completedCandles(candles).filter((candle) => candle.high > candle.low);
  const last = closed.at(-1);
  const prior = closed.at(-2);
  if (!last) return undefined;
  if (prior) {
    const sweptHigh = last.high > prior.high;
    const sweptLow = last.low < prior.low;
    const closedInside = last.close <= prior.high && last.close >= prior.low;
    // One-sided wick sweep + close back inside = textbook Candle 2. An outside bar (both sides)
    // or a close beyond the range (acceptance) is not a CRT.
    if (sweptHigh !== sweptLow && closedInside) {
      return { ...rangeOf(prior), phase: "c3", sweptSide: sweptHigh ? "high" : "low" };
    }
  }
  return { ...rangeOf(last), phase: "c2" };
}

export function crtPhaseText(range: ChartCrtRange, label: string): string {
  if (range.phase === "c3") {
    return `C3 · ${label} ${range.sweptSide === "high" ? "high" : "low"} süpürüldü, içeride kapandı → işlem mumu (hedef önce EQ, sonra karşı uç)`;
  }
  return `C2 oluşuyor · ${label} high/low sweep + içeride kapanış bekleniyor`;
}
