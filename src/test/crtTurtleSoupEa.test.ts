import { describe, expect, it } from "vitest";
import type { Candle, MarketContext } from "../lib/ict/types";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { detectLatestTurtleSoup } from "../lib/strategies/crt/turtleSoup";
import { createStructureContext } from "./strategyFixtures";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1000 };
}

function flatCandles(count: number, start: number, stepMs: number, price: number, span: number): Candle[] {
  return Array.from({ length: count }, (_, index) => candle(
    start + index * stepMs,
    price,
    price + span,
    price - span,
    price
  ));
}

describe("CRT Turtle Soup EA port", () => {
  it("detects the closed 3-candle bullish Turtle Soup model from the MT5 EA", () => {
    const start = Date.UTC(2026, 6, 1, 9, 0);
    const candles = [
      candle(start, 100, 101, 95, 96),
      candle(start + 15 * 60 * 1000, 95, 97, 94.2, 95.2)
    ];

    const pattern = detectLatestTurtleSoup(candles, "15m");

    expect(pattern?.direction).toBe("long");
    expect(pattern?.rangeLow).toBe(95);
    expect(pattern?.sweepLevel).toBe(94.2);
    expect(pattern?.tp1).toBe(98);
    expect(pattern?.tp2).toBe(101);
    expect(pattern?.wickRatio).toBeGreaterThanOrEqual(3);
  });

  it("rejects a Turtle Soup candle that pushes beyond the 50% range filter", () => {
    const start = Date.UTC(2026, 6, 1, 9, 0);
    const candles = [
      candle(start, 100, 105, 99, 104),
      candle(start + 15 * 60 * 1000, 105.1, 106.4, 101, 104.8)
    ];

    expect(detectLatestTurtleSoup(candles, "15m")).toBeUndefined();
  });

  it("builds READY from TS entry, wick stop, range midpoint and opposite range target", () => {
    const start = Date.UTC(2026, 6, 1, 9, 0);
    const m15 = [
      ...flatCandles(28, start, 15 * 60 * 1000, 96, 0.45),
      candle(start + 28 * 15 * 60 * 1000, 100, 101, 95, 96),
      candle(start + 29 * 15 * 60 * 1000, 95, 97, 94.2, 95.2)
    ];
    const h4 = flatCandles(24, start - 23 * 4 * 60 * 60 * 1000, 4 * 60 * 60 * 1000, 100, 5);
    const context: MarketContext = createStructureContext({
      symbol: "XAUUSD",
      timeframes: {
        monthly: h4,
        weekly: h4,
        daily: h4,
        h4,
        h1: m15,
        m15,
        m5: m15
      },
      bias: {
        monthly: "bullish",
        weekly: "bullish",
        daily: "bullish",
        h4: "bullish",
        h1: "bullish"
      },
      premiumDiscount: {
        zone: "discount",
        positionPct: 0.2,
        midpoint: 100
      },
      liquidityObjectives: [
        { id: "PDL", kind: "PDL", side: "sell-side", level: 94.2, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" },
        { id: "PDH", kind: "PDH", side: "buy-side", level: 101, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" }
      ]
    });

    const signal = crtStrategy.scan({
      context,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 0.5, useExecutionCosts: false }
    }).signals[0];

    expect(signal.stage).toBe("ready");
    expect(signal.direction).toBe("long");
    expect(signal.plan.entrySource).toBe("turtle-soup-open");
    expect(signal.plan.entry).toBe(95.2);
    expect(signal.plan.stopLoss).toBeCloseTo(93.4, 5);
    expect(signal.plan.targets).toEqual([98, 101]);
    expect(signal.evidence.find((item) => item.id === "turtle-soup")?.status).toBe("pass");
  });
});
