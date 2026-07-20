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

  it("uses the CRT range and raid as the stable identity when confirmation details refresh", () => {
    const ready = kodStrategy.scan({
      context: structureContext(),
      settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    }).signals[0];
    const crtReady = {
      ...ready,
      strategyId: "crt",
      crtAnchor: {
        rangeTf: "4h" as const,
        confirmTf: "15m" as const,
        raidActive: true,
        raidClosed: true,
        rangeHigh: 101.3,
        rangeLow: 97,
        origin: "standard" as const
      },
      evidence: [
        ...ready.evidence,
        { id: "manipulation", label: "Raid", detail: "Range high alındı", status: "pass" as const, time: 10_000, price: 101.3 }
      ]
    };
    const refreshed = {
      ...crtReady,
      id: `${crtReady.id}-refresh`,
      evidence: [
        ...crtReady.evidence.filter((item) => item.id !== "choch"),
        { id: "choch", label: "ChoCH", detail: "Internal low altında kapandı", status: "pass" as const, time: 20_000, price: 99.4 }
      ],
      plan: { ...crtReady.plan, entry: crtReady.plan.entry + 0.1 }
    };

    expect(readyHoldSignature(refreshed)).toBe(readyHoldSignature(crtReady));
  });
});
