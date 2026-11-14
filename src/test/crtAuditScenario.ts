import type { Candle, MarketContext } from "../lib/ict/types";
import { createStructureContext, htfCrtSeries, type HtfCrtFixture } from "./strategyFixtures";

// Audit scenario (2026-11-14): a 4H short CRT on REAL time spacing (4H candles 4 h apart, 15m
// candles 15 min apart) so Candle 2 / Candle 3 windows and the confirm-TF sequence are real.
// Prices are written on a 100 scale and divided by 100 (EURUSD-like ~1.00).
//   C1 (4H): high 101, low 95  →  EQ 98
//   C2 (4H): sweeps 101.6, closes 99.6 inside
//   C3 (4H): forming; the retest happens in its first hour
// Inside C2 on 15m: sweep → pivot low 100.3 → bounce → bearish displacement closing 99.6
// (ChoCH) leaving a bearish FVG 99.9-100.45. In C3 price retraces into the FVG.
export type AuditScenarioOptions = {
  // Highest price the C3 retest candle reaches (default 99.95 = only the FVG's lower edge).
  retestHigh?: number;
  // Close of the C3 retest candle (default 99.7).
  retestClose?: number;
  // Extra 15m candles after the retest: [open, high, low, close] on the 100 scale.
  after?: Array<[number, number, number, number]>;
  // Put the 15m ChoCH sequence inside Candle 3 instead of Candle 2 (C2 = sweep only).
  chochInC3?: boolean;
  // Daily CRT above the 4H setup (default "short" = aligned + key level at the swept high).
  daily?: HtfCrtFixture;
};

const M15 = 15 * 60 * 1000;
const H4 = 4 * 60 * 60 * 1000;
const S = (value: number) => value / 100;

function bar(time: number, [open, high, low, close]: [number, number, number, number], closed = true): Candle {
  return { time, open: S(open), high: S(high), low: S(low), close: S(close), volume: 1000, closed };
}

