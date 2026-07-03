import { describe, expect, it } from "vitest";
import { signalLifecycleState } from "../lib/signals/signalClassification";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("signal lifecycle state", () => {
  it("labels ready plans as locked when action window is valid", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signalLifecycleState(signal).status).toBe("ready-locked");
    expect(signalLifecycleState(signal).nextAction).toContain("Plan canlı");
  });

  it("explains watch signals that are waiting for a close confirmation", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1 ? { ...candle, low: 98.8 } : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signal.stage).toBe("watch");
    expect(signalLifecycleState(signal).status).toBe("close-wait");
    expect(signalLifecycleState(signal).nextAction).toContain("mum kapanışı");
  });

  it("does not keep stopped plans actionable", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1 ? { ...candle, high: 102.2, close: 100 } : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 22, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 22, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 22 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    expect(signalLifecycleState(signal).status).toBe("invalidated");
    expect(signalLifecycleState(signal).nextAction).toContain("Yeni sweep");
  });
});
