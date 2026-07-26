import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import type { RuntimeReplayTrade } from "../lib/analytics/performance";
import { __runtimeReplayInternals, runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import type { TradingSignal } from "../lib/ict/types";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { trendContinuationStrategy } from "../lib/strategies/trendContinuation/trendContinuation.strategy";
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
      expect(result.replay?.trades[0].eqRR).toBeGreaterThanOrEqual(0);
    }
    const review = result.replay?.reviewMeasurements;
    expect(review).toBeDefined();
    expect(review!.eqRr.sample).toBe(result.replay?.triggeredTrades);
    expect(review!.gradeBuckets.reduce((sum, bucket) => sum + bucket.trades, 0)).toBe(result.replay?.triggeredTrades);
    expect(review!.killzoneBuckets.reduce((sum, bucket) => sum + bucket.trades, 0)).toBe(result.replay?.triggeredTrades);
    // Dolmayan girişlerin karşı-olgu ölçümü iç tutarlı olmalı.
    expect(review!.unfilled.count).toBe(result.replay?.notTriggered);
    expect(review!.unfilled.withCounterfactual).toBeLessThanOrEqual(review!.unfilled.count);
    expect(review!.unfilled.cfWins).toBeLessThanOrEqual(review!.unfilled.withCounterfactual);
    // EQ-RR tabanı bir senaryo olarak ölçülür; işlem seçimine karışmaz.
    expect(result.replay?.filterScenarios.map((item) => item.id)).toContain("eq-rr-floor");
    // anchor:1h tag'i yalnız tracking gölge hattına aittir; headline işlemleri (live default'ta
    // 1H dahil) bu tag'i asla taşımaz. Tracking scenario satırı her zaman raporlanır.
    expect(result.replay?.trackingScenarios?.[0]?.id).toBe("anchor-1h-tracking");
    expect(result.replay?.trades.every((trade) => !trade.tags.includes("anchor:1h"))).toBe(true);
    expect((result.replay?.trackingTrades ?? []).every((trade) => trade.tags.includes("anchor:1h"))).toBe(true);
  }, 30_000);

  it("measures the Trend Continuation playbook through the same replay pipeline (single-target model)", () => {
    const result = runMonthlyRuntimeReplay({
      markets: createDemoMarkets(),
      strategy: trendContinuationStrategy,
      settings: { ...trendContinuationStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false },
      windowDays: 10,
      maxHoldCandles: 48,
      scanEveryCandles: 6
    });

    expect(result.replay).toBeDefined();
    expect(result.replay?.scannedWindows).toBeGreaterThan(0);
    // Continuation gerçekten ölçülebiliyor: en az bir tetiklenmiş trade + eşitlik eğrisi.
    expect(result.replay?.triggeredTrades ?? 0).toBeGreaterThan(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    // Tek hedefli model: continuation planları tek target taşır (CRT'nin EQ/DOL çiftinin aksine),
    // ve hiçbir continuation trade'i CRT'ye özel 1H tracking tag'ini taşımaz.
    expect(result.replay?.trades.every((trade) => !trade.tags.includes("anchor:1h"))).toBe(true);
    expect(result.replay?.trades.every((trade) => trade.status !== "tp2")).toBe(true);
  }, 30_000);

  it("keeps the 1H anchor watch-only when intradayAnchorMode is explicitly tracking", () => {
    const contexts = attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)));
    for (const context of contexts.slice(0, 6)) {
      const signals = crtStrategy.scan({
        context,
        settings: { ...crtStrategy.defaultSettings, intradayAnchorMode: "tracking", minimumRR: 0.1, useExecutionCosts: false }
      }).signals;
      for (const signal of signals.filter((item) => item.crtAnchor?.rangeTf === "1h")) {
        expect(signal.stage).not.toBe("ready");
      }
    }
  });

  it("keeps the 1H anchor in tracking by default after real data contradicted the demo result", () => {
    // 2026-07-22: 1H canlıya alındı, sonra GERÇEK veriyle ölçüldü — aynı replay penceresinde
    // çekirdek +2.89R / PF 2.44 iken 1H -2.77R / PF 0.31 / WR %20 verdi (demo'da +3.87R idi).
    // Kanıt terfiyi çürüttüğü için varsayılan tracking'e döndürüldü.
    expect(crtStrategy.defaultSettings.intradayAnchorMode).toBe("tracking");

    const tracking = runMonthlyRuntimeReplay({
      markets: createDemoMarkets(),
      strategy: crtStrategy,
      settings: { ...crtStrategy.defaultSettings, intradayAnchorMode: "tracking", minimumRR: 0.1, useExecutionCosts: false },
      windowDays: 3,
      maxHoldCandles: 24,
      scanEveryCandles: 12
    });
    // Tracking mode keeps 1H off the headline and on the shadow line.
    expect(tracking.replay?.trades.every((trade) => !trade.tags.includes("anchor:1h"))).toBe(true);
    expect((tracking.replay?.trackingTrades ?? []).every((trade) => trade.tags.includes("anchor:1h"))).toBe(true);
  });

  it("groups same-day same-USD-side correlated trades into cluster days for the review", () => {
    const day = Date.UTC(2026, 6, 16, 9);
    const trade = (symbol: string, direction: string, rMultiple: number, status = "tp1"): RuntimeReplayTrade => ({
      symbol,
      direction,
      signalTime: day,
      status,
      rMultiple,
      eqRR: 1.2,
      grade: "A",
      session: "London"
    } as unknown as RuntimeReplayTrade);

    // EURUSD short + USDJPY long = aynı usd-long bahsi; XAUUSD short ayrı küme (metal);
    // not-triggered işlem hiçbir kovaya girmez.
    const review = __runtimeReplayInternals.buildReviewMeasurements([
      trade("EURUSD", "short", 1.4),
      trade("USDJPY", "long", -1),
      trade("XAUUSD", "short", 0.8),
      trade("GBPUSD", "short", 0, "not-triggered")
    ]);

    expect(__runtimeReplayInternals.clusterExposure("EURUSD", "short")).toEqual({ cluster: "dollar-fx", exposure: "usd-long" });
    expect(__runtimeReplayInternals.clusterExposure("USDJPY", "long")).toEqual({ cluster: "dollar-fx", exposure: "usd-long" });
    expect(review.clusterDays).toHaveLength(1);
    expect(review.clusterDays[0]).toMatchObject({ cluster: "dollar-fx", exposure: "usd-long", trades: 2, totalR: 0.4 });
    expect(review.clusterDays[0].symbols).toEqual(["EURUSD", "USDJPY"]);
    expect(review.eqRr.sample).toBe(3);
    expect(review.gradeBuckets).toEqual([{ grade: "A", trades: 3, totalR: 1.2, expectancyR: 0.4 }]);
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