export function auditShortScenario(options: AuditScenarioOptions = {}): { context: MarketContext; c2Open: number; c3Open: number } {
  const c1Open = Date.UTC(2026, 5, 10, 13); // NY 09:00
  const c2Open = c1Open + H4;
  const c3Open = c2Open + H4;
  // 4H: 20 quiet candles, C1, C2, forming C3.
  const quiet: Array<[number, number, number, number]> = Array.from({ length: 20 }, (_, i) => (i % 2 ? [98.5, 99.4, 97.6, 98.8] : [98.8, 99.3, 97.8, 98.5]));
  const h4: Candle[] = [
    ...quiet.map((ohlc, i) => bar(c1Open - (quiet.length - i) * H4, ohlc)),
    bar(c1Open, [96, 101, 95, 100]),
    bar(c2Open, [100, 101.6, 99.4, 99.6])
  ];

  // 15m: C1's 16 candles drift inside the range (no new extremes), then C2, then C3.
  const c1Path: Array<[number, number, number, number]> = Array.from({ length: 16 }, (_, i) => (i % 2 ? [99.6, 99.9, 99.3, 99.8] : [99.8, 100.0, 99.5, 99.6]));
  c1Path[3] = [99.6, 101, 99.4, 99.9]; // C1's high
  c1Path[9] = [99.6, 99.7, 95, 99.2]; // C1's low
  const choch: Array<[number, number, number, number]> = [
    [101.1, 101.1, 100.55, 100.6], // drop
    [100.6, 100.65, 100.3, 100.4], // pivot low 100.3
    [100.4, 100.7, 100.45, 100.6], // bounce (low 100.45 = FVG top)
    [100.6, 100.62, 99.5, 99.6], // bearish displacement: closes through 100.3 (ChoCH)
    [99.6, 99.9, 99.4, 99.5] // high 99.9 = FVG bottom → bearish FVG 99.9-100.45
  ];
  const sweep: Array<[number, number, number, number]> = [
    [99.6, 100.0, 99.5, 99.9],
    [99.9, 100.4, 99.8, 100.3],
    [100.3, 100.8, 100.2, 100.7],
    [100.7, 101.6, 100.6, 101.1] // sweeps C1 high 101 → manipulation
  ];
  const drift = [99.5, 99.6, 99.55, 99.65, 99.5, 99.6, 99.55].map((close): [number, number, number, number] => [close + 0.05, 99.8, 99.4, close]);
  const c2Path: Array<[number, number, number, number]> = options.chochInC3
    ? [...sweep, [101.1, 101.15, 100.7, 100.8], [100.8, 100.95, 100.7, 100.9], ...Array.from({ length: 10 }, (): [number, number, number, number] => [100.9, 101.0, 100.75, 100.85])]
    : [...sweep, ...choch, ...drift];
  const c3Path: Array<[number, number, number, number]> = options.chochInC3
    ? [...choch, [99.5, options.retestHigh ?? 99.95, 99.45, options.retestClose ?? 99.7], ...(options.after ?? [[99.7, 99.75, 99.4, 99.5]])]
    : [[99.6, options.retestHigh ?? 99.95, 99.5, options.retestClose ?? 99.7], ...(options.after ?? [[99.7, 99.75, 99.4, 99.5]])];
  if (options.chochInC3) {
    // C2's own close must stay inside (it sits at ~100.85 there).
    h4[h4.length - 1] = bar(c2Open, [100, 101.6, 99.5, 100.85]);
  }
  const warm: Array<[number, number, number, number]> = Array.from({ length: 24 }, (_, i) => (i % 2 ? [98.6, 99.0, 98.2, 98.8] : [98.8, 99.1, 98.4, 98.6]));
  const m15: Candle[] = [
    ...warm.map((ohlc, i) => bar(c1Open - (warm.length - i) * M15, ohlc)),
    ...c1Path.map((ohlc, i) => bar(c1Open + i * M15, ohlc)),
    ...c2Path.map((ohlc, i) => bar(c2Open + i * M15, ohlc)),
    ...c3Path.map((ohlc, i) => bar(c3Open + i * M15, ohlc))
  ];
  const last = m15[m15.length - 1];
  const c3Parts = m15.filter((candle) => candle.time >= c3Open);
  h4.push({
    time: c3Open,
    open: c3Parts[0].open,
    high: Math.max(...c3Parts.map((candle) => candle.high)),
    low: Math.min(...c3Parts.map((candle) => candle.low)),
    close: last.close,
    volume: 1000,
    closed: false
  });
  const h1: Candle[] = [];
  for (let start = m15[0].time; start <= last.time; start += 4 * M15) {
    const parts = m15.filter((candle) => candle.time >= start && candle.time < start + 4 * M15);
    if (!parts.length) continue;
    h1.push({ time: start, open: parts[0].open, high: Math.max(...parts.map((c) => c.high)), low: Math.min(...parts.map((c) => c.low)), close: parts.at(-1)!.close, volume: 1000, closed: parts.length === 4 });
  }
  // Daily short CRT above (C1 high 101 / C2 101.4) = HTF direction + key level at the swept high.
  const dailyForming = Date.UTC(2026, 5, 9, 21);
  const scale = (candles: Candle[]) => candles.map((candle) => ({ ...candle, open: S(candle.open), high: S(candle.high), low: S(candle.low), close: S(candle.close) }));
  const base = createStructureContext();
  const context = createStructureContext({
    symbol: "EURUSD",
    timeframes: {
      monthly: scale(htfCrtSeries("none", 30 * 24 * 3600 * 1000, Date.UTC(2026, 5, 1))),
      weekly: scale(htfCrtSeries("none", 7 * 24 * 3600 * 1000, Date.UTC(2026, 5, 7, 21))),
      daily: scale(htfCrtSeries(options.daily ?? "short", 24 * 3600 * 1000, dailyForming)),
      h4,
      h1,
      m15,
      m5: m15
    },
    dealingRange: { high: S(101.6), low: S(95), midpoint: S(98.3), source: "audit" },
    premiumDiscount: { zone: "premium", positionPct: 0.7, midpoint: S(98.3) },
    liquidityPools: [],
    liquidityObjectives: [],
    sweeps: [],
    displacements: [],
    marketStructureShifts: [],
    fairValueGaps: [],
    smtDivergences: [],
    bias: base.bias,
    biasDetail: base.biasDetail
  });
  return { context, c2Open, c3Open };
}
