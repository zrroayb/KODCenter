import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { aggregateCandles } from "../lib/data/candleAggregation";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 10 };
}

describe("candle aggregation", () => {
  it("aggregates lower timeframe candles into OHLCV buckets", () => {
    const start = Date.UTC(2026, 5, 30, 8, 0);
    const candles = [
      candle(start, 100, 104, 99, 103),
      candle(start + 5 * 60 * 1000, 103, 106, 102, 105),
      candle(start + 10 * 60 * 1000, 105, 107, 101, 102),
      candle(start + 15 * 60 * 1000, 102, 103, 98, 99)
    ];

    const aggregated = aggregateCandles(candles, "15m");

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toMatchObject({
      time: start,
      open: 100,
      high: 107,
      low: 99,
      close: 102,
      volume: 30
    });
    expect(aggregated[1]).toMatchObject({
      time: start + 15 * 60 * 1000,
      open: 102,
      high: 103,
      low: 98,
      close: 99,
      volume: 10
    });
  });
});
