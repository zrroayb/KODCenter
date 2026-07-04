import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { __runtimeReplayInternals, runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("monthly runtime replay", () => {
  it("walks historical candles and records replay diagnostics without faking READY trades", () => {
    const result = runMonthlyRuntimeReplay({
      markets: createDemoMarkets(),
      strategy: crtStrategy,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false },
      windowDays: 3,
      maxHoldCandles: 24,
      scanEveryCandles: 12
    });

    expect(result.replay).toBeDefined();
    expect(result.replay?.scannedWindows).toBeGreaterThan(0);
    expect((result.replay?.readyAlerts ?? 0) + (result.replay?.watchAlerts ?? 0)).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.replay?.bySymbol.length).toBeGreaterThan(0);
    expect(result.replay?.bySymbol.length).toBeLessThanOrEqual(5);
    expect(result.replay?.candidates.length).toBeGreaterThan(0);
    expect(result.replay?.calibration.length).toBeGreaterThan(0);
    expect(result.replay?.filterScenarios.length).toBeGreaterThan(0);
    expect(result.replay?.filterScenarios.map((item) => item.id)).toContain("strict-core");
    expect(result.replay?.failureReasons).toBeDefined();
    expect(result.replay?.watchReasonSummary).toBeDefined();
    expect(result.replay?.setupBreakdowns).toBeDefined();
    expect(result.replay?.failureCases).toBeDefined();
    expect(result.replay?.replayDiagnosis.length).toBeGreaterThan(0);
    expect((result.replay?.liveReadyEntries ?? 0) + (result.replay?.watchPromotedEntries ?? 0)).toBe(result.replay?.readyAlerts);
    expect(result.replay?.bySymbol.some((row) => row.watchAlerts + row.readyAlerts > 0)).toBe(true);
    expect(result.replay?.candidates[0].decision).toBeTruthy();
    if ((result.replay?.trades.length ?? 0) > 0) {
      expect(result.replay?.trades[0].outcomeReason).toBeTruthy();
      expect(result.replay?.trades[0].origin).toBeTruthy();
      expect(result.replay?.trades[0].entrySource).toBeTruthy();
      expect(result.replay?.trades[0].tags.length).toBeGreaterThan(0);
    }
  });

  it("scores CRT EQ management as partial profit plus breakeven instead of fake full TP", () => {
    const baseContext = createStructureContext();
    const baseSignal = kodStrategy.scan({
      context: baseContext,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
    }).signals[0];
    const signal = {
      ...baseSignal,
      strategyId: "crt",
      direction: "long" as const,
      plan: {
        ...baseSignal.plan,
        entry: 100,
        stopLoss: 99,
        targets: [101, 103],
        riskDistance: 1,
        entryStatus: "confirmed" as const,
        entrySource: "choch-close" as const,
        targetSource: "crt-dol" as const
      }
    };
    const outcome = __runtimeReplayInternals.evaluateForwardOutcome(signal, [
      { time: 1, open: 100, high: 101.2, low: 100, close: 101, volume: 1000 },
      { time: 2, open: 101, high: 101.1, low: 99.95, close: 100.1, volume: 1000 }
    ]);

    expect(outcome.status).toBe("tp1");
    expect(outcome.outcomeReason).toBe("eq-then-be");
    expect(outcome.rMultiple).toBe(0.5);
    expect(outcome.tags).toContain("crt:eq");
    expect(outcome.tags).toContain("crt:be");
  });
});
