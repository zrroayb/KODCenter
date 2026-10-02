import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { aggregateCandles } from "../lib/data/candleAggregation";
import { latestClosed } from "../lib/ict/candles";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 10 };
}

describe("candle aggregation", () => {
  it("keeps the latest higher-timeframe bucket forming until its real end", () => {
    const start = Date.UTC(2026, 6, 10, 8, 0);
    const source = Array.from({ length: 6 }, (_, index) => ({
      time: start + index * 5 * 60 * 1000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
      closed: true
    }));

    const h1 = aggregateCandles(source, "1h");

    expect(h1.at(-1)?.closed).toBe(false);
  });

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

  it("keeps forming state through aggregation and skips it for closed-candle decisions", () => {
    const start = Date.UTC(2026, 6, 12, 17, 0);
    const source = [
      { ...candle(start, 100, 102, 99, 101), closed: true },
      { ...candle(start + 60 * 60 * 1000, 101, 103, 100, 102), closed: false }
    ];
    const aggregated = aggregateCandles(source, "4h");

    expect(aggregated[0].closed).toBe(false);
    expect(latestClosed(source).time).toBe(start);
  });
});

describe("weekly bucket and the Sunday open", () => {
  // 2026-09-18 Fri, 2026-09-20 Sun, 2026-09-21 Mon.
  const fri = candle(Date.UTC(2026, 8, 18), 100, 101, 99, 100);
  const sun = candle(Date.UTC(2026, 8, 20), 100, 130, 99, 120);
  const mon = candle(Date.UTC(2026, 8, 21), 120, 121, 110, 115);

  it("FX/futures: a Sunday-session bar opens the NEW week and never pollutes last week's high", () => {
    const weeks = aggregateCandles([fri, sun, mon], "1w", { sundayOpensWeek: true });
    expect(weeks).toHaveLength(2);
    expect(weeks[0].high).toBe(101);
    expect(weeks[1].time).toBe(Date.UTC(2026, 8, 21));
    expect(weeks[1].open).toBe(100);
    expect(weeks[1].high).toBe(130);
  });

  it("crypto keeps the Monday–Sunday UTC week", () => {
    const weeks = aggregateCandles([fri, sun, mon], "1w");
    expect(weeks[0].high).toBe(130);
    expect(weeks[1].high).toBe(121);
  });
});

describe("New York-close daily (FX/futures CRT Candle 1)", () => {
  const HOUR = 60 * 60 * 1000;
  // Hourly bars from Wed 2026-09-23 18:00 UTC to Thu 23:00 UTC (EDT: 17:00 NY = 21:00 UTC).
  const start = Date.UTC(2026, 8, 23, 18);
  const h1 = Array.from({ length: 30 }, (_, i) => {
    const time = start + i * HOUR;
    // A spike at 22:00 UTC Wed (= Thursday's NY session) must land in Thursday's candle.
    const high = time === Date.UTC(2026, 8, 23, 22) ? 150 : 101;
    return { time, open: 100, high, low: 99, close: 100, volume: 1, closed: true };
  });

  it("buckets 17:00 NY -> 17:00 NY, not UTC midnight", () => {
    const days = aggregateCandles(h1, "1d");
    expect(days.map((d) => d.time)).toEqual([Date.UTC(2026, 8, 22, 21), Date.UTC(2026, 8, 23, 21), Date.UTC(2026, 8, 24, 21)]);
    expect(days[1].high).toBe(150); // the evening spike belongs to the NEXT trade day
    expect(days[0].high).toBe(101);
  });

  it("a NY session opening the evening before still counts in its trade week / month", () => {
    // Session for Thu 2026-10-01 opens Wed 2026-09-30 21:00 UTC -> October, not September.
    const oct1 = candle(Date.UTC(2026, 8, 30, 21), 100, 200, 99, 100);
    const sep30 = candle(Date.UTC(2026, 8, 29, 21), 100, 101, 99, 100);
    const months = aggregateCandles([sep30, oct1], "1M");
    expect(months.map((m) => m.time)).toEqual([Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1)]);
    expect(months[1].high).toBe(200);
    // Monday's session opens Sunday 21:00 UTC -> same week as the rest of Mon-Fri.
    const monSession = candle(Date.UTC(2026, 8, 20, 21), 100, 120, 99, 100);
    const friSession = candle(Date.UTC(2026, 8, 24, 21), 100, 101, 99, 100);
    const lastFri = candle(Date.UTC(2026, 8, 17, 21), 100, 101, 99, 100);
    const weeks = aggregateCandles([lastFri, monSession, friSession], "1w", { sundayOpensWeek: true });
    expect(weeks).toHaveLength(2);
    expect(weeks[1].high).toBe(120);
  });

  it("nyCloseDaily keeps Yahoo's old bars and replaces the 1h-covered days", async () => {
    const { nyCloseDaily } = await import("../lib/data/yahooProvider");
    const yahoo = [candle(Date.UTC(2026, 8, 22), 1, 2, 0.5, 1), candle(Date.UTC(2026, 8, 23), 1, 2, 0.5, 1), candle(Date.UTC(2026, 8, 24), 1, 2, 0.5, 1)];
    const merged = nyCloseDaily(yahoo, h1);
    // First 1h bucket (partial, Wed session) dropped; Thu + Fri sessions rebuilt from 1h.
    expect(merged.map((d) => d.time)).toEqual([Date.UTC(2026, 8, 22), Date.UTC(2026, 8, 23), Date.UTC(2026, 8, 23, 21), Date.UTC(2026, 8, 24, 21)]);
    expect(merged[2].high).toBe(150);
  });
});
