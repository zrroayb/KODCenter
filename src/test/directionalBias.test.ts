import { describe, expect, it } from "vitest";
import type { Displacement, LiquidityObjective, MarketStructureShift, Sweep } from "../lib/ict/types";
import { evaluateDirectionalBias } from "../lib/strategies/crt/directionalBias";

const buyDrawAbove: LiquidityObjective = { id: "PWH", kind: "PWH", side: "buy-side", level: 110, label: "PWH", timeframe: "1w", source: "t", strength: "strong" };
const sellDrawBelow: LiquidityObjective = { id: "PWL", kind: "PWL", side: "sell-side", level: 90, label: "PWL", timeframe: "1w", source: "t", strength: "strong" };
const sellReclaimed: Sweep = { side: "sell-side", level: 98, candleIndex: 40, reclaimed: true };
const buyReclaimed: Sweep = { side: "buy-side", level: 102, candleIndex: 40, reclaimed: true };
const upDisp: Displacement = { direction: "long", candleIndex: 41, bodyRatio: 0.8, rangeAtr: 1.5 };
const downDisp: Displacement = { direction: "short", candleIndex: 41, bodyRatio: 0.8, rangeAtr: 1.5 };
const upMss: MarketStructureShift = { direction: "long", level: 100, candleIndex: 42, kind: "mss" };

describe("two-sided directional bias", () => {
  it("scores a clean bullish stack as bullish with a buy-side draw", () => {
    const bias = evaluateDirectionalBias({
      price: 100,
      htfBias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish" },
      pdZone: "discount",
      liquidityObjectives: [buyDrawAbove, sellDrawBelow],
      sweeps: [sellReclaimed],
      displacements: [upDisp],
      marketStructureShifts: [upMss],
      inKillzone: true
    });

    expect(bias.direction).toBe("bullish");
    expect(bias.bullishScore).toBeGreaterThanOrEqual(65);
    expect(bias.bullishScore - bias.bearishScore).toBeGreaterThanOrEqual(15);
    expect(bias.externalDraw?.side).toBe("buy-side");
    expect(bias.confidence).toBeGreaterThan(0);
  });

  it("scores the mirror bearish stack as bearish", () => {
    const bias = evaluateDirectionalBias({
      price: 100,
      htfBias: { monthly: "bearish", weekly: "bearish", daily: "bearish", h4: "bearish" },
      pdZone: "premium",
      liquidityObjectives: [buyDrawAbove, sellDrawBelow],
      sweeps: [buyReclaimed],
      displacements: [downDisp],
      marketStructureShifts: [{ direction: "short", level: 100, candleIndex: 42, kind: "mss" }],
      inKillzone: true
    });

    expect(bias.direction).toBe("bearish");
    expect(bias.externalDraw?.side).toBe("sell-side");
  });

  it("returns neutral when the two sides conflict (no dominant lean)", () => {
    const bias = evaluateDirectionalBias({
      price: 100,
      htfBias: { monthly: "bullish", weekly: "bearish", daily: "bullish", h4: "bearish" },
      pdZone: "equilibrium",
      liquidityObjectives: [buyDrawAbove, sellDrawBelow],
      sweeps: [],
      displacements: [],
      marketStructureShifts: [],
      inKillzone: false
    });

    expect(bias.direction).toBe("neutral");
    expect(bias.confidence).toBe(0);
  });

  it("does not let premium/discount alone force a direction (Master §3.3)", () => {
    const bias = evaluateDirectionalBias({
      price: 100,
      htfBias: { monthly: "neutral", weekly: "neutral", daily: "neutral", h4: "neutral" },
      pdZone: "discount",
      liquidityObjectives: [],
      sweeps: [],
      displacements: [],
      marketStructureShifts: [],
      inKillzone: false
    });

    expect(bias.direction).toBe("neutral");
    expect(bias.bullishScore).toBeLessThan(65);
  });
});
