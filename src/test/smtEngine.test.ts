import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { createStructureContext } from "./strategyFixtures";

function candlesWithLatest(indexPatch: Partial<Candle>): Candle[] {
  const now = Date.UTC(2026, 5, 30, 12, 0);
  return Array.from({ length: 24 }, (_, index) => {
    const base: Candle = {
      time: now + index * 15 * 60 * 1000,
      open: 100,
      high: 100.4,
      low: 99.6,
      close: 100,
      volume: 1000 + index
    };
    return index === 23 ? { ...base, ...indexPatch } : base;
  });
}

describe("SMT engine", () => {
  it("detects bearish SMT when one FX pair sweeps buy-side and the partner does not confirm", () => {
    const eurCandles = candlesWithLatest({ high: 101.2, close: 100.2 });
    const gbpCandles = candlesWithLatest({ high: 100.35, close: 100.1 });
    const contexts = attachSmtDivergences([
      createStructureContext({ symbol: "EURUSD", timeframes: { daily: eurCandles, h4: eurCandles, h1: eurCandles, m15: eurCandles, m5: eurCandles } }),
      createStructureContext({ symbol: "GBPUSD", timeframes: { daily: gbpCandles, h4: gbpCandles, h1: gbpCandles, m15: gbpCandles, m5: gbpCandles } })
    ]);

    expect(contexts[0].smtDivergences[0]).toMatchObject({
      partner: "GBPUSD",
      direction: "short",
      side: "buy-side"
    });
  });

  it("detects bullish SMT when one FX pair sweeps sell-side and the partner does not confirm", () => {
    const eurCandles = candlesWithLatest({ low: 98.8, close: 99.9 });
    const gbpCandles = candlesWithLatest({ low: 99.65, close: 100 });
    const contexts = attachSmtDivergences([
      createStructureContext({ symbol: "EURUSD", timeframes: { daily: eurCandles, h4: eurCandles, h1: eurCandles, m15: eurCandles, m5: eurCandles } }),
      createStructureContext({ symbol: "GBPUSD", timeframes: { daily: gbpCandles, h4: gbpCandles, h1: gbpCandles, m15: gbpCandles, m5: gbpCandles } })
    ]);

    expect(contexts[0].smtDivergences[0]).toMatchObject({
      partner: "GBPUSD",
      direction: "long",
      side: "sell-side"
    });
  });
});
