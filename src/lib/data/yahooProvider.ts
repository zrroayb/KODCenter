import { isCryptoSymbol } from "../ict/symbols";
import { MARKET_SYMBOLS, SYMBOL_SPEC } from "../ict/symbolSpec";
import { createDemoMarkets, type DemoMarket } from "../../data/demoData";
import { aggregateCandles, trimCandles } from "./candleAggregation";
import type { Candle, MarketSymbol } from "../ict/types";
import { enrichWithSyntheticBidAsk } from "./bidAsk";
import { isBinanceSymbol, loadBinanceMarket } from "./binanceProvider";

// Sembol başına doğru sağlayıcı: kripto → Binance (gerçek borsa, taze), gerisi → Yahoo.
// Binance CORS `*` gönderir; hem tarayıcı hem node DOĞRUDAN data-api.binance.vision'a gider
// (proxy gerekmez). Binance başarısız
// olursa Yahoo'ya düşer — asla bugünkünden kötü olmaz (yalnızca bayat kalır).
// Tek sembol yükleyici + VERİ KAYNAĞI YÖNLENDİRİCİ. Kripto (isBinanceSymbol) → Binance (canlı,
// coğrafi engelsiz); Binance düşerse Yahoo'ya fallback. FX/metal/endeks → Yahoo. loadYahooMarketBatch
// ve loadYahooMarkets bunu kullandığı için, "Yahoo" isimli bu yükleyiciler kripto'yu yine de
// Binance'ten çeker — app, cloud-scan ve ölçüm scriptleri hepsi aynı yolu paylaşır.
async function loadMarketFor(
  item: YahooSymbolDefinition,
  signal?: AbortSignal,
  options: YahooRequestOptions = {}
): Promise<DemoMarket> {
  if (isBinanceSymbol(item.symbol)) {
    try {
      return await loadBinanceMarket(item.symbol, item.name, signal, {
        fetcher: options.fetcher,
        retryAttempts: options.retryAttempts
      });
    } catch {
      return loadYahooMarket(item, signal, options);
    }
  }
  return loadYahooMarket(item, signal, options);
}

export type MarketDataSource = "yahoo-live" | "mixed" | "demo";
export type MarketFeedMode = "synthetic-bid-ask" | "mid-only" | "demo";

export type MarketDataLoadResult = {
  markets: DemoMarket[];
  source: MarketDataSource;
  feedMode: MarketFeedMode;
  loadedAt: number;
  errors: string[];
};

export type YahooInterval = "5m" | "15m" | "1h" | "1d";
export type YahooRange = "5d" | "60d" | "1y" | "2y";

const YAHOO_INTERVAL_MS: Record<YahooInterval, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

