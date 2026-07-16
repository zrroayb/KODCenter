import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { executableClose, executableHigh, executableLow } from "../lib/data/bidAsk";

function candle(overrides: Partial<Candle> = {}): Candle {
  return { time: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 1, closed: true, ...overrides };
}

describe("executable price NaN guards", () => {
  it("falls back to the mid price when synthetic quotes are NaN (NaN is not nullish)", () => {
    // Seen live: a forming Yahoo candle produced NaN synthetic quotes; `NaN ?? fallback` keeps
    // the NaN and one poisoned candle turned every replay R into NaN.
    const poisoned = candle({
      ask: { open: NaN, high: NaN, low: NaN, close: NaN },
      bid: { open: NaN, high: NaN, low: NaN, close: NaN }
    });

    expect(executableHigh(poisoned, "buy")).toBe(101);
    expect(executableLow(poisoned, "buy")).toBe(99);
    expect(executableClose(poisoned, "sell")).toBe(100.5);
  });

  it("still prefers finite synthetic quotes when they exist", () => {
    const quoted = candle({
      ask: { open: 100.01, high: 101.01, low: 99.01, close: 100.51 },
      bid: { open: 99.99, high: 100.99, low: 98.99, close: 100.49 }
    });

    expect(executableHigh(quoted, "buy")).toBe(101.01);
    expect(executableLow(quoted, "sell")).toBe(98.99);
    expect(executableClose(quoted, "buy")).toBe(100.51);
  });

  it("handles missing quote objects like before", () => {
    expect(executableHigh(candle(), "buy")).toBe(101);
    expect(executableClose(candle(), "sell")).toBe(100.5);
  });
});
