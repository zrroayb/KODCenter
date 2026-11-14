import { describe, expect, it } from "vitest";
import type { Candle, DealingRange, SwingPoint, TradingSignal } from "../lib/ict/types";
import { crtChochOptions, crtStrategy, detectCrtChoch } from "../lib/strategies/crt/crt.strategy";
import { auditShortScenario, type AuditScenarioOptions } from "./crtAuditScenario";

// ChoCH reference variants (strategy settings `chochReference` / `chochWindow`), 2026-11-14.
// V1 "post-sweep-first-break" must NEVER let a later candle move the reference (audit B3).

const range: DealingRange = { high: 103, low: 97, midpoint: 100, source: "test" };
const bar = (index: number, open: number, high: number, low: number, close: number): Candle =>
  ({ time: Date.UTC(2026, 6, 10) + index * 15 * 60 * 1000, open, high, low, close, volume: 1, closed: true });

// Long after a sweep of the low at index 8. Pre-sweep swing high 101.2 at index 5.
function longSeries(): Candle[] {
  const flat = Array.from({ length: 8 }, (_, i) => bar(i, 100, 100.4, 99.6, 100));
  flat[5] = bar(5, 100, 101.2, 99.8, 100.2);
  return [
    ...flat,
    bar(8, 100, 100.1, 96.5, 99.0), // sweep (manipulation)
    bar(9, 99.0, 100.6, 98.9, 100.4),
    bar(10, 100.4, 100.7, 100.0, 100.5), // post-sweep pivot high 100.7
    bar(11, 100.5, 100.55, 100.1, 100.2),
    bar(12, 100.2, 101.0, 100.15, 100.95) // first break: closes through 100.7 (not through 101.2)
  ];
}
const swings: SwingPoint[] = [{ side: "high", level: 101.2, candleIndex: 5, strength: "minor" }];
const read = (candles: Candle[], reference: "pre-sweep" | "post-sweep-first-break") =>
  detectCrtChoch({ candles, swings, range, direction: "long", manipulationIndex: 8, buffer: 0.2, averageRange: 1, reference });

describe("ChoCH reference variant: post-sweep-first-break (V1)", () => {
  it("the first post-sweep break fixes the reference; pre-sweep (True MSS) does not confirm there", () => {
    const candles = longSeries();
    expect(read(candles, "post-sweep-first-break").reference).toEqual({ level: 100.7, candleIndex: 10 });
    expect(read(candles, "pre-sweep").reference).toEqual({ level: 101.2, candleIndex: 5 });
  });

  it("later candles that print and break NEWER pivots never move the reference", () => {
    const candles = longSeries();
    const first = read(candles, "post-sweep-first-break").reference;
    const later = [
      ...candles,
      bar(13, 100.95, 101.5, 100.9, 101.4), // newer pivot high 101.5
      bar(14, 101.4, 101.45, 101.0, 101.1),
      bar(15, 101.1, 101.9, 101.05, 101.85) // breaks 101.5 too
    ];
    expect(read(later, "post-sweep-first-break").reference).toEqual(first);
  });

  it("when the pre-sweep swing breaks FIRST, it stays the reference even if a post-sweep pivot breaks later", () => {
    const flat = Array.from({ length: 8 }, (_, i) => bar(i, 100, 100.4, 99.6, 100));
    flat[5] = bar(5, 100, 100.8, 99.8, 100.2); // pre-sweep swing high 100.8
    const candles = [
      ...flat,
      bar(8, 100, 100.1, 96.5, 99.0),
      bar(9, 99.0, 101.3, 98.9, 101.2), // straight through 100.8 — no post-sweep pivot yet
      bar(10, 101.2, 101.6, 101.1, 101.5), // post-sweep pivot high 101.6
      bar(11, 101.5, 101.55, 101.2, 101.3),
      bar(12, 101.3, 102.2, 101.25, 102.1) // breaks 101.6 later
    ];
    const first = detectCrtChoch({ candles: candles.slice(0, 10), swings: [{ side: "high", level: 100.8, candleIndex: 5, strength: "minor" }], range, direction: "long", manipulationIndex: 8, buffer: 0.2, averageRange: 1, reference: "post-sweep-first-break" });
    const all = detectCrtChoch({ candles, swings: [{ side: "high", level: 100.8, candleIndex: 5, strength: "minor" }], range, direction: "long", manipulationIndex: 8, buffer: 0.2, averageRange: 1, reference: "post-sweep-first-break" });
    expect(first.reference).toEqual({ level: 100.8, candleIndex: 5 });
    expect(all.reference).toEqual(first.reference);
  });

  it("settings map to options; anything else falls back to the default", () => {
    expect(crtChochOptions({})).toEqual({ reference: "pre-sweep", maxDelay: 12, freshness: 16 });
    expect(crtChochOptions({ chochReference: "post-sweep-first-break", chochWindow: "wide" })).toEqual({ reference: "post-sweep-first-break", maxDelay: 24, freshness: 32 });
    expect(crtChochOptions({ chochReference: "bogus" }).reference).toBe("pre-sweep");
  });
});

