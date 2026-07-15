import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { evaluateReferenceCandle } from "../lib/strategies/crt/referenceCandle";

function bar(open: number, high: number, low: number, close: number): Candle {
  return { time: 0, open, high, low, close, volume: 1, closed: true };
}

// A flat backdrop of ~1.0-range candles so ATR/median are predictable.
function backdrop(count = 20): Candle[] {
  return Array.from({ length: count }, () => bar(100, 100.5, 99.5, 100));
}

describe("reference_candle_score", () => {
  it("grades a large-body imbalance candle at meaningful location as A", () => {
    // body 8 of a 9-range candle (0.89), ~1.8x the 1.0 ATR backdrop, expansion, at location, key time.
    const candle = bar(100.5, 109, 100, 108.5);
    const score = evaluateReferenceCandle({
      candle,
      recentCandles: backdrop(),
      atMeaningfulLocation: true,
      keyTime: true
    });

    expect(score.bodyRatio).toBeGreaterThan(0.7);
    expect(score.components.imbalance).toBe(30);
    expect(score.grade).toBe("A");
    expect(score.score).toBeGreaterThanOrEqual(75);
  });

  it("marks a rejection/indecision candle (tiny body, long wicks) as low imbalance", () => {
    // body 0.2 of a 6-range candle (0.03) — a doji-like rejection candle, no location.
    const candle = bar(100, 103, 97, 100.2);
    const score = evaluateReferenceCandle({ candle, recentCandles: backdrop() });

    expect(score.bodyRatio).toBeLessThan(0.3);
    expect(score.components.imbalance).toBe(4);
    expect(score.grade === "D" || score.grade === "C").toBe(true);
    expect(score.score).toBeLessThan(score.components.imbalance + 60);
  });

  it("penalizes an exhausted, oversized candle", () => {
    // range 12 vs 1.0 ATR = 12x → exhausted, even with a big body.
    const candle = bar(100, 112, 100, 111);
    const score = evaluateReferenceCandle({ candle, recentCandles: backdrop(), atMeaningfulLocation: true });

    expect(score.exhausted).toBe(true);
    expect(score.components.rangeVsAtr).toBe(3);
  });

  it("ranks a proper imbalance candle strictly above an arbitrary doji of the same range", () => {
    const recent = backdrop();
    const imbalance = evaluateReferenceCandle({ candle: bar(100.2, 106, 100, 105.8), recentCandles: recent, atMeaningfulLocation: true });
    const doji = evaluateReferenceCandle({ candle: bar(103, 106, 100, 103.1), recentCandles: recent, atMeaningfulLocation: true });

    expect(imbalance.score).toBeGreaterThan(doji.score);
  });

  it("explains every scored component (Master §5)", () => {
    const score = evaluateReferenceCandle({ candle: bar(100.5, 109, 100, 108.5), recentCandles: backdrop(), atMeaningfulLocation: true, keyTime: true });
    expect(score.reasons.length).toBeGreaterThanOrEqual(4);
  });
});
