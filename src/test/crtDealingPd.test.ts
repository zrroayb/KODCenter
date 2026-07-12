import { describe, expect, it } from "vitest";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext } from "./strategyFixtures";
import type { PremiumDiscountContext } from "../lib/ict/types";

// A textbook CRT short that sits correctly in the PREMIUM half of its own 4h range, but where
// the broader GLOBAL dealing range reads discount. The CRT-range PD (pdAligned) is the setup's
// own logic and must stay the hard gate; the global dealing-range PD may only note/size-down.
function shortSignal(globalZone: PremiumDiscountContext["zone"]) {
  const base = createStructureContext();
  const h4 = base.timeframes.h4.map((candle, index) =>
    index === 21
      ? { ...candle, open: 100, high: 101, low: 95, close: 99 }
      : index === 22
        ? { ...candle, open: 99, high: 101.15, low: 96, close: 100.2 }
        : index === 23
          ? { ...candle, open: 96.2, high: 96.5, low: 95.5, close: 95.9 }
          : candle
  );
  const mappedM15 = base.timeframes.m15.map((candle, index) =>
    index === 18
      ? { ...candle, low: 99.4 }
      : index === 21
        ? { ...candle, open: 100.4, high: 100.8, low: 99.9, close: 100.6 }
      : index === 22
        ? { ...candle, open: 100.8, high: 101.15, low: 100, close: 100.2 }
        : index === 23
          ? { ...candle, open: 100.4, high: 100.45, low: 99.1, close: 99.3 }
          : candle
  );
  const lastM15 = mappedM15[mappedM15.length - 1];
  const m15 = [
    ...mappedM15,
    { ...lastM15, time: lastM15.time + 15 * 60 * 1000, open: 100.5, high: 100.7, low: 100.4, close: 100.5 },
    { ...lastM15, time: lastM15.time + 30 * 60 * 1000, open: 100.5, high: 100.65, low: 100.45, close: 100.5 }
  ];
  const context = createStructureContext({
    timeframes: { ...base.timeframes, m15, m5: m15, h4 },
    dealingRange: { high: 105, low: 90, midpoint: 97.5, source: "fixture" },
    premiumDiscount: { zone: globalZone, positionPct: globalZone === "premium" ? 0.72 : 0.28, midpoint: 97.5 },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 90, label: "Sell-side", strength: "strong" }
    ],
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 101.4, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101.3, candleIndex: 22, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }],
    crt: {
      rangeTimeframe: "4h",
      activeRange: { high: 105, low: 90, midpoint: 97.5, source: "fixture" },
      selectedBias: {
        timeframe: "4h",
        kind: "bearish-reversal",
        direction: "short",
        drawLevel: 90,
        drawSide: "sell-side",
        rangeHigh: 105,
        rangeLow: 90,
        midpoint: 97.5,
        strength: "strong",
        summary: "4h previous high sweep + altında kapanış; DOL current low."
      },
      macroBiases: [],
      validPullback: true,
      pullbackSummary: "Bearish pullback valid.",
      pois: [{ type: "fvg", direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: true, label: "FVG" }]
    }
  });
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals[0];
}

describe("dealing-range PD is a note, not a second veto", () => {
  it("keeps a CRT short READY when its own range is premium even if the global dealing range is discount", () => {
    const aligned = shortSignal("premium");
    const conflicting = shortSignal("discount");

    // Baseline: the aligned setup is READY.
    expect(aligned.stage).toBe("ready");

    // The global-PD conflict must NOT demote it or add a hard blocker — only a warning.
    expect(conflicting.stage).toBe("ready");
    expect(conflicting.governance.blockers.some((b) => b.includes("Dealing range"))).toBe(false);
    expect(conflicting.governance.blockers).toHaveLength(0);
    expect(conflicting.decisionSummary.warnings.some((w) => w.includes("dealing range PD ters"))).toBe(true);
  });
});
