import { completedCandles } from "../ict/candles";
import { closedHtfCandles, readCrtCycle } from "../strategies/crt/htfCrt";
import type { Candle, TradingSignal } from "../ict/types";
import { closeConfirmationRequirement } from "../signals/waitingGuidance";

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
  // One CRT definition for chart and D/W/M direction (readCrtCycle). A spent CRT (C3 already
  // took the target or broke past C2's sweep) is over: the last closed candle starts a new C1.
  const last = closedHtfCandles(candles).filter((candle) => candle.high > candle.low).at(-1);
  if (!last) return undefined;
  const cycle = readCrtCycle(candles);
  if (cycle.direction && cycle.c1) {
    return {
      high: cycle.c1.high,
      low: cycle.c1.low,
      eq: (cycle.c1.high + cycle.c1.low) / 2,
      time: cycle.c1.time,
      phase: "c3",
      sweptSide: cycle.direction === "short" ? "high" : "low"
    };
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

// The break the setup waits for (True MSS / ChoCH): the internal swing on the confirmation TF that
// a candle must CLOSE beyond. Once the engine saw that close (cisdConfirmed) the level is shown as
// done, so the chart always answers "neyin kırılımını bekliyoruz?".
export type ChartBreakLevel = {
  level: number;
  // Open time (ms) of the swing candle — the line starts here.
  time: number;
  side: "above" | "below";
  timeframe: string;
  done: boolean;
};

export function chartBreakLevel(signal: TradingSignal): ChartBreakLevel | undefined {
  const pending = closeConfirmationRequirement(signal);
  if (pending) {
    return { level: pending.level, time: pending.candleTime, side: pending.side, timeframe: pending.timeframe, done: false };
  }
  const choch = signal.evidence.find((item) => item.id === "choch");
  if (choch?.status !== "pass" || typeof choch.price !== "number" || typeof choch.time !== "number") return undefined;
  return {
    level: choch.price,
    time: choch.time,
    side: signal.direction === "long" ? "above" : "below",
    timeframe: signal.crtAnchor?.confirmTf ?? choch.timeframe ?? "",
    done: true
  };
}

export function breakLevelText(level: ChartBreakLevel, formatPrice: (value: number) => string): string {
  const where = level.side === "above" ? "üstünde" : "altında";
  return level.done
    ? `Kırılım geldi ✓ · ${level.timeframe} mum ${formatPrice(level.level)} ${where} kapandı (ChoCH / True MSS)`
    : `Beklenen kırılım · ${level.timeframe} mum ${formatPrice(level.level)} ${where} KAPANMALI (ChoCH / True MSS) — fitil sayılmaz`;
}
