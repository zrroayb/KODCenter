import { describe, expect, it } from "vitest";
import { activeCrtRange, breakLevelText, chartBreakLevel, crtPhaseText, signalCrtRange } from "../lib/charts/crtRange";

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

  it("a selected signal's own range starts at its Candle 1 and takes the engine's phase", () => {
    const candles = [bar(1, 12, 20, 10, 18), bar(2, 18, 19, 8, 15), bar(3, 15, 16, 14, 15, false)];
    const live = signalCrtRange(candles, { rangeHigh: 20, rangeLow: 10, raidActive: true, raidClosed: false }, "long");
    expect(live).toMatchObject({ high: 20, low: 10, eq: 15, time: 1, phase: "c2", sweptSide: "low" });
    expect(crtPhaseText(live!, "4H")).toContain("C2'nin range içinde kapanması bekleniyor");
    const closed = signalCrtRange(candles, { rangeHigh: 20, rangeLow: 10, raidActive: true, raidClosed: true }, "long");
    expect(closed?.phase).toBe("c3");
  });
});

describe("chart shows the break the setup waits for (ChoCH / True MSS close)", () => {
  it("every CRT signal carries a break level: pending = close requirement, confirmed = done", async () => {
    const { createDemoMarkets } = await import("../data/demoData");
    const { buildMarketContext } = await import("../lib/intelligence/marketContext");
    const { crtStrategy } = await import("../lib/strategies/crt/crt.strategy");
    const { closeConfirmationRequirement } = await import("../lib/signals/waitingGuidance");
    const signals = createDemoMarkets().flatMap((market) => crtStrategy.scan({
      context: buildMarketContext(market.symbol, market.timeframes),
      settings: { ...crtStrategy.defaultSettings }
    }).signals);
    let checked = 0;
    for (const signal of signals) {
      const level = chartBreakLevel(signal);
      const pending = closeConfirmationRequirement(signal);
      if (pending) {
        expect(level).toMatchObject({ level: pending.level, side: pending.side, done: false });
        expect(breakLevelText(level!, String)).toContain("KAPANMALI");
        checked += 1;
      } else if (level) {
        expect(level.done).toBe(true);
        expect(level.side).toBe(signal.direction === "long" ? "above" : "below");
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
