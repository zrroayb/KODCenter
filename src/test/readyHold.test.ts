import { describe, expect, it } from "vitest";
import { mergeReadyHoldSignals, readyHoldSignature } from "../lib/signals/readyHold";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

function structureContext() {
  return createStructureContext({
    dealingRange: { high: 105, low: 97, midpoint: 101, source: "Ready hold fixture" },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 97, label: "Sell-side", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101.3, candleIndex: 23, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
  });
}

describe("ready signal hold", () => {
  it("keeps a previously READY setup ready when the next scan downgrades the same setup to WATCH", () => {
    const context = structureContext();
    const ready = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    }).signals[0];
    const watch = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 10, useExecutionCosts: false }
    }).signals[0];

    const first = mergeReadyHoldSignals([ready], {}, 1_000);
    const second = mergeReadyHoldSignals([watch], first.records, 2_000);

    expect(ready.stage).toBe("ready");
    expect(watch.stage).toBe("watch");
    expect(readyHoldSignature(watch)).toBe(readyHoldSignature(ready));
    expect(second.signals[0].stage).toBe("ready");
    expect(second.signals[0].id).toBe(ready.id);
    expect(second.signals[0].riskWarnings.join(" ")).toContain("READY sinyal kilidi");
  });

  it("clears the hold when the same setup becomes invalidated", () => {
    const context = structureContext();
    const ready = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    }).signals[0];
    const invalidated = { ...ready, stage: "invalidated" as const };

    const first = mergeReadyHoldSignals([ready], {}, 1_000);
    const second = mergeReadyHoldSignals([invalidated], first.records, 2_000);

    expect(second.signals[0].stage).toBe("invalidated");
    expect(Object.keys(second.records)).toHaveLength(0);
  });
});
