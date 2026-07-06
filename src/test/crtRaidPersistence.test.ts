import { describe, expect, it } from "vitest";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext } from "./strategyFixtures";

// Regression: a long raid waiting for LTF confirmation must not flip to short just because
// the next range candle poked above the raid candle's high. That poke is the long setup's
// own delivery toward the range high, not a fresh short raid. The raid only releases when
// the reclaim breaks (close beyond the swept extreme) or the target side gets touched.

type CandlePatch = { open: number; high: number; low: number; close: number };

function scanWithH4(patches: Record<number, CandlePatch>) {
  const base = createStructureContext();
  const h4 = base.timeframes.h4.map((candle, index) =>
    patches[index] ? { ...candle, ...patches[index] } : candle
  );
  // Keep the confirmation TF's last close consistent with the h4 story (~98).
  const m15 = base.timeframes.m15.map((candle) => ({ ...candle, open: 98, high: 98.4, low: 97.6, close: 98 }));
  const context = createStructureContext({ timeframes: { ...base.timeframes, h4, m15, m5: m15 } });
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
  }).signals[0];
}

describe("CRT raid persistence", () => {
  it("keeps the long direction while the raid's reclaim holds and the target is untouched", () => {
    // h4[20] is the range candle (101/95), h4[21] raids its low and closes back inside (long),
    // h4[22] pokes above h4[21]'s high — under the old rolling window this read as a fresh
    // short raid and flipped the signal while we were still waiting for the long's ChoCH.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 96 },
      22: { open: 96, high: 99, low: 95.8, close: 98 },
      23: { open: 98, high: 98.3, low: 97.6, close: 98 }
    });

    expect(signal.direction).toBe("long");
    expect(signal.crtAnchor?.rangeHigh).toBe(101);
    expect(signal.crtAnchor?.rangeLow).toBe(95);
    expect(signal.crtAnchor?.raidActive).toBe(true);
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

  it("releases the long when a later close breaks the reclaim", () => {
    // h4[22] closes below the swept low: that was a breakout, not a manipulation, so the
    // long raid is dead and nothing here may fade the move.
    const signal = scanWithH4({
      20: { open: 100, high: 101, low: 95, close: 99 },
      21: { open: 98, high: 98.4, low: 94.6, close: 96 },
      22: { open: 96, high: 96.5, low: 93.8, close: 94.2 },
      23: { open: 94.2, high: 94.6, low: 93.9, close: 94.3 }
    });

    expect(signal?.crtAnchor?.raidActive ?? false).toBe(false);
  });
});
