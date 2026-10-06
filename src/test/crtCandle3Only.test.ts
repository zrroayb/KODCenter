import { describe, expect, it } from "vitest";
import { candle3Progress, candle3Window, inCandle3 } from "../lib/strategies/crt/crt.strategy";

const H4 = 4 * 60 * 60 * 1000;
const bar = (time: number) => ({ time, open: 1, high: 2, low: 0.5, close: 1, volume: 1, closed: true });

describe("only Candle 3 is traded (CRT Secrets)", () => {
  // 4H: C1 at 0, C2 (raid) at 4h, C3 at 8h, C4 at 12h.
  const t0 = Date.UTC(2026, 9, 1, 1);
  const candles = [bar(t0), bar(t0 + H4), bar(t0 + 2 * H4), bar(t0 + 3 * H4)];

  it("C3 is the range candle right after the raid candle", () => {
    const w = candle3Window(candles, { time: t0 + H4, closed: true }, "4h")!;
    expect(w.start).toBe(t0 + 2 * H4);
    expect(w.end).toBe(t0 + 3 * H4);
    expect(inCandle3(w, t0 + H4 + 60_000)).toBe("before");      // a retest during C2 does not count
    expect(inCandle3(w, t0 + 2 * H4 + 15 * 60_000)).toBe("inside");
    expect(inCandle3(w, t0 + 3 * H4)).toBe("after");             // C4: not traded
  });

  it("no window while C2 is still forming", () => {
    expect(candle3Window(candles, { time: t0 + 3 * H4, closed: false }, "4h")).toBeUndefined();
  });

  it("C3 not printed yet: window is projected from the raid candle", () => {
    const w = candle3Window(candles, { time: t0 + 3 * H4, closed: true }, "4h")!;
    expect(w.start).toBe(t0 + 4 * H4);
    expect(w.end).toBe(t0 + 5 * H4);
  });

  it("weekly: a Monday-session 4H candle opening Sunday 21:00 UTC is inside that week's C3", () => {
    const mon = (d: number) => Date.UTC(2026, 8, d);
    const weeks = [bar(mon(14)), bar(mon(21)), bar(mon(28))];
    const w = candle3Window(weeks, { time: mon(21), closed: true }, "1w")!;
    expect(w.start).toBe(mon(28));
    expect(inCandle3(w, Date.UTC(2026, 8, 27, 21))).toBe("inside"); // Sun 17:00 NY = new week's first 4H
    expect(inCandle3(w, Date.UTC(2026, 8, 25, 17))).toBe("before"); // Friday of C2's week
  });
});

describe("Power of 3: the C3 entry should come early in the candle", () => {
  it("measures how far into Candle 3 a fill sits (>0.5 = late, warning)", () => {
    const t0 = Date.UTC(2026, 9, 1, 1);
    const w = candle3Window([bar(t0), bar(t0 + H4), bar(t0 + 2 * H4)], { time: t0 + H4, closed: true }, "4h")!;
    expect(candle3Progress(w, t0 + 2 * H4)).toBe(0);
    expect(candle3Progress(w, t0 + 2 * H4 + H4 / 4)).toBe(0.25);
    expect(candle3Progress(w, t0 + 2 * H4 + (3 * H4) / 4)).toBeGreaterThan(0.5);
  });
});
