import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { buildMarketContext } from "../lib/intelligence/marketContext";
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
});
