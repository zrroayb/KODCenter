import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { buildLiquidityPools, detectSweeps } from "../lib/intelligence/liquidityMapEngine";
import { buildStructureRiskPlan, kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { getStrategy, strategyRegistry } from "../lib/strategies/registry";
import { createStructureContext } from "./strategyFixtures";

describe("KOD strategy module", () => {
  it("is the first registered strategy and can be resolved by id", () => {
    expect(strategyRegistry[0].id).toBe("kod-turtle-soup-reclaim");
    expect(getStrategy("missing-strategy").id).toBe(kodStrategy.id);
  });

  it("emits visible watch or ready signals with decision summaries", () => {
    const context = createDemoContexts()[0];
    const result = kodStrategy.scan({ context, settings: kodStrategy.defaultSettings });
    const signal = result.signals[0];

    expect(signal).toBeDefined();
    expect(["watch", "ready", "invalidated", "missed"]).toContain(signal.stage);
    expect(signal.plan.rr).toBeGreaterThan(0);
    expect(signal.decisionSummary.shortSummary).toContain(context.symbol);
    expect(signal.decisionSummary.checklist.map((item) => item.label)).toContain("Liquidity Sweep");
    expect(signal.decisionSummary.invalidation[0]).toContain("invalid olur");
  });

  it("places short stops above buy-side sweep structure plus buffer", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });

    const plan = buildStructureRiskPlan(context, "short", 1.5);

    expect(plan.stopSource).toBe("sweep");
    expect(plan.stopBuffer).toBeCloseTo(0.8, 5);
    expect(plan.stopLoss).toBeCloseTo(101.8, 5);
    expect(plan.riskDistance).toBeCloseTo(1.8, 5);
  });

  it("places long stops below sell-side sweep structure plus buffer", () => {
    const context = createStructureContext({
      bias: { daily: "bullish", h4: "bullish", h1: "bullish" },
      premiumDiscount: { zone: "discount", positionPct: 0.25, midpoint: 100 },
      sweeps: [{ side: "sell-side", level: 99, candleIndex: 23, reclaimed: true }],
      fairValueGaps: [{ direction: "long", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });

    const plan = buildStructureRiskPlan(context, "long", 1.5);

    expect(plan.stopSource).toBe("sweep");
    expect(plan.stopBuffer).toBeCloseTo(0.8, 5);
    expect(plan.stopLoss).toBeCloseTo(98.2, 5);
    expect(plan.riskDistance).toBeCloseTo(1.8, 5);
  });

  it("falls back to volatility floor when structure stop is too tight", () => {
    const context = createStructureContext();

    const plan = buildStructureRiskPlan(context, "short", 1.5);

    expect(plan.stopSource).toBe("volatility-floor");
    expect(plan.stopLoss).toBeCloseTo(101.6, 5);
    expect(plan.planWarnings.join(" ")).toContain("volatility floor");
  });

  it("changes structure stop distance by selected stop profile and emits replay evidence", () => {
    const context = createStructureContext({
      volatility: { atr: 10, averageRange: 10 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });

    const aggressive = buildStructureRiskPlan(context, "short", 0.1, "aggressive");
    const conservative = buildStructureRiskPlan(context, "short", 0.1, "conservative");
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, stopProfile: "conservative" } }).signals[0];

    expect(conservative.stopLoss).toBeGreaterThan(aggressive.stopLoss);
    expect(signal.evidence.map((item) => item.id)).toContain("risk-policy");
    expect(signal.evidence.map((item) => item.id)).toContain("lifecycle");
    expect(signal.evidence.map((item) => item.id)).toContain("ict-sequence");
    expect(signal.evidence.map((item) => item.id)).toContain("order-block");
    expect(signal.evidence.map((item) => item.id)).toContain("retracement");
  });

  it("keeps the real sweep candle index when a previous candle raided liquidity", () => {
    const candles = Array.from({ length: 12 }, (_, index) => ({
      time: Date.UTC(2026, 5, 30, 12, index * 15),
      open: 100,
      high: index === 9 ? 103 : 101,
      low: 99,
      close: index === 11 ? 100.5 : 100,
      volume: 1000
    }));
    const pools = [{ id: "bsl", side: "buy-side" as const, level: 102, label: "BSL", strength: "strong" as const }];
    const sweeps = detectSweeps(candles, pools);

    expect(buildLiquidityPools(candles).length).toBeGreaterThan(0);
    expect(sweeps[0].candleIndex).toBe(9);
    expect(sweeps[0].reclaimed).toBe(true);
  });

  it("dedupes repeated sweep pools around the same level", () => {
    const candles = Array.from({ length: 12 }, (_, index) => ({
      time: Date.UTC(2026, 5, 30, 12, index * 15),
      open: 100,
      high: index === 9 ? 103 : 101,
      low: 99,
      close: index === 11 ? 100.5 : 100,
      volume: 1000
    }));
    const sweeps = detectSweeps(candles, [
      { id: "bsl-1", side: "buy-side", level: 102, label: "BSL 1", strength: "strong" },
      { id: "bsl-2", side: "buy-side", level: 102.0005, label: "BSL duplicate", strength: "strong" }
    ]);

    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].side).toBe("buy-side");
  });

  it("selects long when long structure is cleaner even if a buy-side sweep also exists", () => {
    const context = createStructureContext({
      bias: { daily: "bullish", h4: "bullish", h1: "bullish" },
      premiumDiscount: { zone: "discount", positionPct: 0.25, midpoint: 100 },
      dealingRange: { high: 105, low: 97, midpoint: 101, source: "Long selection fixture" },
      liquidityPools: [
        { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
        { id: "sell-side", side: "sell-side", level: 97, label: "Sell-side", strength: "strong" }
      ],
      sweeps: [
        { side: "buy-side", level: 101, candleIndex: 23, reclaimed: true },
        { side: "sell-side", level: 99, candleIndex: 23, reclaimed: true }
      ],
      displacements: [{ direction: "long", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1.2 }],
      marketStructureShifts: [{ direction: "long", level: 100.2, candleIndex: 23, kind: "choch" }],
      fairValueGaps: [{ direction: "long", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });

    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false } }).signals[0];

    expect(signal.direction).toBe("long");
    expect(signal.evidence[0].id).toBe("direction-selection");
    expect(signal.evidence[0].detail).toContain("LONG");
    expect(signal.evidence[0].detail).toContain("SHORT");
  });

  it("keeps a setup on watch when the only FVG is stale and outside the ICT sequence", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1.2 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 8, mitigated: false }]
    });

    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false } }).signals[0];

    expect(signal.stage).toBe("watch");
    expect(signal.evidence.find((item) => item.id === "ict-sequence")?.detail).toContain("setup sırasına");
    expect(signal.plan.planWarnings.join(" ")).toContain("setup sırasına");
  });

  it("downgrades to watch when the real structure stop breaks minimum RR", () => {
    const context = createStructureContext({
      dealingRange: { high: 102, low: 99, midpoint: 100.5, source: "Near target range" },
      liquidityPools: [
        { id: "buy-side", side: "buy-side", level: 102, label: "Buy-side", strength: "strong" },
        { id: "sell-side", side: "sell-side", level: 99, label: "Sell-side", strength: "strong" }
      ],
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });

    const strict = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5 } }).signals[0];
    const relaxed = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(strict.stage).toBe("watch");
    expect(strict.plan.planWarnings.join(" ")).toContain("READY değil");
    expect(relaxed.stage).toBe("ready");
  });

  it("downgrades to watch when spread and slippage break the otherwise valid RR", () => {
    const context = createStructureContext({
      dealingRange: { high: 105, low: 97, midpoint: 101, source: "Friction sensitive range" },
      liquidityPools: [
        { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
        { id: "sell-side", side: "sell-side", level: 97, label: "Sell-side", strength: "strong" }
      ],
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });

    const stressed = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, slippageStress: "high" }
    }).signals[0];
    const noFriction = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    }).signals[0];

    expect(stressed.plan.grossRR).toBeGreaterThan(1.5);
    expect(stressed.plan.rr).toBeLessThan(1.5);
    expect(stressed.stage).toBe("watch");
    expect(stressed.plan.planWarnings.join(" ")).toContain("Friction");
    expect(stressed.evidence.map((item) => item.id)).toContain("execution-cost");
    expect(noFriction.stage).toBe("ready");
  });

  it("marks a ready-looking setup missed when price has already run away from entry", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1
        ? { ...candle, open: 99.6, high: 100.5, low: 98.8, close: 98.9 }
        : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 22, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 22, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 22 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });

    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signal.stage).toBe("missed");
    expect(signal.plan.planWarnings.join(" ")).toContain("Entry kaçtı");
  });

  it("marks a setup invalidated when price has already touched the stop after setup", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1 ? { ...candle, high: 102.2, close: 100 } : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 22, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 22, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 22 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });

    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signal.stage).toBe("invalidated");
    expect(signal.plan.planWarnings.join(" ")).toContain("stop/invalidation");
  });
});
