import { describe, expect, it } from "vitest";
import { parseYahooChartResponse } from "../lib/data/yahooProvider";

describe("Yahoo data provider", () => {
  it("parses valid OHLC candles and skips incomplete Yahoo points", () => {
    const candles = parseYahooChartResponse({
      chart: {
        result: [
          {
            timestamp: [1_718_000_000, 1_718_000_300],
            indicators: {
              quote: [
                {
                  open: [2300, null],
                  high: [2310, 2312],
                  low: [2295, 2298],
                  close: [2306, 2308],
                  volume: [null, 250]
                }
              ]
            }
          }
        ]
      }
    });

    expect(candles).toEqual([
      {
        time: 1_718_000_000_000,
        open: 2300,
        high: 2310,
        low: 2295,
        close: 2306,
        volume: 0
      }
    ]);
  });

  it("surfaces Yahoo chart errors", () => {
    expect(() =>
      parseYahooChartResponse({
        chart: {
          error: { code: "Not Found", description: "No data found" }
        }
      })
    ).toThrow("No data found");
  });

  it("merges Yahoo's misaligned regularMarketTime quote into its interval bucket (no spurious bar)", () => {
    // now = 17:39 → current 15m bucket 17:30-17:45. Yahoo appends a misaligned "now" quote (17:38:21)
    // in that same bucket; it must MERGE into the forming 17:30 candle, not become a separate bar.
    const now = Date.UTC(2026, 6, 12, 17, 39);
    const candles = parseYahooChartResponse({
      chart: {
        result: [{
          timestamp: [
            Date.UTC(2026, 6, 12, 17, 15) / 1000,       // closed bucket
            Date.UTC(2026, 6, 12, 17, 30) / 1000,       // current bucket start (forming)
            Date.UTC(2026, 6, 12, 17, 38, 21) / 1000    // misaligned regularMarketTime quote, same bucket
          ],
          indicators: { quote: [{ open: [100, 101, 101.5], high: [102, 103, 104], low: [99, 100, 100.5], close: [101, 102, 103], volume: [10, 5, 3] }] }
        }]
      }
    }, "15m", now);

    expect(candles).toHaveLength(2);                                        // 3 timestamps -> 2 buckets
    expect(candles.map((candle) => candle.closed)).toEqual([true, false]);
    expect(candles.every((candle) => candle.time % (15 * 60 * 1000) === 0)).toBe(true); // hepsi hizalı
    expect(candles[1].time).toBe(Date.UTC(2026, 6, 12, 17, 30));
    expect(candles[1].open).toBe(101);   // kova ilk barın open'ı
    expect(candles[1].high).toBe(104);   // merge: max high
    expect(candles[1].close).toBe(103);  // merge: son quote'un close'u
    expect(candles[1].volume).toBe(8);   // merge: hacim toplamı
  });
});

describe("Yahoo daily bar dates", () => {
  it("keeps a London-midnight FX daily stamp (23:00 UTC in summer) on its own trade date", () => {
    const mondayLondonMidnight = Date.UTC(2026, 8, 20, 23, 0) / 1000; // Mon 21 Sep 00:00 BST
    const candles = parseYahooChartResponse({
      chart: { result: [{ timestamp: [mondayLondonMidnight], indicators: { quote: [{ open: [1], high: [2], low: [0.5], close: [1.5], volume: [0] }] } }] }
    }, "1d", Date.UTC(2026, 8, 25));
    expect(candles[0].time).toBe(Date.UTC(2026, 8, 21));
  });
});
