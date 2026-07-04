import { describe, expect, it } from "vitest";
import { buildDataConfidence } from "../lib/intelligence/dataConfidenceEngine";
import { buildEventRisk } from "../lib/intelligence/eventRiskEngine";
import { classifyMarketRegime } from "../lib/intelligence/marketRegimeEngine";
import { evaluateSignalOutcome } from "../lib/intelligence/outcomeEngine";
import { buildSetupGovernance } from "../lib/intelligence/setupGovernance";
import type { Candle, TradePlan } from "../lib/ict/types";
import { createStructureContext } from "./strategyFixtures";

function candle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time: Date.UTC(2026, 6, 3, 12, 0) + index * 15 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 1000
  };
}

function plan(): TradePlan {
  return {
    entry: 100,
    entrySource: "mss-close",
    entryStatus: "confirmed",
    entryModel: {
      source: "mss-close",
      status: "confirmed",
      level: 100,
      retested: true,
      cisdConfirmed: true,
      warnings: []
    },
    stopLoss: 99,
    targets: [102, 103],
    invalidation: 99,
    rr: 2,
    grossRR: 2,
    riskDistance: 1,
    stopSource: "swing",
    stopBuffer: 0.1,
    targetSource: "projection",
    executionCosts: {
      stress: "off",
      spread: 0,
      slippage: 0,
      commission: 0,
      total: 0,
      grossReward: 2,
      netReward: 2,
      riskAfterCosts: 1
    },
    planWarnings: []
  };
}

describe("strategy governance engines", () => {
  it("blocks USD symbols during modeled high-impact event windows", () => {
    const risk = buildEventRisk("XAUUSD", Date.UTC(2026, 6, 3, 12, 35));
    expect(risk.level).toBe("high");
    expect(risk.noTrade).toBe(true);
    expect(risk.summary).toContain("NFP");
  });

  it("surfaces active watch event windows in the summary", () => {
    const risk = buildEventRisk("NAS100", Date.UTC(2026, 6, 6, 13, 35));
    expect(risk.level).toBe("watch");
    expect(risk.noTrade).toBe(false);
    expect(risk.summary).toContain("US cash open liquidity reset");
    expect(risk.upcomingEvents.join(" ")).toContain("US cash open");
  });

  it("models CPI-style inflation windows as hard USD blocks", () => {
    const risk = buildEventRisk("EURUSD", Date.UTC(2026, 6, 8, 12, 35));
    expect(risk.level).toBe("high");
    expect(risk.noTrade).toBe(true);
    expect(risk.summary).toContain("US CPI");
  });

  it("classifies spike expansion as blocked regime", () => {
    const candles = Array.from({ length: 40 }, (_, index) => candle(index, 100, 100.2, 99.8, 100));
    candles[candles.length - 1] = candle(39, 100, 106, 99, 105);
    const regime = classifyMarketRegime(candles);
    expect(regime.type).toBe("news-expansion");
    expect(regime.tradeability).toBe("blocked");
  });

  it("marks demo/stale data as lower confidence", () => {
    const context = createStructureContext();
    const confidence = buildDataConfidence({
      timeframes: context.timeframes,
      dataFeed: { source: "demo", executionPrice: "mid", note: "demo" },
      now: context.timeframes.m15[context.timeframes.m15.length - 1].time
    });
    expect(confidence.score).toBeLessThan(85);
    expect(confidence.warnings.join(" ")).toContain("Demo");
  });

  it("tracks post-entry stop outcomes", () => {
    const candles = [
      candle(0, 100.2, 100.4, 99.8, 100),
      candle(1, 100, 100.3, 98.8, 99.2)
    ];
    const context = createStructureContext({
      timeframes: { monthly: candles, weekly: candles, daily: candles, h4: candles, h1: candles, m15: candles, m5: candles }
    });
    const outcome = evaluateSignalOutcome(context, "long", plan(), 0);
    expect(outcome.status).toBe("stopped");
    expect(outcome.entryTouched).toBe(true);
  });

  it("converts event risk into governance block", () => {
    const context = createStructureContext({
      eventRisk: {
        level: "high",
        noTrade: true,
        activeEvents: ["NFP"],
        upcomingEvents: [],
        summary: "NFP active",
        warnings: ["NFP active"]
      }
    });
    const governance = buildSetupGovernance({
      context,
      plan: plan(),
      outcome: {
        status: "not-triggered",
        entryTouched: false,
        maxFavorableR: 0,
        maxAdverseR: 0,
        candlesTracked: 10,
        summary: "waiting"
      },
      sequenceStatus: "ready",
      avoidNews: true
    });
    expect(governance.status).toBe("block");
    expect(governance.blockers.join(" ")).toContain("Haber");
  });
});
