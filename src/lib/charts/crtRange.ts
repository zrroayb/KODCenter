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
  if (range.sweptSide) {
    return `C2 oluşuyor · ${label} ${range.sweptSide} süpürüldü, C2'nin range içinde kapanması bekleniyor (sadece Candle 3 işlenir)`;
  }
  return `C2 oluşuyor · ${label} high/low sweep + içeride kapanış bekleniyor`;
}

// A selected signal's own CRT range on its confirmation chart: the engine knows the range's
// high/low (crtAnchor), so find that Candle 1 among the anchor timeframe's closed candles (most
// recent match) to start the lines at the right bar. Phase comes from the engine: a raid whose C2
// closed back inside means C3; a live raid (or none yet) means C2.
export function signalCrtRange(
  anchorCandles: Candle[],
  anchor: { rangeHigh: number; rangeLow: number; raidActive: boolean; raidClosed: boolean },
  direction: "long" | "short"
): ChartCrtRange | undefined {
  if (!(anchor.rangeHigh > anchor.rangeLow)) return undefined;
  const closed = completedCandles(anchorCandles);
  const tolerance = (anchor.rangeHigh - anchor.rangeLow) * 1e-6;
  const reference = [...closed].reverse().find((candle) =>
    Math.abs(candle.high - anchor.rangeHigh) <= tolerance && Math.abs(candle.low - anchor.rangeLow) <= tolerance);
  const time = reference?.time ?? closed.at(-2)?.time ?? closed.at(-1)?.time;
  if (typeof time !== "number") return undefined;
  return {
    high: anchor.rangeHigh,
    low: anchor.rangeLow,
    eq: (anchor.rangeHigh + anchor.rangeLow) / 2,
    time,
    phase: anchor.raidActive && anchor.raidClosed ? "c3" : "c2",
    sweptSide: anchor.raidActive ? (direction === "long" ? "low" : "high") : undefined
  };
}
