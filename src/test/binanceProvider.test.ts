import { describe, expect, it } from "vitest";
import { binanceSymbolFor, isBinanceSymbol, parseBinanceKlines } from "../lib/data/binanceProvider";

describe("Binance crypto provider", () => {
  it("maps crypto symbols to Binance USDT pairs and leaves non-crypto unmapped", () => {
    expect(binanceSymbolFor("BTCUSD")).toBe("BTCUSDT");
    expect(binanceSymbolFor("SOLUSD")).toBe("SOLUSDT");
    expect(binanceSymbolFor("EURUSD")).toBeUndefined();
    expect(isBinanceSymbol("ETHUSD")).toBe(true);
    expect(isBinanceSymbol("XAUUSD")).toBe(false);
  });

  it("parses klines to sorted candles and flags the forming candle as not closed", () => {
    const now = 1_000_000 + 15 * 60 * 1000 * 2; // iki 15m mum sonrası
    const klines = [
      [1_000_000, "100", "110", "95", "105", "12.5", 1_000_000 + 15 * 60 * 1000 - 1],
      // en güncel mum henüz kapanmadı (openTime + 15m > now değil ama sınırda): kapanmamış olan
      [1_000_000 + 15 * 60 * 1000 * 2, "105", "115", "104", "112", "8", 0]
    ];
    const candles = parseBinanceKlines(klines, "15m", now);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ time: 1_000_000, open: 100, high: 110, low: 95, close: 105, volume: 12.5, closed: true });
    expect(candles[1].closed).toBe(false); // forming
    expect(candles[0].time).toBeLessThan(candles[1].time);
  });

  it("ignores malformed rows and non-array payloads", () => {
    expect(parseBinanceKlines(null, "15m")).toEqual([]);
    expect(parseBinanceKlines([[1, "x", "y"]], "15m")).toEqual([]);
  });
});
