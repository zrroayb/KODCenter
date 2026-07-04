import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";

describe("monthly runtime replay", () => {
  it("walks historical candles and records replay diagnostics", () => {
    const result = runMonthlyRuntimeReplay({
      markets: createDemoMarkets(),
      strategy: kodStrategy,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false },
      windowDays: 3,
      maxHoldCandles: 24,
      scanEveryCandles: 12
    });

    expect(result.replay).toBeDefined();
    expect(result.replay?.scannedWindows).toBeGreaterThan(0);
    expect((result.replay?.readyAlerts ?? 0) + (result.replay?.watchAlerts ?? 0)).toBeGreaterThan(0);
    expect(result.replay?.readyAlerts).toBeGreaterThan(0);
    expect(result.replay?.trades.length).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.replay?.bySymbol.length).toBeGreaterThan(0);
    expect(result.replay?.bySymbol.length).toBeLessThanOrEqual(5);
    expect(result.replay?.candidates.length).toBeGreaterThan(0);
    expect(result.replay?.calibration.length).toBeGreaterThan(0);
    expect(result.replay?.failureReasons).toBeDefined();
    expect(result.replay?.watchReasonSummary).toBeDefined();
    expect(result.replay?.bySymbol.some((row) => row.watchAlerts + row.readyAlerts > 0)).toBe(true);
    expect(result.replay?.candidates[0].decision).toBeTruthy();
    expect(result.replay?.trades[0].outcomeReason).toBeTruthy();
    expect(result.replay?.trades[0].tags.length).toBeGreaterThan(0);
  });
});
