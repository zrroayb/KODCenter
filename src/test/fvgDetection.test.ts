import { describe, expect, it } from "vitest";
import { detectFairValueGaps } from "../lib/intelligence/structureEngine";
import type { Candle } from "../lib/ict/types";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: Date.UTC(2026, 5, 30, 12, 0) + index * 15 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 1000 + index
  };
}

function baseCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => candle(index, 100, 100.5, 99.5, 100));
}

describe("fair value gap detection", () => {
  it("ignores tiny wick gaps without displacement", () => {
    const candles = baseCandles(24);
    candles[20] = candle(20, 100, 100.1, 99.8, 99.95);
    candles[21] = candle(21, 99.95, 100.02, 99.75, 99.9);
    candles[22] = candle(22, 99.78, 99.79, 99.62, 99.7);

    expect(detectFairValueGaps(candles)).toEqual([]);
  });

  it("detects a real bearish displacement gap that stays unfilled", () => {
    const candles = baseCandles(26);
    candles[20] = candle(20, 100.8, 101, 100, 100.7);
    candles[21] = candle(21, 100.6, 100.7, 98.5, 98.8);
    candles[22] = candle(22, 98.9, 99.4, 98.6, 98.7);
    candles[23] = candle(23, 98.7, 99.35, 98.4, 99);
    candles[24] = candle(24, 99, 99.38, 98.8, 99.2);
    candles[25] = candle(25, 99.2, 99.39, 98.9, 99.1);

    const gaps = detectFairValueGaps(candles);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      direction: "short",
      low: 99.4,
      high: 100,
      candleIndex: 22,
      mitigated: false
    });
  });

  it("marks a bearish gap mitigated when price trades back into the gap boundary", () => {
    const candles = baseCandles(26);
    candles[20] = candle(20, 100.8, 101, 100, 100.7);
    candles[21] = candle(21, 100.6, 100.7, 98.5, 98.8);
    candles[22] = candle(22, 98.9, 99.4, 98.6, 98.7);
    candles[23] = candle(23, 98.7, 99.35, 98.4, 99);
    candles[24] = candle(24, 99, 99.52, 98.8, 99.2);
    candles[25] = candle(25, 99.2, 99.6, 98.9, 99.1);

    const gaps = detectFairValueGaps(candles);

    expect(gaps[0]).toMatchObject({
      direction: "short",
      mitigated: true,
      mitigatedIndex: 24
    });
  });

  it("keeps a bearish FVG valid when a wick fills the box but the candle closes below it", () => {
    const candles = baseCandles(26);
    candles[20] = candle(20, 100.8, 101, 100, 100.7);
    candles[21] = candle(21, 100.6, 100.7, 98.5, 98.8);
    candles[22] = candle(22, 98.9, 99.4, 98.6, 98.7);
    candles[23] = candle(23, 98.8, 100.2, 98.6, 99.7);
    candles[24] = candle(24, 99.7, 99.8, 98.7, 99);
    candles[25] = candle(25, 99, 99.2, 98.5, 98.8);

    expect(detectFairValueGaps(candles)[0]).toMatchObject({
      direction: "short",
      low: 99.4,
      high: 100,
      mitigated: true,
      mitigatedIndex: 23
    });
  });

  it("inverts a bearish FVG only after a candle closes above its far edge", () => {
    const candles = baseCandles(26);
    candles[20] = candle(20, 100.8, 101, 100, 100.7);
    candles[21] = candle(21, 100.6, 100.7, 98.5, 98.8);
    candles[22] = candle(22, 98.9, 99.4, 98.6, 98.7);
    candles[23] = candle(23, 98.8, 100.3, 98.6, 100.1);
    candles[24] = candle(24, 100.1, 100.2, 99.4, 99.8);
    candles[25] = candle(25, 99.8, 100, 99.2, 99.5);

    expect(detectFairValueGaps(candles)[0]).toMatchObject({
      direction: "long",
      mitigated: true
    });
  });

  it("applies the same close-through inversion rule to bullish FVGs", () => {
    const wickTap = baseCandles(26);
    wickTap[20] = candle(20, 99.2, 100, 99, 99.3);
    wickTap[21] = candle(21, 99.4, 101.5, 99.3, 101.2);
    wickTap[22] = candle(22, 101.1, 101.4, 100.6, 101.3);
    wickTap[23] = candle(23, 101.2, 101.4, 98.8, 100.2);
    wickTap[24] = candle(24, 100.2, 101.2, 99.5, 100.7);
    wickTap[25] = candle(25, 100.7, 101.3, 100.1, 101);

    const closeThrough = wickTap.map((item) => ({ ...item }));
    closeThrough[23] = candle(23, 101.2, 101.4, 98.8, 98.9);

    expect(detectFairValueGaps(wickTap)[0]).toMatchObject({ direction: "long", mitigated: true });
    expect(detectFairValueGaps(closeThrough)[0]).toMatchObject({ direction: "short", mitigated: true });
  });
});
