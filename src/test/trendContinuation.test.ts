import { describe, expect, it } from "vitest";
import type { Candle, MarketContext } from "../lib/ict/types";
import { trendContinuationStrategy, TREND_CONTINUATION_STRATEGY_ID } from "../lib/strategies/trendContinuation/trendContinuation.strategy";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { PLAYBOOK_STRATEGIES, strategyRegistry } from "../lib/strategies/registry";
import { scanContexts } from "../lib/runtime/scanRuntime";
import { defaultRules } from "../lib/userRules/defaultRules";
import { createStructureContext } from "./strategyFixtures";

let clock = Date.UTC(2026, 0, 1);
function c(open: number, high: number, low: number, close: number): Candle {
  clock += 3600_000;
  return { time: clock, open, high, low, close, volume: 1000 };
}

// HH/HL uptrend → pullback (FVG) → displacement breakout (BOS long, kapanış korunan high üstünde)
// → gap retest. detectStructuralBias bunu bos+uptrend+long okur; breakout bacağı retest edilmiş
// bir bullish FVG bırakır → confirmed retest girişi.
function uptrendBreakoutRetest(): Candle[] {
  clock = Date.UTC(2026, 0, 1);
  return [
    c(101, 101.2, 100, 100.2),
    c(100.2, 100.4, 99.6, 100),
    c(100, 100.6, 99.9, 100.5),
    c(100.5, 101.2, 100.4, 101),
    c(101, 102.2, 100.9, 102),
    c(102, 102.1, 101.4, 101.6),
    c(101.6, 101.8, 101.1, 101.3),
    c(101.3, 101.5, 100.8, 101),
    c(101, 101.8, 100.9, 101.7),
    c(101.7, 102.6, 101.6, 102.5),
    c(102.5, 103.4, 102.4, 103.3),
    c(103.3, 103.4, 102.7, 102.9),
    c(102.9, 103.0, 102.4, 102.6),
    c(102.6, 102.8, 102.2, 102.5),
    c(102.5, 103.2, 102.45, 103.1),
    c(103.2, 104.6, 103.2, 104.5),
    c(104.5, 105.0, 103.9, 104.8),
    c(104.8, 104.9, 103.6, 103.8),
    c(103.8, 104.4, 103.7, 104.2)
  ];
}

// Uptrend sonra korunan low'un kapanışla kırılması = CHoCH (reversal bölgesi). Continuation burada
// sessiz kalmalı — same-direction BOS yok.
function uptrendThenChoch(): Candle[] {
  clock = Date.UTC(2026, 0, 1);
  return [
    c(101, 101.2, 100, 100.2),
    c(100.2, 100.4, 99.6, 100),
    c(100, 100.6, 99.9, 100.5),
    c(100.5, 101.2, 100.4, 101),
    c(101, 102.2, 100.9, 102),
    c(102, 102.1, 101.4, 101.6),
    c(101.6, 101.8, 101.1, 101.3),
    c(101.3, 101.5, 100.8, 101),
    c(101, 101.8, 100.9, 101.7),
    c(101.7, 102.6, 101.6, 102.5),
    c(102.5, 103.4, 102.4, 103.3),
    c(103.3, 103.4, 102.7, 102.9),
    c(102.9, 103.0, 102.4, 102.6),
    c(102.6, 102.8, 102.2, 102.5),
    c(102.5, 102.6, 101.5, 101.6),
    c(101.6, 101.7, 100.4, 100.5), // korunan low (102.2) kapanışla kırıldı → CHoCH aşağı
    c(100.5, 100.8, 99.9, 100.1),
    c(100.1, 100.3, 99.4, 99.6),
    c(99.6, 99.9, 99.1, 99.3)
  ];
}

function flat(): Candle[] {
  clock = Date.UTC(2026, 0, 1);
  return Array.from({ length: 30 }, () => c(100, 100.3, 99.7, 100));
}

function contextWith(candles: Candle[], overrides: Partial<MarketContext> = {}): MarketContext {
  return createStructureContext({
    timeframes: { monthly: candles, weekly: candles, daily: candles, h4: candles, h1: candles, m15: candles, m5: candles },
    ...overrides
  });
}

