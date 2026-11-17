import { describe, expect, it } from "vitest";
import { crtStrategy, evaluateCrtHtfAlignment } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext, withHtfCrts, type HtfCrtFixture } from "./strategyFixtures";
import type { PremiumDiscountContext } from "../lib/ict/types";

// A textbook CRT short that sits correctly in the PREMIUM half of its own 4h range, but where
// the broader GLOBAL dealing range reads discount. The CRT-range PD (pdAligned) is the setup's
// own logic and must stay the hard gate; the global dealing-range PD may only note/size-down.
function shortSignal(
  globalZone: PremiumDiscountContext["zone"],
  htf: { daily?: HtfCrtFixture; weekly?: HtfCrtFixture; monthly?: HtfCrtFixture } = { daily: "short" },
  withKeyLevels = true,
  candle2StillForming = false
) {
  const base = createStructureContext();
  const h4 = base.timeframes.h4.map((candle, index) =>
    index === 21
      ? { ...candle, open: 100, high: 101, low: 95, close: 99 }
      : index === 22
        ? { ...candle, open: 99, high: 101.15, low: 96, close: 100.2 }
        : index === 23
          ? { ...candle, open: 96.2, high: 96.5, low: 95.5, close: 95.9 }
          : candle
  ).slice(0, candle2StillForming ? 23 : undefined); // cut at C2 => C2 is the live (forming) candle
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
  const context = withHtfCrts(createStructureContext({
    timeframes: { ...base.timeframes, m15, m5: m15, h4 },
    dealingRange: { high: 105, low: 90, midpoint: 97.5, source: "fixture" },
    premiumDiscount: { zone: globalZone, positionPct: globalZone === "premium" ? 0.72 : 0.28, midpoint: 97.5 },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 90, label: "Sell-side", strength: "strong" }
    ],
    liquidityObjectives: [],
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
  }), htf, withKeyLevels ? 0 : 20);
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals.find((signal) => signal.crtAnchor?.rangeTf === "4h" && signal.direction === "short")!;
}

describe("dealing-range PD is a note, not a second veto", () => {
  it("does not let a global-PD conflict add a second blocker", () => {
    const aligned = shortSignal("premium");
    const conflicting = shortSignal("discount");

    // The global dealing-range PD conflict must NOT add a separate hard blocker — the two
    // signals' blocker lists stay identical, and the conflict shows up only as a warning.
    expect(conflicting.governance.blockers.some((b) => b.includes("Dealing range"))).toBe(false);
    expect(conflicting.governance.blockers).toEqual(aligned.governance.blockers);
    expect(conflicting.decisionSummary.warnings.some((w) => w.includes("dealing range PD ters"))).toBe(true);
  });

  it("an opposing D/W/M CRT is always a blocker — no setting, no exception (CRT Secrets)", () => {
    const signal = shortSignal("premium", { daily: "short", weekly: "long" });
    expect(signal.stage).not.toBe("ready");
    expect(signal.governance.blockers.join(" ")).toContain("HTF yönü yok/ters");
    expect(signal.evidence.find((item) => item.id === "htf-alignment")?.status).toBe("fail");
  });

  it("no active D/W/M CRT above = no direction: a 4H sweep alone is never READY", () => {
    const signal = shortSignal("premium", { daily: "none", weekly: "none", monthly: "none" });
    expect(signal.stage).not.toBe("ready");
    expect(signal.governance.blockers.join(" ")).toContain("aktif D/W/M CRT yok");
    const withDaily = shortSignal("premium", { daily: "short" });
    expect(withDaily.governance.blockers.join(" ")).not.toContain("HTF yönü");
  });

  it("a CRT without a key level (old D/W/M high/low or HTF FVG) cannot be READY (CRT Secrets)", () => {
    const withLevel = shortSignal("premium");
    expect(withLevel.governance.blockers.join(" ")).not.toContain("Key level yok");
    const noLevel = shortSignal("premium", { daily: "short" }, false);
    expect(noLevel.stage).not.toBe("ready");
    expect(noLevel.governance.blockers.join(" ")).toContain("Key level yok");
  });

  it("reads the D/W/M CRTs above each anchor", () => {
    const context = withHtfCrts(createStructureContext(), { daily: "long", weekly: "long", monthly: "short" });
    const h4 = evaluateCrtHtfAlignment(context, "4h", "long");
    expect(h4.required).toEqual(["1d", "1w", "1M"]);
    expect(h4.aligned).toBe(false); // monthly CRT points short
    const d1 = evaluateCrtHtfAlignment(context, "1d", "long");
    expect(d1.required).toEqual(["1w", "1M"]);
    expect(evaluateCrtHtfAlignment(context, "1w", "short").required).toEqual(["1M"]);
    expect(evaluateCrtHtfAlignment(context, "1w", "short").aligned).toBe(true);
    expect(evaluateCrtHtfAlignment(context, "1w", "short").fullyAligned).toBe(true);
    // Monthly anchor: top of the chain, its own CRT is the direction.
    expect(evaluateCrtHtfAlignment(context, "1M", "long").required).toEqual([]);
    expect(evaluateCrtHtfAlignment(context, "1M", "long").aligned).toBe(true);
  });

  it("one matching CRT with the rest inactive passes but is not fully aligned", () => {
    const context = withHtfCrts(createStructureContext(), { daily: "long" });
    const read = evaluateCrtHtfAlignment(context, "4h", "long");
    expect(read.aligned).toBe(true);
    expect(read.fullyAligned).toBe(false);
    expect(read.neutral).toEqual(["1w", "1M"]);
  });

  it("C2 closing beyond C1 (acceptance) or sweeping both sides is no HTF CRT", () => {
    const context = withHtfCrts(createStructureContext(), {});
    const daily = context.timeframes.daily;
    const c2 = daily.length - 2;
    const accepted = { ...context, timeframes: { ...context.timeframes, daily: daily.map((candle, index) => index === c2 ? { ...candle, high: 102, close: 101.8 } : candle) } };
    expect(evaluateCrtHtfAlignment(accepted, "4h", "short").neutral).toContain("1d");
    const outside = { ...context, timeframes: { ...context.timeframes, daily: daily.map((candle, index) => index === c2 ? { ...candle, high: 102, low: 93, close: 98 } : candle) } };
    expect(evaluateCrtHtfAlignment(outside, "4h", "short").neutral).toContain("1d");
  });

  it("only Candle 3 is traded: while the raid candle (C2) is still forming the setup stays WATCH", () => {
    const formingC2 = shortSignal("premium", { daily: "short" }, true, true);
    expect(formingC2.stage).not.toBe("ready");
    expect(formingC2.governance.blockers.join(" ")).toContain("Candle 2");
    const closedC2 = shortSignal("premium");
    expect(closedC2.governance.blockers.join(" ")).not.toContain("Candle 2");
  });
});
