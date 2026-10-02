import { describe, expect, it } from "vitest";
import { detectAnchorRaid } from "../lib/strategies/crt/crt.strategy";

const month = (time: number, open: number, high: number, low: number, close: number, closed = true) =>
  ({ time, open, high, low, close, volume: 1, closed });

// CRT Secrets pairing 1M range -> 1D model: the monthly anchor uses the same three-candle read.
describe("1M CRT anchor", () => {
  const spec = { rangeTf: "1M", confirmTf: "1d" } as Parameters<typeof detectAnchorRaid>[1];

  it("detects a monthly C2 that swept C1's low and closed back inside (closed raid)", () => {
    const { range, raid } = detectAnchorRaid([
      month(1, 100, 120, 90, 110),
      month(2, 110, 115, 85, 105),
      month(3, 105, 108, 102, 106, false)
    ], spec);
    expect(range.high).toBe(120);
    expect(range.low).toBe(90);
    expect(raid).toMatchObject({ direction: "long", level: 85, closed: true });
  });

  it("a monthly C2 still forming is a raid but not closed (WATCH only)", () => {
    const { raid } = detectAnchorRaid([
      month(1, 100, 120, 90, 110),
      month(2, 110, 115, 85, 95, false)
    ], spec);
    expect(raid?.direction).toBe("long");
    expect(raid?.closed).toBe(false);
  });
});