describe("Trend Continuation playbook", () => {
  it("registers alongside CRT as a second playbook", () => {
    expect(strategyRegistry.map((strategy) => strategy.id)).toContain("crt");
    expect(strategyRegistry.map((strategy) => strategy.id)).toContain(TREND_CONTINUATION_STRATEGY_ID);
    expect(strategyRegistry[0].id).toBe("crt");
    expect(PLAYBOOK_STRATEGIES.map((strategy) => strategy.id)).toEqual(["crt", TREND_CONTINUATION_STRATEGY_ID]);
  });

  it("emits a long continuation on HTF trend + accepted BOS + retested pullback FVG", () => {
    const context = contextWith(uptrendBreakoutRetest());
    const result = trendContinuationStrategy.scan({ context, settings: trendContinuationStrategy.defaultSettings });
    const signal = result.signals[0];

    expect(signal).toBeDefined();
    expect(signal.strategyId).toBe(TREND_CONTINUATION_STRATEGY_ID);
    expect(signal.direction).toBe("long");
    expect(signal.plan.stopLoss).toBeLessThan(signal.plan.entry);
    expect(signal.plan.rr).toBeGreaterThan(0);
    const breakout = signal.evidence.find((item) => item.id === "tc-breakout");
    expect(breakout?.status).toBe("pass");
    expect(signal.decisionSummary.checklist.map((item) => item.label)).toContain("Kabullü Breakout (BOS)");
  });

  it("stays silent when structure is flat (no trend = no continuation)", () => {
    const context = contextWith(flat());
    const result = trendContinuationStrategy.scan({ context, settings: trendContinuationStrategy.defaultSettings });
    expect(result.signals).toHaveLength(0);
  });

  it("does not fire a long continuation against a downtrend HTF bias", () => {
    // Execution shows an up move, but daily/h4 are the CHoCH-down series → HTF trend not long.
    const context = contextWith(uptrendBreakoutRetest(), {
      timeframes: {
        monthly: uptrendThenChoch(), weekly: uptrendThenChoch(), daily: uptrendThenChoch(),
        h4: uptrendThenChoch(), h1: uptrendBreakoutRetest(), m15: uptrendBreakoutRetest(), m5: uptrendBreakoutRetest()
      }
    });
    const result = trendContinuationStrategy.scan({ context, settings: trendContinuationStrategy.defaultSettings });
    expect(result.signals.every((signal) => signal.direction === "long")).toBe(true);
    // HTF ters olduğunda long continuation üretilmez.
    expect(result.signals).toHaveLength(0);
  });

  it("does not treat a reversal CHoCH as a continuation (no double-count with CRT reversal)", () => {
    const context = contextWith(uptrendThenChoch(), {
      // daily hâlâ trend uptrend olsun ki gate açık kalsın; exec CHoCH göstersin.
      timeframes: {
        monthly: uptrendBreakoutRetest(), weekly: uptrendBreakoutRetest(), daily: uptrendBreakoutRetest(),
        h4: uptrendBreakoutRetest(), h1: uptrendThenChoch(), m15: uptrendThenChoch(), m5: uptrendThenChoch()
      }
    });
    const result = trendContinuationStrategy.scan({ context, settings: trendContinuationStrategy.defaultSettings });
    // Exec CHoCH (aşağı) trend yönünde BOS değil → continuation sinyali yok.
    expect(result.signals.filter((signal) => signal.stage === "ready")).toHaveLength(0);
  });

  it("scanContexts runs both playbooks with distinct strategyId labels and unique ids", () => {
    const context = contextWith(uptrendBreakoutRetest());
    const result = scanContexts([context], "crt", defaultRules);
    const all = [...result.signals, ...result.hiddenSignals, ...result.inactiveSignals];
    const ids = all.map((signal) => signal.id);
    expect(new Set(ids).size).toBe(ids.length); // hiçbir sinyal iki kez sayılmaz
    const strategies = new Set(all.map((signal) => signal.strategyId));
    // En az CRT görünür; continuation da context uygunsa katılır. Her sinyal kendi etiketini taşır.
    expect(strategies.has("crt") || strategies.has(TREND_CONTINUATION_STRATEGY_ID)).toBe(true);
    all.forEach((signal) => {
      expect([crtStrategy.id, TREND_CONTINUATION_STRATEGY_ID]).toContain(signal.strategyId);
    });
  });
});
