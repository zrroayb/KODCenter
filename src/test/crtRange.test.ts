import { describe, expect, it } from "vitest";
import { activeCrtRange, crtPhaseText } from "../lib/charts/crtRange";

const bar = (time: number, open: number, high: number, low: number, close: number, closed = true) =>
  ({ time, open, high, low, close, volume: 1, closed });

describe("chart CRT range follows the 3-candle cycle (C1 range, C2 sweep, C3 trade)", () => {
  it("no sweep yet: the last closed candle is C1 and the forming candle is C2", () => {
    const range = activeCrtRange([bar(1, 9, 10, 5, 8), bar(2, 8, 12, 8, 11), bar(3, 11, 13, 10, 12, false)]);
    expect(range).toMatchObject({ high: 12, low: 8, eq: 10, time: 2, phase: "c2" });
  });

  it("C2 wick-swept C1's low and closed back inside: C1 stays the range, we are in C3", () => {
    // C1: 10-20; C2 dips to 8 (sweep low) and closes 15 (inside) — the forming candle is C3.
    const range = activeCrtRange([bar(1, 12, 20, 10, 18), bar(2, 18, 19, 8, 15), bar(3, 15, 16, 14, 15, false)]);
    expect(range).toMatchObject({ high: 20, low: 10, eq: 15, time: 1, phase: "c3", sweptSide: "low" });
    expect(crtPhaseText(range!, "1D")).toContain("C3");
  });

  it("a close beyond the range (acceptance) is not a CRT: the new candle becomes C1", () => {
    const range = activeCrtRange([bar(1, 12, 20, 10, 18), bar(2, 18, 25, 17, 24)]);
    expect(range).toMatchObject({ high: 25, low: 17, phase: "c2" });
  });

  it("an outside bar (both sides swept) is not a CRT either", () => {
    const range = activeCrtRange([bar(1, 12, 20, 10, 18), bar(2, 18, 22, 8, 15)]);
    expect(range).toMatchObject({ high: 22, low: 8, phase: "c2" });
  });

  it("returns nothing for empty data", () => {
    expect(activeCrtRange([])).toBeUndefined();
  });
});
