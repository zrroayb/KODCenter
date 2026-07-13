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
