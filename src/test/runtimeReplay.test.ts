import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import type { RuntimeReplayTrade } from "../lib/analytics/performance";
import { __runtimeReplayInternals, runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import type { TradingSignal } from "../lib/ict/types";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("monthly runtime replay", () => {
  it("does not expose a higher-timeframe candle before that candle closes", () => {
    const market = createDemoMarkets()[0];
    const latestH4 = market.timeframes.h4.at(-1)!;
    const sliced = __runtimeReplayInternals.timeframesAt(market, latestH4.time + 60 * 60 * 1000);

    expect(sliced.h4.some((candle) => candle.time === latestH4.time)).toBe(false);
  });

  it("rejects a READY plan whose stop is on the profit side", () => {
    const baseSignal = kodStrategy.scan({
      context: createStructureContext(),
      settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
    }).signals[0];
    const invalid = {
      ...baseSignal,
      direction: "long" as const,
      stage: "ready" as const,
      plan: {
        ...baseSignal.plan,
        entry: 100,
        stopLoss: 101,
        targets: [102, 103],
        riskDistance: 1,
        rr: 3
      }
    } as TradingSignal;

    expect(__runtimeReplayInternals.replayPlanGeometryValid(invalid)).toBe(false);
  });

  it("does not calibrate rules from a tiny sample and labels a mapped POI correctly", () => {
    const trade = (index: number): RuntimeReplayTrade => ({
      id: `trade-${index}`,
      status: "tp1",
      rMultiple: 0.5,
      tags: ["poi:mapped"],
      origin: "live-ready",
      outcomeReason: "clean-model"
    } as RuntimeReplayTrade);

    expect(__runtimeReplayInternals.calibrationFromTrades(Array.from({ length: 9 }, (_, index) => trade(index)), 0)).toEqual([
      expect.objectContaining({ label: "Örneklem", value: "9/20", verdict: "investigate" })
    ]);

    const calibrated = __runtimeReplayInternals.calibrationFromTrades(Array.from({ length: 20 }, (_, index) => trade(index)), 0);
    expect(calibrated).toContainEqual(expect.objectContaining({ label: "POI var", verdict: "keep" }));
    expect(calibrated.some((item) => item.label.includes("missing"))).toBe(false);
  });

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
    expect(result.replay?.bySymbol.length).toBeLessThanOrEqual(12);
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
  }, 30_000);

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
    const candles = [
      { time: 1, open: 100, high: 101.2, low: 100, close: 101, volume: 1000 },
      { time: 2, open: 101, high: 101.1, low: 99.95, close: 100.1, volume: 1000 }
    ];
    // Primary model (owner decision 2026-07-16): full close at EQ — the walk pays the full 1R.
    const outcome = __runtimeReplayInternals.evaluateForwardOutcome(signal, candles);

    expect(outcome.status).toBe("tp1");
    expect(outcome.outcomeReason).toBe("eq-full");
    expect(outcome.rMultiple).toBe(1);
    expect(outcome.tags).toContain("crt:eq");
    expect(outcome.tags).toContain("crt:eq-full");
    // Counterfactuals from the same walk: the old EQ-partial+BE model banks 0.5R (half at EQ,
    // remainder scratched at BE on the pullback), no-BE holds the half for 0.5R, and the
    // no-partial full-DOL position scratches at BE (0R).
    expect(outcome.managementVariants).toEqual({ noBe: 0.5, fullDol: 0, eqPartialBe: 0.5 });

    // Legacy model still available behind the setting and still measures the old way.
    const legacy = __runtimeReplayInternals.evaluateForwardOutcome(signal, candles, [], { exitModel: "eq-partial-be" });
    expect(legacy.status).toBe("tp1");
    expect(legacy.outcomeReason).toBe("eq-then-be");
    expect(legacy.rMultiple).toBe(0.5);
  });

  it("marks an expired open trade at the final close instead of its MFE", () => {
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
        targets: [102.5, 103],
        riskDistance: 1,
        entryStatus: "confirmed" as const,
        entrySource: "choch-close" as const,
        targetSource: "crt-dol" as const,
        executionCosts: { ...baseSignal.plan.executionCosts, total: 0, stress: "off" as const }
      }
    };
    const outcome = __runtimeReplayInternals.evaluateForwardOutcome(signal, [
      { time: 1, open: 100, high: 102, low: 100, close: 101.8, volume: 1000 },
      { time: 2, open: 101.8, high: 101.9, low: 99.4, close: 99.5, volume: 1000 }
    ], [], { partialTpEnabled: false, moveToBreakevenAtR: 0 });

    expect(outcome.status).toBe("open");
    expect(outcome.maxFavorableR).toBeGreaterThan(1);
    expect(outcome.rMultiple).toBeCloseTo(-0.5, 2);
  });

  it("honors partial-profit and break-even replay settings", () => {
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
    const candles = [
      { time: 1, open: 100, high: 101.2, low: 100, close: 101, volume: 1000 },
      { time: 2, open: 101, high: 101.1, low: 99.95, close: 100.1, volume: 1000 }
    ];
    const managed = __runtimeReplayInternals.evaluateForwardOutcome(signal, candles, [], { exitModel: "eq-partial-be", partialTpEnabled: true, moveToBreakevenAtR: 1 });
    const unmanaged = __runtimeReplayInternals.evaluateForwardOutcome(signal, candles, [], { exitModel: "eq-partial-be", partialTpEnabled: false, moveToBreakevenAtR: 0 });

    expect(managed.status).toBe("tp1");
    expect(managed.rMultiple).toBe(0.5);
    expect(unmanaged.status).toBe("open");
    expect(unmanaged.rMultiple).toBeCloseTo(0.1, 2);
  });

  it("reports management scenarios comparing the model against its counterfactuals", () => {
    const result = runMonthlyRuntimeReplay({
      markets: createDemoMarkets(),
      strategy: crtStrategy,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false },
      windowDays: 3,
      maxHoldCandles: 24,
      scanEveryCandles: 12
    });

    const scenarios = result.replay?.managementScenarios ?? [];
    expect(scenarios.map((item) => item.id)).toEqual(["model", "eq-partial-be", "no-be", "full-dol"]);
    const model = scenarios.find((item) => item.id === "model");
    expect(model?.deltaR).toBe(0);
    for (const scenario of scenarios) {
      expect(scenario.trades).toBe(model?.trades);
    }
  }, 10_000);
});
