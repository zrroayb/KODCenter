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

  it("marks the live Yahoo bucket as forming instead of treating its quote as a closed candle", () => {
    const now = Date.UTC(2026, 6, 12, 17, 39);
    const candles = parseYahooChartResponse({
      chart: {
        result: [{
          timestamp: [
            Date.UTC(2026, 6, 12, 17, 15) / 1000,
            Date.UTC(2026, 6, 12, 17, 28, 21) / 1000
          ],
          indicators: { quote: [{ open: [100, 101], high: [102, 103], low: [99, 100], close: [101, 102], volume: [10, 5] }] }
        }]
      }
    }, "15m", now);

    expect(candles.map((candle) => candle.closed)).toEqual([true, false]);
  });
});
