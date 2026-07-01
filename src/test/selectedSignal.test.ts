import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { focusChartOnSignal, selectedSignalAnnotations, signalAnchorTime } from "../lib/charts/selectedSignal";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";

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
});
