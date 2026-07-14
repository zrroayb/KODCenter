import { describe, expect, it } from "vitest";
import { crtStrategy, evaluateCrtHtfAlignment } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext } from "./strategyFixtures";
import type { MarketContext, PremiumDiscountContext } from "../lib/ict/types";

// A textbook CRT short that sits correctly in the PREMIUM half of its own 4h range, but where
// the broader GLOBAL dealing range reads discount. The CRT-range PD (pdAligned) is the setup's
// own logic and must stay the hard gate; the global dealing-range PD may only note/size-down.
function shortSignal(globalZone: PremiumDiscountContext["zone"], biasOverrides: Partial<MarketContext["bias"]> = {}) {
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
        ? { ...candle, open: 100.8, high: 101.15, low: 100.2, close: 100.5 }
        : index === 23
          ? { ...candle, open: 100.5, high: 100.6, low: 99.1, close: 99.3 }
          : candle
  );
  const lastM15 = mappedM15[mappedM15.length - 1];
  const m15 = [
    ...mappedM15,
    { ...lastM15, time: lastM15.time + 15 * 60 * 1000, open: 99.3, high: 99.8, low: 99.1, close: 99.4 },
    { ...lastM15, time: lastM15.time + 30 * 60 * 1000, open: 99.5, high: 100, low: 99.3, close: 99.7 }
  ];
  const context = createStructureContext({
    timeframes: { ...base.timeframes, m15, m5: m15, h4 },
    bias: { ...base.bias, ...biasOverrides },
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
  }).signals.find((signal) => signal.crtAnchor?.rangeTf === "4h" && signal.direction === "short")!;
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

  it("keeps an otherwise valid setup at WATCH when its anchor-specific HTF direction conflicts", () => {
    const signal = shortSignal("premium", { weekly: "bullish" });

    expect(signal.stage).toBe("watch");
    expect(signal.governance.blockers.join(" ")).toContain("HTF yönü karşı");
    expect(signal.evidence.find((item) => item.id === "htf-alignment")?.status).toBe("fail");
  });

  it("checks the correct higher-timeframe chain for every CRT anchor", () => {
    const context = createStructureContext({
      bias: {
        monthly: "bullish",
        weekly: "bullish",
        daily: "bullish",
        h4: "bearish",
        h1: "bearish"
      }
    });

    expect(evaluateCrtHtfAlignment(context, "4h", "long").required).toEqual(["1d", "1w"]);
    expect(evaluateCrtHtfAlignment(context, "4h", "long").aligned).toBe(true);
    expect(evaluateCrtHtfAlignment(context, "1d", "long").required).toEqual(["1w"]);
    expect(evaluateCrtHtfAlignment(context, "1d", "long").aligned).toBe(true);
    expect(evaluateCrtHtfAlignment(context, "1w", "long").required).toEqual(["1M"]);
    expect(evaluateCrtHtfAlignment(context, "1w", "long").aligned).toBe(true);
    expect(evaluateCrtHtfAlignment(context, "4h", "short").aligned).toBe(false);
  });

  it("tolerates a neutral higher timeframe but still vetoes an opposing one", () => {
    const neutralAbove = createStructureContext({
      bias: { monthly: "neutral", weekly: "neutral", daily: "neutral", h4: "bullish", h1: "bullish" }
    });
    const long4h = evaluateCrtHtfAlignment(neutralAbove, "4h", "long");
    expect(long4h.aligned).toBe(true);
    expect(long4h.fullyAligned).toBe(false);

    const opposingAbove = createStructureContext({
      bias: { monthly: "bearish", weekly: "bearish", daily: "bearish", h4: "bullish", h1: "bullish" }
    });
    const opposed4h = evaluateCrtHtfAlignment(opposingAbove, "4h", "long");
    expect(opposed4h.aligned).toBe(false);
    expect(opposed4h.opposing.length).toBeGreaterThan(0);
  });
});
