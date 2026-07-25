import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemoMarket } from "../data/demoData";
import { loadYahooMarkets, parseYahooChartResponse, YAHOO_SYMBOLS } from "../lib/data/yahooProvider";

describe("Yahoo data provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("prefers the Cloudflare candle cache and hydrates executable bid/ask candles", async () => {
    const candle = {
      time: Date.now() - 60_000,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 100,
      closed: true
    };
    const markets: DemoMarket[] = YAHOO_SYMBOLS.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      timeframes: {
        monthly: [candle],
        weekly: [candle],
        daily: [candle],
        h4: [candle],
        h1: [candle],
        m15: [candle],
        m5: [candle]
      }
    }));
    const freshLoadedAt = Date.now() - 60_000; // taze cache (bot ~5dk'da bir günceller)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      markets,
      loadedAt: freshLoadedAt,
      oldestLoadedAt: freshLoadedAt - 1_000,
      background: true,
      errors: []
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadYahooMarkets();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.background).toBe(true);
    expect(result.loadedAt).toBe(freshLoadedAt);
    expect(result.markets).toHaveLength(YAHOO_SYMBOLS.length);
    expect(result.markets[0].timeframes.m15[0].bid).toBeDefined();
    expect(result.markets[0].timeframes.m15[0].ask).toBeDefined();
  });

  it("rejects a stale bot cache and falls through to a live fetch (self-healing when the bot stops)", async () => {
    const staleMarkets: DemoMarket[] = YAHOO_SYMBOLS.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      timeframes: { monthly: [], weekly: [], daily: [], h4: [], h1: [], m15: [], m5: [] }
    }));
    // Cache 8 gün eski (bot durmuş): kabul edilmemeli. Fetch cache'i döner ama sonra canlı
    // provider'a düşülür — bu ortamda ağ yok, o yüzden demo'ya düşer; kanıt: background false.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      markets: staleMarkets,
      loadedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      background: true,
      errors: []
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadYahooMarkets();

    // Bayat cache reddedildi: sonuç "yahoo-live" değil (canlı/demo yola düştü), background değil.
    expect(result.background).not.toBe(true);
  });
});
