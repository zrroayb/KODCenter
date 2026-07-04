import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { buildRetracementContext, detectMarketStructureShifts, detectOrderBlocks, detectSwingPoints } from "../lib/intelligence/structureEngine";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: Date.UTC(2026, 5, 30, 12, 0) + index * 15 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 1000 + index * 10
  };
}

function structureBreakCandles(): Candle[] {
  return [
    candle(0, 99.5, 100, 99, 99.6),
    candle(1, 100, 101, 99.2, 100.4),
    candle(2, 100.5, 102, 99.4, 101.4),
    candle(3, 101.5, 103, 99.8, 102.4),
    candle(4, 102.6, 105, 100, 104),
    candle(5, 103.2, 103.4, 99, 100.2),
    candle(6, 100.1, 102, 98, 98.8),
    candle(7, 98.7, 101, 97, 99.5),
    candle(8, 99.6, 106, 100, 105.6),
    candle(9, 105.6, 106.5, 104.2, 105.8),
    candle(10, 105.8, 106.2, 103.8, 104.4),
    candle(11, 104.4, 105.2, 102.8, 103.6)
  ];
}

describe("SMC structure primitives", () => {
  it("detects confirmed swing points without keeping weaker consecutive duplicates", () => {
    const swings = detectSwingPoints(structureBreakCandles(), 1);

    expect(swings.map((point) => point.side)).toEqual(expect.arrayContaining(["high", "low"]));
    for (let index = 1; index < swings.length; index += 1) {
      expect(swings[index].side).not.toBe(swings[index - 1].side);
    }
  });

  it("derives BOS/CHOCH, order block and retracement from swing structure", () => {
    const candles = structureBreakCandles();
    const swings = detectSwingPoints(candles, 1);
    const shifts = detectMarketStructureShifts(candles);
    const blocks = detectOrderBlocks(candles, swings);
    const retracement = buildRetracementContext(candles, swings);

    expect(shifts.some((shift) => shift.direction === "long" && shift.kind === "bos")).toBe(true);
    expect(blocks.some((block) => block.direction === "long" && block.low === 97 && block.high === 101)).toBe(true);
    expect(retracement.direction).not.toBe("neutral");
    expect(retracement.summary).toContain("retracement");
  });
});
