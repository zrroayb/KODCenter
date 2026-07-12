import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { ruleAllowsContext, ruleAllowsSignal } from "../lib/userRules/applyRules";
import { defaultRules } from "../lib/userRules/defaultRules";
import { createStructureContext } from "./strategyFixtures";

function visibleSequenceSignal() {
  const context = createStructureContext({
    sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
    judasSwings: [{ direction: "short", session: "New York AM", sweepLevel: 101 }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1.2 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
  });
  return {
    context,
    signal: kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, useExecutionCosts: false } }).signals[0]
  };
}

describe("user rule visibility policy", () => {
  it("keeps default scanning visible with C as the lowest active grade", () => {
    const { context, signal } = visibleSequenceSignal();

    expect(ruleAllowsContext(context, defaultRules)).toBe(true);
    expect(ruleAllowsSignal(signal, defaultRules)).toBe(true);
    expect(defaultRules.minimumRR).toBe(1.5);
    expect(defaultRules.minimumScore).toBe(50);
    expect(defaultRules.useExecutionCosts).toBe(true);
  });

  it("does not show D quality signals even when a stale rule state is lower", () => {
    const { signal } = visibleSequenceSignal();
    const cSignal = { ...signal, score: 50, grade: "C" as const };
    const dSignal = { ...signal, score: 49, grade: "D" as const };
    const staleRules = { ...defaultRules, minimumScore: 0 };

    expect(ruleAllowsSignal(cSignal, staleRules)).toBe(true);
    expect(ruleAllowsSignal(dSignal, staleRules)).toBe(false);
  });

  it("filters signals when the user intentionally raises quality thresholds", () => {
    const { signal } = visibleSequenceSignal();

    expect(ruleAllowsSignal(signal, { ...defaultRules, minimumScore: signal.score + 1 })).toBe(false);
  });

  it("keeps WATCH ideas visible even when RR is below the READY threshold", () => {
    const { signal } = visibleSequenceSignal();
    const lowRrPlan = { ...signal.plan, rr: defaultRules.minimumRR - 0.25 };

    expect(ruleAllowsSignal({ ...signal, stage: "watch", plan: lowRrPlan }, defaultRules)).toBe(true);
    expect(ruleAllowsSignal({ ...signal, stage: "ready", plan: lowRrPlan }, defaultRules)).toBe(false);
  });

  it("hides invalidated and missed setups from visible signal candidates", () => {
    const { signal } = visibleSequenceSignal();

    expect(ruleAllowsSignal({ ...signal, stage: "invalidated" }, defaultRules)).toBe(false);
    expect(ruleAllowsSignal({ ...signal, stage: "missed" }, defaultRules)).toBe(false);
  });

  it("does not apply killzone filtering to crypto symbols", () => {
    const base = createDemoContexts()[0];
    const outsideContext = {
      ...base,
      symbol: "BTCUSD" as const,
      killzones: [{ name: "Outside" as const, active: true, startHourUtc: 0, endHourUtc: 0 }]
    };

    expect(ruleAllowsContext(outsideContext, { ...defaultRules, allowedKillzones: ["London"] })).toBe(true);
    expect(ruleAllowsContext({ ...outsideContext, symbol: "EURUSD" }, { ...defaultRules, allowedKillzones: ["London"] })).toBe(false);
  });
});
