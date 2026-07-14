import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { createDemoMarkets } from "../data/demoData";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { crtStrategy, detectAnchorRaid } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext } from "./strategyFixtures";

function bar(high: number, low: number, close: number): Candle {
  return { time: 0, open: (high + low) / 2, high, low, close, volume: 1, closed: true };
}

describe("CRT delayed manipulation", () => {
  it("accepts a raid that sweeps the range candle several bars later, not only the adjacent one", () => {
    // idx1 is the meaningful range candle (110/100). idx2 and idx3 trade INSIDE it
    // (accumulation), and idx4 sweeps its high three bars on. The manipulation is not the
    // candle immediately after the range candle.
    const candles: Candle[] = [
      { ...bar(100, 90, 95), time: 0 },
      { ...bar(110, 100, 104), time: 1 },
      { ...bar(108, 102, 105), time: 2 },
      { ...bar(107, 101, 103), time: 3 },
      { ...bar(115, 103, 108), time: 4 }
    ];
    const { range, raid } = detectAnchorRaid(candles, { rangeTf: "4h", confirmTf: "15m" });

    expect(range.high).toBe(110);
    expect(range.low).toBe(100);
    expect(raid?.direction).toBe("short");
    expect(raid?.level).toBe(115);
  });

  it("does not pair the range candle with an intervening candle that stayed inside it", () => {
    // If manipulation HAD to be adjacent, this would report idx3 (107) as the range. It must
    // report idx1 (110) — the candle whose liquidity was actually taken.
    const candles: Candle[] = [
      { ...bar(100, 90, 95), time: 0 },
      { ...bar(110, 100, 104), time: 1 },
      { ...bar(108, 102, 105), time: 2 },
      { ...bar(107, 101, 103), time: 3 },
      { ...bar(115, 103, 108), time: 4 }
    ];
    const { range } = detectAnchorRaid(candles, { rangeTf: "4h", confirmTf: "15m" });
    expect(range.high).not.toBe(107);
  });
});

// Regression: a long raid waiting for LTF confirmation must not flip to short just because
// the next range candle poked above the raid candle's high. That poke is the long setup's
// own delivery toward the range high, not a fresh short raid. The raid only releases when
// the reclaim breaks (close beyond the swept extreme) or the target side gets touched.

type CandlePatch = { open: number; high: number; low: number; close: number; closed?: boolean };

function patchCandles<T extends { open: number; high: number; low: number; close: number }>(candles: T[], patches: Record<number, CandlePatch>): T[] {
  return candles.map((candle, index) => patches[index] ? { ...candle, ...patches[index] } : candle);
}

function scanWithH4(patches: Record<number, CandlePatch>, executionClose = 98) {
  const base = createStructureContext();
  const h4 = patchCandles(base.timeframes.h4, patches);
  // Keep the confirmation TF's last close consistent with the h4 story.
  const m15 = base.timeframes.m15.map((candle) => ({ ...candle, open: executionClose, high: executionClose + 0.4, low: executionClose - 0.4, close: executionClose }));
  const context = createStructureContext({
    timeframes: { ...base.timeframes, h4, m15, m5: m15 },
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 98.5, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ]
  });
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
  }).signals[0];
}

