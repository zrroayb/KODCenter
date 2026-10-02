import { describe, expect, it } from "vitest";
import { previousClosedRange } from "../lib/charts/crtRange";

const bar = (time: number, high: number, low: number, closed = true) => ({ time, open: low, high, low, close: high, volume: 1, closed });

describe("chart CRT range = previous closed candle of the tab's timeframe", () => {
  it("uses the last CLOSED candle, ignoring the forming one", () => {
    const range = previousClosedRange([bar(1, 10, 5), bar(2, 12, 8), bar(3, 20, 1, false)]);
    expect(range).toEqual({ high: 12, low: 8, eq: 10, time: 2 });
  });

  it("returns nothing for empty or flat data", () => {
    expect(previousClosedRange([])).toBeUndefined();
    expect(previousClosedRange([bar(1, 5, 5)])).toBeUndefined();
  });
});
