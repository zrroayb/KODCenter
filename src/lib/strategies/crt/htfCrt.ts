import type { Candle, MarketContext, TradeDirection } from "../../ict/types";

// HTF direction + key levels come from the Monthly / Weekly / Daily CRT (owner rule 2026-11-14:
// "weekly daily monthly CRT bakacaksın"). Per timeframe, read the textbook 3-candle cycle on the
// last two CLOSED candles: C2 (last closed) wick-swept exactly ONE side of C1 (the one before)
// and closed back inside → that timeframe is in Candle 3 and draws to C1's opposite extreme.
// Swept high → bearish, swept low → bullish. Anything else (no sweep, both sides, close beyond
// = acceptance) is no active CRT on that timeframe.
export type HtfCrtTimeframe = "1d" | "1w" | "1M";

export type HtfCrtRead = {
  timeframe: HtfCrtTimeframe;
  direction?: TradeDirection;
  // The CRT formed but its Candle 3 (still forming) already finished it: "target" = C3 reached
  // C1's opposite extreme (the draw is delivered), "invalidated" = C3 traded beyond the extreme C2
  // swept. Either way this timeframe gives NO direction (audit B7, 2026-11-14).
  spent?: "target" | "invalidated";
  // Candle 1 of the active CRT (when there is one).
  c1?: { high: number; low: number; time: number };
};

const ORDER: HtfCrtTimeframe[] = ["1d", "1w", "1M"];
const RANK: Record<string, number> = { "4h": 0, "1d": 1, "1w": 2, "1M": 3 };

function htfCandles(context: MarketContext, timeframe: HtfCrtTimeframe): Candle[] {
  if (timeframe === "1d") return context.timeframes.daily;
  if (timeframe === "1w") return context.timeframes.weekly;
  return context.timeframes.monthly;
}

// Same convention as detectAnchorRaid: rows with an explicit closed flag are filtered by it;
// legacy/demo rows without flags treat the last row as the forming candle.
export function closedHtfCandles(candles: Candle[]): Candle[] {
  const hasExplicitState = candles.some((candle) => typeof candle.closed === "boolean");
  return hasExplicitState ? candles.filter((candle) => candle.closed !== false) : candles.slice(0, -1);
}

function formingHtfCandle(candles: Candle[]): Candle | undefined {
  const hasExplicitState = candles.some((candle) => typeof candle.closed === "boolean");
  return hasExplicitState ? candles.filter((candle) => candle.closed === false).at(-1) : candles.at(-1);
}

export type CrtCycleRead = Omit<HtfCrtRead, "timeframe">;

// THE single 3-candle CRT definition shared by the D/W/M direction read and the chart (audit B6,
// 2026-11-14): C1 and C2 = the last two CLOSED candles; C2 swept exactly one side of C1 and
// closed back inside → Candle 3 is live, with the forming candle checked for a spent CRT.
// (The engine's own anchor raid detection keeps its wider C1 search — owner decision.)
export function readCrtCycle(candles: Candle[]): CrtCycleRead {
  const closed = closedHtfCandles(candles).filter((candle) => candle.high > candle.low);
  const c1 = closed.at(-2);
  const c2 = closed.at(-1);
  if (!c1 || !c2) return {};
  const sweptHigh = c2.high > c1.high;
  const sweptLow = c2.low < c1.low;
  const closedInside = c2.close <= c1.high && c2.close >= c1.low;
  if (sweptHigh === sweptLow || !closedInside) return {};
  const range = { high: c1.high, low: c1.low, time: c1.time };
  const c3 = formingHtfCandle(candles);
  if (c3 && c3.time > c2.time) {
    const targetHit = sweptHigh ? c3.low <= c1.low : c3.high >= c1.high;
    const beyondSweep = sweptHigh ? c3.high > c2.high : c3.low < c2.low;
    if (beyondSweep) return { spent: "invalidated", c1: range };
    if (targetHit) return { spent: "target", c1: range };
  }
  return { direction: sweptHigh ? "short" : "long", c1: range };
}

export function readHtfCrt(candles: Candle[], timeframe: HtfCrtTimeframe): HtfCrtRead {
  return { timeframe, ...readCrtCycle(candles) };
}

// The D/W/M timeframes strictly above an anchor's range timeframe (4H → D/W/M, 1D → W/M,
// 1W → M, 1M → none: the monthly CRT is the top of the chain).
export function higherCrtTimeframes(rangeTf: string): HtfCrtTimeframe[] {
  const rank = RANK[rangeTf] ?? 0;
  return ORDER.filter((timeframe) => RANK[timeframe] > rank);
}

export function readHigherCrts(context: MarketContext, rangeTf: string): HtfCrtRead[] {
  return higherCrtTimeframes(rangeTf).map((timeframe) => readHtfCrt(htfCandles(context, timeframe), timeframe));
}

// Key levels = OLD HTF highs/lows on the D/W/M timeframes ABOVE the anchor: the three closed
// candles of each that ended before the anchor's Candle 1 opened (the higher candle that
// contains C1 is skipped). So C1 can never validate itself — a 1D C1's high is not its own
// "PDH". The monthly anchor (nothing above) uses the ten closed months before C1.
export function crtKeyLevels(
  context: MarketContext,
  rangeTf: string,
  c1Time: number
): Array<{ level: number; timeframe: HtfCrtTimeframe }> {
  const levels: Array<{ level: number; timeframe: HtfCrtTimeframe }> = [];
  const higher = higherCrtTimeframes(rangeTf);
  if (higher.length === 0) {
    const older = closedHtfCandles(context.timeframes.monthly).filter((candle) => candle.time < c1Time).slice(-10);
    for (const candle of older) levels.push({ level: candle.high, timeframe: "1M" }, { level: candle.low, timeframe: "1M" });
    return levels;
  }
  for (const timeframe of higher) {
    // The higher candle C1 sits in = the latest one (closed or forming) opened at/before C1.
    const all = htfCandles(context, timeframe);
    const container = [...all].reverse().find((candle) => candle.time <= c1Time);
    const before = container ? container.time : c1Time;
    const older = closedHtfCandles(all).filter((candle) => candle.time < before).slice(-3);
    for (const candle of older) levels.push({ level: candle.high, timeframe }, { level: candle.low, timeframe });
  }
  return levels;
}
