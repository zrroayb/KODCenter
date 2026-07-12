import { describe, expect, it } from "vitest";
import type { Candle, DealingRange, SwingPoint } from "../lib/ict/types";
import { detectCrtChoch, findCrtEntryRetestIndex } from "../lib/strategies/crt/crt.strategy";

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
  it("requires a pre-raid confirmed swing and a meaningful displacement close", () => {
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
});