describe("CRT direction sources", () => {
  it("emits no CRT signal when the pair's own structure gives no direction", () => {
    // Flat anchor candles: no raid, neutral anchor bias. The premium/discount zone used to
    // fabricate a SHORT here, painting every correlated pair the same side on dollar days —
    // direction must come from the pair's own raid or bias, or there is no signal.
    const context = createStructureContext();
    const result = crtStrategy.scan({
      context,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
    });

    expect(context.premiumDiscount.zone).toBe("premium");
    expect(result.signals).toHaveLength(0);
  });

  it("surfaces the latest closed 4H CRT context as WATCH before a clean entry exists", () => {
    const usdJpy = attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)))
      .find((context) => context.symbol === "USDJPY");
    if (!usdJpy) throw new Error("USDJPY fixture missing");

    const signal = crtStrategy.scan({
      context: usdJpy,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5 }
    }).signals[0];

    expect(signal).toBeDefined();
    expect(signal.symbol).toBe("USDJPY");
    expect(signal.stage).toBe("watch");
    expect(signal.crtAnchor?.rangeTf).toBe("4h");
    expect(signal.crtAnchor?.raidActive).toBe(true);
    expect(signal.governance.blockers.join(" ")).toContain("ChoCH");
  });

  it("surfaces a fresh Daily high raid without requiring the Daily raid candle to close", () => {
    const base = createStructureContext();
    const daily = patchCandles(base.timeframes.daily, {
      21: { open: 99, high: 100, low: 94, close: 98 },
      22: { open: 99, high: 101, low: 95, close: 98 },
      23: { open: 100, high: 105, low: 97, close: 102.4 }
    });
    const h1 = patchCandles(base.timeframes.h1, {
      22: { open: 102.2, high: 104, low: 102, close: 103.5 },
      23: { open: 103.5, high: 105.2, low: 103.2, close: 103.4 }
    });
    const context = createStructureContext({
      symbol: "GBPUSD",
      timeframes: { ...base.timeframes, daily, h1 },
      bias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish", h1: "bullish" },
      premiumDiscount: { zone: "premium", positionPct: 0.74, midpoint: 98 },
      liquidityObjectives: [
        { id: "PDH", kind: "PDH", side: "buy-side", level: 105, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
        { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
      ]
    });

    const result = crtStrategy.scan({
      context,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    });
    const dailySignal = result.signals.find((signal) => signal.crtAnchor?.rangeTf === "1d");

    expect(dailySignal).toBeDefined();
    expect(dailySignal?.symbol).toBe("GBPUSD");
    expect(dailySignal?.direction).toBe("short");
    expect(dailySignal?.stage).toBe("watch");
    expect(dailySignal?.score).toBeGreaterThan(0);
    expect(dailySignal?.crtAnchor?.setupPhase).toBe("raid");
    expect(dailySignal?.crtAnchor?.raidActive).toBe(true);
    expect(dailySignal?.evidence.some((item) => item.id === "turtle-soup")).toBe(false);
    expect(dailySignal?.governance.blockers.join(" ")).toContain("1h ChoCH");
  });

  it("surfaces a tapped 4H FVG origin candle as its own CRT watch setup", () => {
    const base = createStructureContext();
    const h4 = patchCandles(base.timeframes.h4, {
      18: { open: 99, high: 100, low: 98, close: 99.2 },
      19: { open: 99.2, high: 106, low: 99, close: 105.5 },
      20: { open: 105.5, high: 107, low: 102, close: 106.2 },
      21: { open: 106.2, high: 106.4, low: 101.4, close: 103.2 },
      22: { open: 103.2, high: 105.2, low: 102.8, close: 104.6 },
      23: { open: 104.6, high: 106.2, low: 104.1, close: 105.7 }
    });
    const m15 = base.timeframes.m15.map((candle) => ({ ...candle, open: 105, high: 105.4, low: 104.6, close: 105 }));
    const context = createStructureContext({
      timeframes: { ...base.timeframes, h4, m15, m5: m15 },
      bias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish", h1: "bullish" },
      premiumDiscount: { zone: "discount", positionPct: 0.3, midpoint: 103.5 },
      liquidityObjectives: [
        { id: "PDH", kind: "PDH", side: "buy-side", level: 107, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
        { id: "PDL", kind: "PDL", side: "sell-side", level: 100, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
      ]
    });

    const result = crtStrategy.scan({
      context,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    });
    const signal = result.signals.find((item) => item.crtAnchor?.origin === "fvg-origin");

    expect(signal).toBeDefined();
    expect(signal?.direction).toBe("long");
    expect(signal?.stage).toBe("watch");
    expect(signal?.crtAnchor?.originLabel).toBe("4H FVG origin CRT");
    expect(signal?.evidence.find((item) => item.id === "crt-range")?.detail).toContain("FVG origin candle");
    expect(signal?.evidence.find((item) => item.id === "poi")?.detail).toContain("CRT yine geçerlidir");
    expect(signal?.governance.blockers.join(" ")).toContain("Manipulation");
    expect(signal?.governance.blockers.join(" ")).toContain("ChoCH");
  });

  it("surfaces the current Daily CRT candle as visible context instead of hiding it", () => {
    const base = createStructureContext();
    const daily = patchCandles(base.timeframes.daily, {
      20: { open: 1650, high: 1778, low: 1600, close: 1740 },
      21: { open: 1740, high: 1790, low: 1708, close: 1735 },
      22: { open: 1735, high: 1780, low: 1718, close: 1744 },
      23: { open: 1744.26, high: 1806.82, low: 1736.61, close: 1798.76 }
    });
    const h1 = base.timeframes.h1.map((candle) => ({ ...candle, open: 1796, high: 1802, low: 1790, close: 1798.76 }));
    const context = createStructureContext({
      symbol: "ETHUSD",
      timeframes: { ...base.timeframes, daily, h1 },
      bias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish", h1: "bullish" },
      premiumDiscount: { zone: "discount", positionPct: 0.34, midpoint: 1736 },
      liquidityObjectives: [
        { id: "PDH", kind: "PDH", side: "buy-side", level: 1806.82, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
        { id: "PDL", kind: "PDL", side: "sell-side", level: 1736.61, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
      ]
    });

    const result = crtStrategy.scan({
      context,
      settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
    });
    const dailyActive = result.signals.find((signal) => signal.crtAnchor?.origin === "active-crt" && signal.crtAnchor.rangeTf === "1d");

    expect(dailyActive).toBeDefined();
    expect(dailyActive?.symbol).toBe("ETHUSD");
    expect(dailyActive?.direction).toBe("long");
    expect(dailyActive?.stage).toBe("watch");
    expect(dailyActive?.crtAnchor?.originLabel).toBe("Forming 1D CRT");
    expect(dailyActive?.crtAnchor?.rangeHigh).toBe(1806.82);
    expect(dailyActive?.crtAnchor?.rangeLow).toBe(1736.61);
    expect(dailyActive?.evidence.find((item) => item.id === "crt-range")?.detail).toContain("Forming 1D CRT");
  });
});

describe("CRT raid persistence", () => {
  it("opens a SHORT raid watch as soon as a forming 4H candle takes the closed reference high", () => {
    const signal = scanWithH4({
      16: { open: 98, high: 102, low: 94, close: 98 },
      17: { open: 98, high: 102, low: 94, close: 98 },
      18: { open: 98, high: 102, low: 94, close: 98 },
      19: { open: 98, high: 102, low: 94, close: 98 },
      20: { open: 98, high: 102, low: 94, close: 98 },
      21: { open: 98, high: 102, low: 94, close: 98 },
      22: { open: 98, high: 101, low: 95, close: 98, closed: true },
      23: { open: 98, high: 101.2, low: 97, close: 101.1, closed: false }
    }, 101.1);

    expect(signal.direction).toBe("short");
    expect(signal.crtAnchor?.raidActive).toBe(true);
    expect(signal.crtAnchor?.raidClosed).toBe(false);
    expect(signal.crtAnchor?.setupPhase).toBe("raid");
    expect(signal.governance.blockers.join(" ")).toContain("15m ChoCH");
    expect(signal.governance.blockers.join(" ")).not.toContain("reclaim");
    expect(signal.governance.blockers.join(" ")).not.toContain("4H CRT origin mumu");
  });

  it("opens the mirrored LONG raid watch without waiting for the forming 4H candle close", () => {
    const signal = scanWithH4({
      16: { open: 98, high: 102, low: 94, close: 98 },
      17: { open: 98, high: 102, low: 94, close: 98 },
      18: { open: 98, high: 102, low: 94, close: 98 },
      19: { open: 98, high: 102, low: 94, close: 98 },
      20: { open: 98, high: 102, low: 94, close: 98 },
      21: { open: 98, high: 102, low: 94, close: 98 },
      22: { open: 98, high: 101, low: 95, close: 98, closed: true },
      23: { open: 98, high: 99, low: 94.8, close: 94.9, closed: false }
    }, 94.9);

    expect(signal.direction).toBe("long");
    expect(signal.crtAnchor?.raidActive).toBe(true);
    expect(signal.crtAnchor?.raidClosed).toBe(false);
    expect(signal.crtAnchor?.setupPhase).toBe("raid");
    expect(signal.governance.blockers.join(" ")).toContain("15m ChoCH");
    expect(signal.governance.blockers.join(" ")).not.toContain("reclaim");
  });

  it("drops a raided setup once price has already reached the CRT midpoint", () => {
    const signal = scanWithH4({
      16: { open: 98, high: 102, low: 94, close: 98 },
      17: { open: 98, high: 102, low: 94, close: 98 },
      18: { open: 98, high: 102, low: 94, close: 98 },
      19: { open: 98, high: 102, low: 94, close: 98 },
      20: { open: 98, high: 102, low: 94, close: 98 },
      21: { open: 98, high: 102, low: 94, close: 98 },
      22: { open: 98, high: 101, low: 95, close: 98, closed: true },
      23: { open: 98, high: 101.2, low: 97, close: 100.8, closed: false }
    }, 98.2);

    expect(signal.direction).toBe("short");
    expect(signal.stage).toBe("missed");
    expect(signal.outcome.summary).toContain("%50/EQ");
    expect(signal.plan.planWarnings.join(" ")).toContain("setup tüketildi");
  });

  it("drops the mirrored LONG setup once price has already reached the CRT midpoint", () => {
    const signal = scanWithH4({
      16: { open: 98, high: 102, low: 94, close: 98 },
      17: { open: 98, high: 102, low: 94, close: 98 },
      18: { open: 98, high: 102, low: 94, close: 98 },
      19: { open: 98, high: 102, low: 94, close: 98 },
      20: { open: 98, high: 102, low: 94, close: 98 },
      21: { open: 98, high: 102, low: 94, close: 98 },
      22: { open: 98, high: 101, low: 95, close: 98, closed: true },
      23: { open: 98, high: 99, low: 94.8, close: 95.2, closed: false }
    }, 98.2);

    expect(signal.direction).toBe("long");
    expect(signal.stage).toBe("missed");
    expect(signal.outcome.summary).toContain("%50/EQ");
  });

  it("keeps the long direction while the raid's reclaim holds and the target is untouched", () => {
    // h4[20] is the range candle (101/95), h4[21] raids its low and closes back inside (long),
    // h4[22] pokes above h4[21]'s high — under the old rolling window this read as a fresh
    // short raid and flipped the signal while we were still waiting for the long's ChoCH.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 96 },
      22: { open: 96, high: 99, low: 95.8, close: 96.5 },
      23: { open: 96.5, high: 97, low: 96.1, close: 96.5 }
    }, 96.5);

    expect(signal.direction).toBe("long");
    expect(signal.crtAnchor?.rangeHigh).toBe(101);
    expect(signal.crtAnchor?.rangeLow).toBe(95);
    expect(signal.crtAnchor?.raidActive).toBe(true);
  });

  it("accepts a CRT mitigation raid even when the raid candle did not close back inside", () => {
    // h4[21] sweeps the range low but closes below it. Price later trades back inside and
    // the reclaim is still holding, so this is a valid live CRT mitigation read; the close
    // back inside is a quality bonus, not the gate.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 94.8 },
      22: { open: 94.8, high: 97.2, low: 94.7, close: 96 },
      23: { open: 96, high: 98.3, low: 95.8, close: 98 }
    }, 96);

    expect(signal.direction).toBe("long");
    expect(signal.crtAnchor?.raidActive).toBe(true);
    expect(signal.crtAnchor?.raidClosed).toBe(false);
  });

  it("releases the long and accepts the newer short once the long's target side is touched", () => {
    // Same story, but h4[22] tags the range high: the long distribution completed, so the
    // consumed raid no longer pins direction and the fresh short raid at h4[21]'s high wins.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 96 },
      22: { open: 96, high: 101.2, low: 95.8, close: 98 },
      23: { open: 98, high: 98.3, low: 97.6, close: 98 }
    });

    expect(signal.direction).toBe("short");
  });

  it("recognizes the newer low raid even when that second 4H candle closes beyond the low", () => {
    // The older long is consumed, but h4[22] itself takes h4[21]'s low. Under the simplified
    // rule that newer raid is visible immediately; only its LTF confirmation can make it READY.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 96 },
      22: { open: 96, high: 96.5, low: 93.8, close: 94.2 },
      23: { open: 94.2, high: 94.6, low: 93.9, close: 94.3 }
    }, 94.3);

    expect(signal?.direction).toBe("long");
    expect(signal?.crtAnchor?.raidActive).toBe(true);
    expect(signal?.stage).toBe("watch");
  });
});
