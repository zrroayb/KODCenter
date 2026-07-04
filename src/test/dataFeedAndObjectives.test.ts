import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { buildStructureRiskPlan, kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("bid/ask data layer and liquidity objectives", () => {
  it("enriches market candles with executable bid/ask and previous period objectives", () => {
    const market = createDemoMarkets()[0];
    const candle = market.timeframes.m15[market.timeframes.m15.length - 1];
    const context = buildMarketContext(market.symbol, market.timeframes);

    expect(candle?.bid?.close).toBeLessThan(candle?.close ?? 0);
    expect(candle?.ask?.close).toBeGreaterThan(candle?.close ?? Number.POSITIVE_INFINITY);
    expect(context.dataFeed.executionPrice).toBe("bid-ask");
    expect(context.liquidityObjectives.map((objective) => objective.kind)).toEqual(
      expect.arrayContaining(["PDH", "PDL", "PWH", "PWL", "PMH", "PML"])
    );
    expect(context.swingPoints).toBeDefined();
    expect(context.orderBlocks).toBeDefined();
    expect(context.retracement.summary).toBeTruthy();
  });

  it("uses mapped liquidity objectives as real TP candidates", () => {
    const context = createStructureContext({
      liquidityPools: [],
      liquidityObjectives: [
        { id: "PWH", kind: "PWH", side: "buy-side", level: 104, label: "PWH", timeframe: "1w", source: "fixture", strength: "strong" },
        { id: "PWL", kind: "PWL", side: "sell-side", level: 97, label: "PWL", timeframe: "1w", source: "fixture", strength: "strong" }
      ],
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });

    const plan = buildStructureRiskPlan(context, "short", 0.1, "normal", "off");

    expect(plan.targetSource).toBe("liquidity");
    expect(plan.targets[0]).toBe(97);
  });

  it("keeps a setup on watch until FVG/iFVG retest and MSS/CISD are confirmed", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });

    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signal.stage).toBe("watch");
    expect(signal.plan.entryStatus).toBe("pending");
    expect(signal.evidence.map((item) => item.id)).toContain("entry-model");
  });
});