type YahooChartResponse = {
  chart?: {
    error?: { code?: string; description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
};

export type YahooSymbolDefinition = {
  symbol: MarketSymbol;
  name: string;
  yahoo: string;
};

export const YAHOO_SYMBOLS: YahooSymbolDefinition[] = MARKET_SYMBOLS.map((symbol) => ({
  symbol,
  name: SYMBOL_SPEC[symbol].name,
  yahoo: SYMBOL_SPEC[symbol].yahoo
}));

function createTimeoutSignal(parentSignal?: AbortSignal, timeoutMs = 7_000) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

export function parseYahooChartResponse(payload: YahooChartResponse, interval?: YahooInterval, now = Date.now()): Candle[] {
  const error = payload.chart?.error;
  if (error) {
    throw new Error(error.description || error.code || "Yahoo chart error");
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || !timestamps.length) return [];

  // Yahoo intraday serilerinin sonuna, oluşmakta olan mumun yanına HİZASIZ bir "şu an"
  // (regularMarketTime) barı ekliyor — ör. 14:00 saatlik mumu VARKEN bir de 14:36 barı. Bu, 1h/15m/5m
  // serisini kirletir (mükerrer/hizasız mum). Her timestamp'i kendi interval kovasına snap edip aynı
  // kovadaki barları birleştirerek temizleriz: hizalı barlar (%interval==0) yerinde kalır, hizasız
  // trailing bar doğru kovaya (14:00) merge olur. interval yoksa (ham) eski davranış korunur.
  const intervalMs = interval ? YAHOO_INTERVAL_MS[interval] : undefined;
  const byBucket = new Map<number, Candle>();
  const rawCandles: Candle[] = [];
  timestamps.forEach((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) return;

    const time = timestamp * 1000;
    const volume = quote.volume?.[index] ?? 0;
    if (intervalMs == null) {
      rawCandles.push({ time, open, high, low, close, volume });
      return;
    }
    // Daily bars: Yahoo stamps them at the exchange's local midnight (e.g. 23:00 UTC for a
    // London-midnight FX bar in summer, 04:00 UTC for NY futures). Flooring pushed a 23:00 UTC
    // stamp onto the PREVIOUS date (Monday's bar became "Sunday" and joined last week). Round to
    // the nearest UTC midnight so the bar keeps its trade date.
    const bucket = interval === "1d" ? Math.round(time / intervalMs) * intervalMs : Math.floor(time / intervalMs) * intervalMs;
    const existing = byBucket.get(bucket);
    if (existing) {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.close = close;                    // timestamp artan sırada → en son gelen kapanış
      existing.volume = (existing.volume ?? 0) + volume;
    } else {
      byBucket.set(bucket, { time: bucket, open, high, low, close, volume, closed: bucket + intervalMs <= now });
    }
  });

  const candles = intervalMs == null ? rawCandles : Array.from(byBucket.values());
  return candles.sort((a, b) => a.time - b.time);
}

type YahooRequestOptions = {
  fetcher?: typeof fetch;
  baseUrl?: string;
  retryAttempts?: number;
};

export async function fetchYahooCandles(
  yahooSymbol: string,
  interval: YahooInterval,
  range: YahooRange,
  signal?: AbortSignal,
  options: YahooRequestOptions = {}
): Promise<Candle[]> {
  const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? "/yahoo";
  const url = `${baseUrl}/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}&includePrePost=false`;
  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (/^https?:\/\//.test(baseUrl)) headers["User-Agent"] = "Mozilla/5.0";
  const requestSignal = createTimeoutSignal(signal);
  try {
    const response = await fetcher(url, {
      headers,
      signal: requestSignal.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 140).replace(/\s+/g, " ");
      throw new Error(`${yahooSymbol} ${interval}: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
    }
    return parseYahooChartResponse((await response.json()) as YahooChartResponse, interval);
  } catch (error) {
    if (requestSignal.signal.aborted && !signal?.aborted) {
      throw new Error(`${yahooSymbol} ${interval}: provider timeout`);
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

async function withRetry<T>(label: string, task: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// Daily series on the New York-close anchor: NY sessions rebuilt from 1h (the first bucket is
// dropped — the 1h window starts mid-session), Yahoo's own bars only before that.
export function nyCloseDaily(yahooDaily: Candle[], h1: Candle[]): Candle[] {
  const sessions = aggregateCandles(h1, "1d").slice(1);
  const first = sessions[0];
  if (!first) return yahooDaily;
  // Trade date of the first rebuilt session (its open is the previous evening, NY).
  const firstTradeDay = Math.floor((first.time + 12 * 60 * 60 * 1000) / YAHOO_INTERVAL_MS["1d"]) * YAHOO_INTERVAL_MS["1d"];
  return [...yahooDaily.filter((candle) => candle.time < firstTradeDay), ...sessions];
}

export async function loadYahooMarket(
  item: YahooSymbolDefinition,
  signal?: AbortSignal,
  options: YahooRequestOptions = {}
): Promise<DemoMarket> {
  const attempts = options.retryAttempts ?? 2;
  const [m5, m15, h1, daily] = await Promise.all([
    withRetry(`${item.symbol} 5m`, () => fetchYahooCandles(item.yahoo, "5m", "5d", signal, options), attempts),
    withRetry(`${item.symbol} 15m`, () => fetchYahooCandles(item.yahoo, "15m", "60d", signal, options), attempts),
    withRetry(`${item.symbol} 1h`, () => fetchYahooCandles(item.yahoo, "1h", "60d", signal, options), attempts),
    // 2y: aylık seri günlükten türetiliyor; 1y yalnız ~12 aylık mum veriyordu ve yapı
    // motoru aylıkta wing-3 swing bulamayıp wing-1 gürültüsüne düşüyordu (~25 ay yeterli).
    withRetry(`${item.symbol} 1d`, () => fetchYahooCandles(item.yahoo, "1d", "2y", signal, options), attempts)
  ]);

  if ((!m15.length && !m5.length) || !h1.length || !daily.length) {
    throw new Error(`${item.symbol}: Yahoo eksik candle döndürdü`);
  }

  // CRT reads the daily candle off a New York-close chart (17:00 NY), the same anchor as the 4H
  // series. Yahoo's 1d bar is a London/UTC day, so its high/low is a DIFFERENT Candle 1. Rebuild
  // every day the 1h feed covers on the NY anchor; older history (weekly/monthly depth only)
  // keeps Yahoo's bars.
  const nyDaily = isCryptoSymbol(item.symbol) ? daily : nyCloseDaily(daily, h1);

  return {
    symbol: item.symbol,
    name: item.name,
    timeframes: {
      monthly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(nyDaily, "1M"), 24), item.symbol),
      weekly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(nyDaily, "1w", { sundayOpensWeek: !isCryptoSymbol(item.symbol) }), 80), item.symbol),
      daily: enrichWithSyntheticBidAsk(trimCandles(nyDaily, 180), item.symbol),
      h4: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(h1, "4h"), 180), item.symbol),
      h1: enrichWithSyntheticBidAsk(trimCandles(h1, 780), item.symbol),
      m15: enrichWithSyntheticBidAsk(trimCandles(m15.length ? m15 : aggregateCandles(m5, "15m"), 3_000), item.symbol),
      m5: enrichWithSyntheticBidAsk(trimCandles(m5, 160), item.symbol)
    }
  };
}

export type YahooMarketBatchResult = {
  markets: DemoMarket[];
  errors: string[];
};

// İsim yanıltıcı: bu Yahoo-ONLY değildir. loadMarketFor üzerinden kripto'yu Binance'e, gerisini
// Yahoo'ya yönlendirir (baseUrl opsiyonu yalnız Yahoo yoluna geçer; kripto Binance default'unu kullanır).
export async function loadYahooMarketBatch(
  symbols: MarketSymbol[],
  options: YahooRequestOptions & { signal?: AbortSignal } = {}
): Promise<YahooMarketBatchResult> {
  const definitions = symbols
    .map((symbol) => YAHOO_SYMBOLS.find((item) => item.symbol === symbol))
    .filter((item): item is YahooSymbolDefinition => Boolean(item));
  const settled = await Promise.allSettled(
    definitions.map((item) => loadMarketFor(item, options.signal, options))
  );
  const markets: DemoMarket[] = [];
  const errors: string[] = [];

  settled.forEach((result, index) => {
    const symbol = definitions[index].symbol;
    if (result.status === "fulfilled") markets.push(result.value);
    else errors.push(`${symbol}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });

  return { markets, errors };
}

export async function loadYahooMarkets(signal?: AbortSignal): Promise<MarketDataLoadResult> {
  const demoMarkets = createDemoMarkets();
  const demoBySymbol = new Map(demoMarkets.map((market) => [market.symbol, market]));
  const settled = await Promise.allSettled(YAHOO_SYMBOLS.map((item) => loadMarketFor(item, signal)));
  const errors: string[] = [];
  const markets = settled.map((result, index) => {
    const symbol = YAHOO_SYMBOLS[index].symbol;
    if (result.status === "fulfilled") return result.value;
    errors.push(`${symbol}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return demoBySymbol.get(symbol) ?? demoMarkets[index];
  });

  const failedCount = settled.filter((result) => result.status === "rejected").length;
  return {
    markets,
    source: failedCount === 0 ? "yahoo-live" : failedCount === settled.length ? "demo" : "mixed",
    feedMode: failedCount === settled.length ? "demo" : "synthetic-bid-ask",
    loadedAt: Date.now(),
    errors
  };
}
