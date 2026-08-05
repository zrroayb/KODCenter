import { describe, expect, it } from "vitest";
import type { Candle, DealingRange, SwingPoint } from "../lib/ict/types";
import { detectCrtChoch, findCrtEntryRetestIndex, findCrtTrackingStartIndex, selectCrtEntry } from "../lib/strategies/crt/crt.strategy";

function candles(count = 14): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2026, 6, 10, 8, 0) + index * 15 * 60 * 1000,
    open: 100,
    high: 100.4,
    low: 99.6,
    close: 100,
    volume: 100,
    closed: true
  }));
}

const range: DealingRange = { high: 103, low: 97, midpoint: 100, source: "test" };

describe("CRT ChoCH truth model", () => {
  it("requires a pre-raid confirmed swing and a closed directional break", () => {
    const data = candles();
    data[9] = { ...data[9], open: 100.99, high: 101.03, low: 100.95, close: 101.01 };
    data[10] = { ...data[10], open: 100.2, high: 101.6, low: 100.1, close: 101.4 };
    const swings: SwingPoint[] = [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }];

    const read = detectCrtChoch({
      candles: data,
      swings,
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference?.candleIndex).toBe(4);
    expect(read.confirmation?.candleIndex).toBe(10);
    expect(read.confirmation?.bodyRatio).toBeGreaterThanOrEqual(0.5);
  });

  it("rejects a fresh re-close when the FIRST break of the swing is stale (BOS, not ChoCH)", () => {
    // 70 candles. Manipulation at 8, first strong close through the swing at 12 — but with 70
    // candles that break is far outside the freshness window. A fresh re-close at 68 exists;
    // stamping it as ChoCH is the BNB bug: the character changed long ago, 68 is the new
    // trend's continuation. detectCrtChoch must return no confirmation at all.
    const data = candles(70);
    data[12] = { ...data[12], open: 100.2, high: 101.6, low: 100.1, close: 101.4 };
    data[68] = { ...data[68], open: 100.2, high: 101.6, low: 100.1, close: 101.4 };
    const swings: SwingPoint[] = [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }];

    const read = detectCrtChoch({
      candles: data,
      swings,
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.confirmation).toBeUndefined();
    expect(read.structuralBreak).toBeUndefined();
  });

  it("rejects a break that comes too long after the manipulation (sweep->shift window)", () => {
    // Manipulation at 8, the only close through the swing at 40 — fresh relative to the end of
    // the series, but 32 candles after the sweep. Sweep and shift are one delivery sequence;
    // a break this late belongs to a different move.
    const data = candles(60);
    data[40] = { ...data[40], open: 100.2, high: 101.6, low: 100.1, close: 101.4 };
    const swings: SwingPoint[] = [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }];

    const read = detectCrtChoch({
      candles: data,
      swings,
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.confirmation).toBeUndefined();
    expect(read.structuralBreak).toBeUndefined();
  });

  it("does not promote a weak close-through as tradeable ChoCH", () => {
    const data = candles();
    data[10] = { ...data[10], open: 100.98, high: 101.3, low: 100.75, close: 101.08 };

    const read = detectCrtChoch({
      candles: data,
      swings: [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }],
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference?.candleIndex).toBe(4);
    expect(read.structuralBreak?.candleIndex).toBe(10);
    expect(read.confirmation).toBeUndefined();
  });

  it("recognizes an already-visible internal pivot as the shift reference", () => {
    const data = candles();
    data[5] = { ...data[5], high: 100.7 };
    data[6] = { ...data[6], high: 101.2 };
    data[7] = { ...data[7], high: 100.8 };
    data[10] = { ...data[10], open: 100.1, high: 101.7, low: 100, close: 101.5 };

    const read = detectCrtChoch({
      candles: data,
      swings: [],
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference).toEqual({ level: 101.2, candleIndex: 6 });
    expect(read.confirmation?.candleIndex).toBe(10);
  });

  it("uses the POST-sweep reclaim pivot (CISD/MSS) as the shift, not a distant pre-sweep swing", () => {
    // ICT 2022 model: after the sweep, the reclaim leg prints a pivot high (idx10), pulls back,
    // then a strong close breaks above it (idx12) = CISD up. No pre-sweep swing is supplied, so
    // only the post-sweep reference can confirm — this is what unlocked the manipulation->ChoCH wall.
    const data = candles();
    data[10] = { ...data[10], open: 100.1, high: 100.7, low: 100.0, close: 100.5 };
    data[11] = { ...data[11], open: 100.4, high: 100.5, low: 100.1, close: 100.2 };
    data[12] = { ...data[12], open: 100.2, high: 101.2, low: 100.15, close: 101.0 };

    const read = detectCrtChoch({
      candles: data,
      swings: [],
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference?.candleIndex).toBe(10);   // reclaim pivot, post-sweep
    expect(read.confirmation?.candleIndex).toBe(12); // strong close through it
  });

  it("falls back to the pre-sweep swing when the post-sweep pivot is never broken", () => {
    // Reclaim makes a pivot high (idx10) but price never closes above it → no post-sweep CISD.
    // Detection must fall back to the supplied pre-sweep swing + its later break (idx12).
    const data = candles();
    data[10] = { ...data[10], open: 100.1, high: 101.9, low: 100.0, close: 101.2 }; // pivot never exceeded
    data[11] = { ...data[11], open: 101.0, high: 101.3, low: 100.6, close: 100.7 };
    data[12] = { ...data[12], open: 100.5, high: 101.1, low: 100.4, close: 101.05 }; // breaks pre-sweep 101, not idx10
    const swings: SwingPoint[] = [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }];

    const read = detectCrtChoch({ candles: data, swings, range, direction: "long", manipulationIndex: 8, buffer: 0.2, averageRange: 1 });
    expect(read.reference?.candleIndex).toBe(4); // pre-sweep fallback
  });

  it("recognizes the mirrored bearish shift after a buy-side manipulation", () => {
    const data = candles();
    data[5] = { ...data[5], low: 99.3 };
    data[6] = { ...data[6], low: 98.8 };
    data[7] = { ...data[7], low: 99.2 };
    data[10] = { ...data[10], open: 99.9, high: 100, low: 98.3, close: 98.5 };

    const read = detectCrtChoch({
      candles: data,
      swings: [],
      range,
      direction: "short",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference).toEqual({ level: 98.8, candleIndex: 6 });
    expect(read.confirmation?.candleIndex).toBe(10);
  });

  it("never treats the CRT range low / DOL as the short ChoCH reference", () => {
    const data = candles();
    data[10] = { ...data[10], open: 98.2, high: 98.3, low: 96.5, close: 96.7 };

    const read = detectCrtChoch({
      candles: data,
      swings: [{ side: "low", level: range.low, candleIndex: 4, strength: "minor" }],
      range,
      direction: "short",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(read.reference).toBeUndefined();
    expect(read.confirmation).toBeUndefined();
  });

  it("does not use an unconfirmed pivot or a forming candle as ChoCH", () => {
    const data = candles();
    data[9] = { ...data[9], open: 100.2, high: 101.6, low: 100.1, close: 101.4, closed: false };

    const lookaheadRead = detectCrtChoch({
      candles: data,
      swings: [{ side: "high", level: 101, candleIndex: 7, strength: "minor" }],
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });
    const formingRead = detectCrtChoch({
      candles: data,
      swings: [{ side: "high", level: 101, candleIndex: 4, strength: "minor" }],
      range,
      direction: "long",
      manipulationIndex: 8,
      buffer: 0.2,
      averageRange: 1
    });

    expect(lookaheadRead.reference).toBeUndefined();
    expect(formingRead.reference).toBeDefined();
    expect(formingRead.confirmation).toBeUndefined();
  });

  it("counts only a separate post-ChoCH touch as entry retest", () => {
    const data = candles();
    data[9] = { ...data[9], low: 99.9, high: 101.3 };
    data[10] = { ...data[10], low: 100.2, high: 101.4 };
    data[11] = { ...data[11], low: 99.8, high: 100.5 };

    expect(findCrtEntryRetestIndex(data.slice(0, 11), 100, 9)).toBeUndefined();
    expect(findCrtEntryRetestIndex(data, 100, 9)).toBe(11);
  });

  it("accepts a post-shift FVG edge tap without demanding a midpoint fill", () => {
    const data = candles();
    data[10] = { ...data[10], low: 99.5, high: 99.9 };
    data[11] = { ...data[11], low: 99.8, high: 100.1 };

    expect(findCrtEntryRetestIndex(data, 100.2, 9, { low: 100, high: 100.4 })).toBe(11);
    expect(data[11].high).toBeLessThan(100.2);
  });

  it("accepts the mirrored bearish FVG low-edge tap without demanding midpoint fill", () => {
    const data = candles();
    data[10] = { ...data[10], low: 100.5, high: 100.9 };
    data[11] = { ...data[11], low: 100.3, high: 100.6 };

    expect(findCrtEntryRetestIndex(data, 100.2, 9, { low: 100, high: 100.4 })).toBe(11);
    expect(data[11].low).toBeGreaterThan(100.2);
  });

  it("keeps a fresh strong ChoCH pending until price retests its entry level", () => {
    const decision = selectCrtEntry({
      choch: { level: 101, candleIndex: 9, referenceCandleIndex: 4, bodyRatio: 0.8, rangeAtr: 1.5 },
      plannedRetestEntry: 101,
      retestIndex: undefined
    });

    expect(decision.entry).toBe(101);
    expect(decision.entrySource).toBe("choch-close");
    expect(decision.entryStatus).toBe("pending");
    expect(decision.retested).toBe(false);
  });

  it("never confirms from the ChoCH close alone — a retest is mandatory (retest-mandatory-for-entry)", () => {
    // b60d381 relaxed this; owner re-enforced 2026-07-22. Even with a confirmationClose the entry
    // stays PENDING (WATCH) until price actually retests — direct-from-close was measured at -0.46R.
    const decision = selectCrtEntry({
      choch: { level: 101, candleIndex: 9, referenceCandleIndex: 4, bodyRatio: 0.8, rangeAtr: 1.5 },
      plannedRetestEntry: 101,
      retestIndex: undefined,
      confirmationClose: 101.4
    });

    expect(decision.entryStatus).toBe("pending");
    expect(decision.retested).toBe(false);
  });

  it("confirms the plan only after the post-ChoCH retest", () => {
    const decision = selectCrtEntry({
      choch: { level: 101, candleIndex: 9, referenceCandleIndex: 4, bodyRatio: 0.8, rangeAtr: 1.5 },
      plannedRetestEntry: 101,
      retestIndex: 11
    });

    expect(decision.entry).toBe(101);
    expect(decision.entryStatus).toBe("confirmed");
    expect(decision.retested).toBe(true);
  });

  it("starts outcome tracking at the retest instead of the older ChoCH candle", () => {
    const start = Date.UTC(2026, 6, 10, 0, 0);
    const executionCandles = Array.from({ length: 40 }, (_, index) => ({
      ...candles(1)[0],
      time: start + index * 15 * 60 * 1000
    }));
    const confirmCandles = Array.from({ length: 8 }, (_, index) => ({
      ...candles(1)[0],
      time: start + index * 60 * 60 * 1000
    }));

    const index = findCrtTrackingStartIndex({
      executionCandles,
      confirmCandles,
      liveConfirmCandles: confirmCandles,
      confirmTf: "1h",
      entrySource: "choch-close",
      chochIndex: 4,
      retestIndex: 6
    });

    expect(index).toBe(24);
  });
});
