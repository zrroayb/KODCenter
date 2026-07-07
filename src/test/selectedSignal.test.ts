import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { confirmationCandles, focusChartOnSignal, selectedSignalAnnotations, signalAnchorTime, signalConfirmTimeframe } from "../lib/charts/selectedSignal";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("selected signal chart focus", () => {
  it("builds annotations and a focus range that includes the signal anchor", () => {
    const context = createDemoContexts()[0];
    const signal = kodStrategy.scan({ context, settings: kodStrategy.defaultSettings }).signals[0];

    const annotations = selectedSignalAnnotations(signal);
    const range = focusChartOnSignal(signal);
    const anchor = signalAnchorTime(signal);

    expect(annotations.sweep ?? annotations.displacement ?? annotations.marketStructureShift ?? annotations.fairValueGap).toBeDefined();
    expect(range.from).toBeLessThanOrEqual(anchor);
    expect(range.to).toBeGreaterThanOrEqual(anchor);
  });

  it("anchors a 1D-anchor CRT signal to its 1H confirmation candles, not m15", () => {
    // Daily raid: daily[21] is the range candle (101/95), daily[22] raids its low and closes
    // back inside -> a 1d-anchor CRT signal whose structure lives on the 1H confirmation TF.
    const base = createStructureContext();
    const daily = base.timeframes.daily.map((candle, index) =>
      index === 21
        ? { ...candle, open: 100, high: 101, low: 95, close: 99 }
        : index === 22
          ? { ...candle, open: 98, high: 98.4, low: 94.6, close: 96 }
          : index === 23
            ? { ...candle, open: 96, high: 96.6, low: 95.8, close: 96.2 }
            : candle
    );
    const h1 = base.timeframes.h1.map((candle) => ({ ...candle, open: 96.2, high: 96.6, low: 95.9, close: 96.2 }));
    const context = createStructureContext({ timeframes: { ...base.timeframes, daily, h1 } });
    const signal = crtStrategy
      .scan({ context, settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false } })
      .signals.find((item) => item.crtAnchor?.rangeTf === "1d");

    expect(signal).toBeDefined();
    if (!signal) return;
    expect(signalConfirmTimeframe(signal)).toBe("1h");
    expect(confirmationCandles(signal)).toBe(context.timeframes.h1);

    const annotations = selectedSignalAnnotations(signal);
    // CRT structure comes from the signal's own evidence on the confirmation TF; an m15
    // context sweep or displacement index must never leak onto the 1H chart.
    expect(annotations.displacement).toBeUndefined();
    if (annotations.sweep) {
      expect(annotations.sweep.candleIndex).toBeLessThan(context.timeframes.h1.length);
    }

    const anchor = signalAnchorTime(signal);
    const h1Times = context.timeframes.h1.map((candle) => candle.time);
    expect(h1Times).toContain(anchor);

    const range = focusChartOnSignal(signal);
    expect(range.from).toBeLessThanOrEqual(anchor);
    expect(range.to).toBeGreaterThanOrEqual(anchor);
  });
});
