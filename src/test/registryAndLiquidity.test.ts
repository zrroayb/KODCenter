import { describe, expect, it } from "vitest";
import { buildLiquidityPools, detectSweeps } from "../lib/intelligence/liquidityMapEngine";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { getStrategy, strategyRegistry } from "../lib/strategies/registry";

describe("strategy registry", () => {
  it("registers only the CRT playbook and falls back to it for unknown ids", () => {
    expect(strategyRegistry.map((strategy) => strategy.id)).toEqual(["crt"]);
    expect(getStrategy("missing-strategy").id).toBe(crtStrategy.id);
    expect(getStrategy("kod").id).toBe(crtStrategy.id);
  });
});

describe("liquidity map", () => {
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
});
