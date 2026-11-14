import type { Candle, MarketContext } from "../lib/ict/types";
import { createStructureContext, htfCrtSeries, type HtfCrtFixture } from "./strategyFixtures";

// Audit scenario (2026-11): a 4H short CRT on REAL time spacing (4H candles 4 h apart, 15m
// candles 15 min apart) so Candle 2 / Candle 3 windows and the confirm-TF sequence are real.
// Prices are written on a 100 scale and divided by 100 (EURUSD-like ~1.00).
//   C1 (4H): high 101, low 95  →  EQ 98
//   C2 (4H): sweeps 101.6 and closes back inside
//   C3 (4H): forming; the retest happens in its first hour
// 15m inside C2: a swing LOW at 99.3 forms (the pre-sweep structure), price climbs and sweeps C1's
// high, drops, and a bearish displacement closes BELOW 99.3 = True MSS, leaving a bearish FVG
// (bounce low 100.45 → next high `fvgLow`). Entry = the FVG's near edge (or the MSS level when the
// edge sits below it); the retest comes in C3.
export type AuditScenarioOptions = {
  // High of the C3 retest candle (default 100.0: reaches the default entry 99.9).
  retestHigh?: number;
  // Close of the C3 retest candle (default 99.7).
  retestClose?: number;
  // Extra 15m candles after the retest: [open, high, low, close] on the 100 scale.
  after?: Array<[number, number, number, number]>;
  // Put the 15m ChoCH sequence inside Candle 3 instead of Candle 2 (C2 = sweep + settle).
  chochInC3?: boolean;
  // Daily CRT above the 4H setup (default "short" = aligned + key level at the swept high).
  daily?: HtfCrtFixture;
  // false → the displacement only breaks the post-sweep micro pivot (100.3), NOT the pre-sweep
  // swing low (99.3): the old engine confirmed this, True MSS does not.
  breakSwing?: boolean;
  // High of the candle after the displacement = the FVG's near edge (default 99.9 → entry 99.9;
  // 99.2 puts the edge BELOW the MSS level 99.3, so the entry is the MSS level itself).
  fvgLow?: number;
};

type Ohlc = [number, number, number, number];
const M15 = 15 * 60 * 1000;
const H4 = 4 * 60 * 60 * 1000;
const REF = 99.3; // pre-sweep swing low = the True MSS reference
const S = (value: number) => value / 100;

function bar(time: number, [open, high, low, close]: Ohlc, closed = true): Candle {
  return { time, open: S(open), high: S(high), low: S(low), close: S(close), volume: 1000, closed };
}

export function auditShortScenario(options: AuditScenarioOptions = {}): { context: MarketContext; c2Open: number; c3Open: number } {
  const c1Open = Date.UTC(2026, 5, 10, 13); // NY 09:00
  const c2Open = c1Open + H4;
  const c3Open = c2Open + H4;
  const fvgLow = options.fvgLow ?? 99.9;
  const breakSwing = options.breakSwing !== false;

  const quiet: Ohlc[] = Array.from({ length: 20 }, (_, i) => (i % 2 ? [98.5, 99.4, 97.6, 98.8] : [98.8, 99.3, 97.8, 98.5]));
  const h4: Candle[] = quiet.map((ohlc, i) => bar(c1Open - (quiet.length - i) * H4, ohlc));
  h4.push(bar(c1Open, [96, 101, 95, 100]));

  // C1 on 15m: 16 candles inside the range, lows ≥ 99.5 (no swing below the reference).
  const c1Path: Ohlc[] = Array.from({ length: 16 }, (_, i) => (i % 2 ? [99.6, 99.9, 99.55, 99.8] : [99.8, 100.0, 99.5, 99.6]));
  c1Path[3] = [99.6, 101, 99.5, 99.9]; // C1's high
  c1Path[9] = [99.6, 99.7, 95, 99.2]; // C1's low
  c1Path[12] = [99.8, 100.6, 99.5, 99.6]; // swing HIGH between C1's low and the reference swing low (swing detection drops consecutive same-side swings)

  // Swing low (3 wings) then a climb that sweeps C1's high.
  const climb: Ohlc[] = [
    [99.6, 99.7, REF, 99.6], // pivot low 99.3
    [99.6, 100.0, 99.7, 99.9],
    [99.9, 100.3, 99.8, 100.2],
    [100.2, 101.6, 100.1, 101.1] // sweeps C1 high 101 → manipulation
  ];
  const displacement: Ohlc = breakSwing ? [100.6, 100.62, REF - 0.2, REF - 0.1] : [100.6, 100.62, 99.6, 99.7];
  const afterDisplacement: Ohlc = [displacement[3], fvgLow, displacement[2] - 0.1, Math.min(displacement[3] + 0.4, fvgLow - 0.05)];
  const choch: Ohlc[] = [
    [101.1, 101.1, 100.55, 100.6], // drop
    [100.6, 100.65, 100.3, 100.4], // post-sweep micro pivot low 100.3
    [100.5, 100.7, 100.45, 100.6], // bounce (low 100.45 = FVG top)
    displacement,
    afterDisplacement
  ];
  const settle: Ohlc[] = Array.from({ length: 4 }, () => [100.9, 101.0, 100.7, 100.85]);
  const drift: Ohlc[] = Array.from({ length: 7 }, () => [99.6, 99.8, 99.4, 99.6]);
  const filler: Ohlc[] = Array.from({ length: 8 }, () => [99.9, 100.2, 99.7, 100.0]);

  const c2Path: Ohlc[] = options.chochInC3
    ? [...filler, ...climb, ...settle] // 8 + 4 + 4 = 16
    : [...climb, ...choch, ...drift]; // 4 + 5 + 7 = 16
  const retestHigh = options.retestHigh ?? 100.0;
  const retestOpen = Math.min(99.6, retestHigh - 0.05);
  const retestLow = Math.min(99.5, retestOpen - 0.05);
  const retest: Ohlc = [retestOpen, retestHigh, retestLow, Math.max(retestLow, Math.min(retestHigh, options.retestClose ?? 99.7))];
  const c3Path: Ohlc[] = [
    ...(options.chochInC3 ? choch : []),
    retest,
    ...(options.after ?? [[99.7, 99.75, 99.4, 99.5]])
  ];

  const warm: Ohlc[] = Array.from({ length: 24 }, (_, i) => (i % 2 ? [98.6, 99.0, 98.2, 98.8] : [98.8, 99.1, 98.4, 98.6]));
  const m15: Candle[] = [
    ...warm.map((ohlc, i) => bar(c1Open - (warm.length - i) * M15, ohlc)),
    ...c1Path.map((ohlc, i) => bar(c1Open + i * M15, ohlc)),
    ...c2Path.map((ohlc, i) => bar(c2Open + i * M15, ohlc)),
    ...c3Path.map((ohlc, i) => bar(c3Open + i * M15, ohlc))
  ];
  const last = m15[m15.length - 1];

  // 4H C2 / forming C3 from their own 15m candles (keeps every timeframe consistent).
  const rollup = (from: number, to: number, closed: boolean): Candle => {
    const parts = m15.filter((candle) => candle.time >= from && candle.time < to);
    return {
      time: from, open: parts[0].open, high: Math.max(...parts.map((c) => c.high)), low: Math.min(...parts.map((c) => c.low)),
      close: parts.at(-1)!.close, volume: 1000, closed
    };
  };
  h4.push(rollup(c2Open, c3Open, true), rollup(c3Open, c3Open + H4, false));

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