// Full engine on the audit scenario (4H short, real spacing). The post-sweep micro pivot is
// 100.3; the pre-sweep swing low is 99.3.
const V1 = { chochReference: "post-sweep-first-break" };
function scan(options: AuditScenarioOptions, settings: Record<string, string> = {}) {
  const { context } = auditShortScenario(options);
  return crtStrategy.scan({ context, settings: { ...crtStrategy.defaultSettings, useExecutionCosts: false, ...settings } })
    .signals.find((item) => item.crtAnchor?.rangeTf === "4h" && item.direction === "short") as TradingSignal;
}
const RUN_TO_DOL: Array<[number, number, number, number]> = [
  [99.7, 99.8, 99.0, 99.1], [99.1, 99.2, 97.5, 97.6], [97.6, 97.7, 96.0, 96.1], [96.1, 96.2, 94.8, 95.0]
];

describe("V1 on the full engine", () => {
  it("a displacement that breaks only the post-sweep pivot confirms under V1, not under True MSS", () => {
    expect(scan({ breakSwing: false }, V1).evidence.find((item) => item.id === "choch")?.status).toBe("pass");
    expect(scan({ breakSwing: false }).evidence.find((item) => item.id === "choch")?.status).toBe("fail");
  });

  it("the fill still needs price to trade the entry (the MSS level 100.3), not just the FVG zone", () => {
    const touchOnly = scan({}, V1); // retest high 100.0 < entry 100.3
    expect(touchOnly.plan.entry).toBeCloseTo(1.003, 6);
    expect(touchOnly.plan.entryStatus).toBe("pending");
    const reached = scan({ retestHigh: 100.35, retestClose: 99.8 }, V1);
    expect(reached.plan.entryStatus).toBe("confirmed");
    expect(reached.stage).toBe("ready");
  });

  it("open and running to DOL: entry, entry status and outcome stay put (no B3 drift)", () => {
    const grind: Array<[number, number, number, number]> = [[99.8, 99.85, 99.3, 99.4], [99.4, 99.6, 99.35, 99.5], [99.5, 99.55, 99.0, 99.1]];
    const atFill = scan({ retestHigh: 100.35, retestClose: 99.8, after: [] }, V1);
    for (let n = 1; n <= grind.length; n += 1) {
      const open = scan({ retestHigh: 100.35, retestClose: 99.8, after: grind.slice(0, n) }, V1);
      expect(open.plan.entry).toBeCloseTo(atFill.plan.entry, 9);
      expect(open.plan.entryStatus).toBe("confirmed");
      expect(open.outcome.status).toBe("open");
    }
    const done = scan({ retestHigh: 100.35, retestClose: 99.8, after: RUN_TO_DOL }, V1);
    expect(done.plan.entry).toBeCloseTo(atFill.plan.entry, 9);
    expect(done.outcome.status).toBe("tp2");
    expect(done.governance.blockers.join(" ")).not.toContain("tüketildi");
  });

  it("wide window is accepted by the engine and leaves the default scenario READY", () => {
    expect(scan({}, { chochWindow: "wide" }).stage).toBe("ready");
  });
});
