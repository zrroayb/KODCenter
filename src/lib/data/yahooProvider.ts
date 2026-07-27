import { createDemoMarkets, type DemoMarket } from "../../data/demoData";
import { aggregateCandles, trimCandles } from "./candleAggregation";
import type { Candle, MarketSymbol } from "../ict/types";
import { enrichWithSyntheticBidAsk } from "./bidAsk";
import { isBinanceSymbol, loadBinanceMarket } from "./binanceProvider";

// Sembol başına doğru sağlayıcı: kripto → Binance (gerçek borsa, taze), gerisi → Yahoo.
// Binance CORS `*` gönderir; hem tarayıcı hem node DOĞRUDAN data-api.binance.vision'a gider
// (worker proxy'sine gerek yok — Cloudflare egress IP'si Binance'te 403'lüydü). Binance başarısız
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
  background?: boolean;
  oldestLoadedAt?: number;
};

// Bot cache'i bundan eskiyse güvenilmez (bot ~5dk'da bir günceller); 20dk birkaç kaçan taramaya
// tolerans ama günlerce bayat cache'i reddeder → tarayıcı canlı çeker.
const CACHE_MAX_AGE_MS = 20 * 60 * 1000;

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

export const YAHOO_SYMBOLS: YahooSymbolDefinition[] = [
  { symbol: "XAUUSD", name: "Gold futures proxy · GC=F", yahoo: "GC=F" },
  { symbol: "NAS100", name: "Nasdaq futures proxy · NQ=F", yahoo: "NQ=F" },
  { symbol: "EURUSD", name: "Euro Dollar", yahoo: "EURUSD=X" },
  { symbol: "GBPUSD", name: "Pound Dollar", yahoo: "GBPUSD=X" },
  // Yahoo's canonical ticker for USD-base pairs drops the USD prefix ("JPY=X" is USD/JPY).
  { symbol: "USDJPY", name: "Dollar Yen", yahoo: "JPY=X" },
  { symbol: "AUDUSD", name: "Aussie Dollar", yahoo: "AUDUSD=X" },
  { symbol: "USDCHF", name: "Dollar Swiss", yahoo: "CHF=X" },
  { symbol: "BTCUSD", name: "Bitcoin", yahoo: "BTC-USD" },
  { symbol: "ETHUSD", name: "Ethereum", yahoo: "ETH-USD" },
  { symbol: "XRPUSD", name: "XRP", yahoo: "XRP-USD" },
  { symbol: "BNBUSD", name: "BNB", yahoo: "BNB-USD" },
  { symbol: "SOLUSD", name: "Solana", yahoo: "SOL-USD" }
];

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

  const candles: Candle[] = [];
  timestamps.forEach((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) return;

    const time = timestamp * 1000;
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: quote.volume?.[index] ?? 0,
      ...(interval ? { closed: time + YAHOO_INTERVAL_MS[interval] <= now } : {})
    });
  });

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

  return {
    symbol: item.symbol,
    name: item.name,
    timeframes: {
      monthly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(daily, "1M"), 24), item.symbol),
      weekly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(daily, "1w"), 80), item.symbol),
      daily: enrichWithSyntheticBidAsk(trimCandles(daily, 180), item.symbol),
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
  try {
    const cacheSignal = createTimeoutSignal(signal, 4_000);
    try {
      const response = await fetch("/api/live-markets", {
        headers: { Accept: "application/json" },
        signal: cacheSignal.signal
      });
      if (response.ok) {
        const cached = await response.json() as {
          markets?: DemoMarket[];
          loadedAt?: number;
          oldestLoadedAt?: number;
          background?: boolean;
          errors?: string[];
        };
        // Cache tazelik kapısı: bot her ~5dk günceller. loadedAt eskiyse (bot durmuşsa) cache'e
        // GÜVENME — düş ve canlı çek (FX/metal Yahoo, kripto Binance; ikisi de taze). Bu olmadan
        // 8 günlük bayat cache doğrudan gösteriliyordu ("Canlı bot" rozetiyle eski grafik).
        const cacheAgeMs = typeof cached.loadedAt === "number" ? Date.now() - cached.loadedAt : Infinity;
        const cacheFresh = cacheAgeMs <= CACHE_MAX_AGE_MS;
        if (cacheFresh && Array.isArray(cached.markets) && cached.markets.length === YAHOO_SYMBOLS.length) {
          const hydratedMarkets = cached.markets.map((market) => ({
            ...market,
            timeframes: {
              monthly: enrichWithSyntheticBidAsk(market.timeframes.monthly, market.symbol),
              weekly: enrichWithSyntheticBidAsk(market.timeframes.weekly, market.symbol),
              daily: enrichWithSyntheticBidAsk(market.timeframes.daily, market.symbol),
              h4: enrichWithSyntheticBidAsk(market.timeframes.h4, market.symbol),
              h1: enrichWithSyntheticBidAsk(market.timeframes.h1, market.symbol),
              m15: enrichWithSyntheticBidAsk(market.timeframes.m15, market.symbol),
              m5: enrichWithSyntheticBidAsk(market.timeframes.m5, market.symbol)
            }
          }));
          return {
            markets: hydratedMarkets,
            source: "yahoo-live",
            feedMode: "synthetic-bid-ask",
            loadedAt: typeof cached.loadedAt === "number" ? cached.loadedAt : Date.now(),
            errors: Array.isArray(cached.errors) ? cached.errors : [],
            background: cached.background === true,
            oldestLoadedAt: typeof cached.oldestLoadedAt === "number" ? cached.oldestLoadedAt : undefined
          };
        }
      }
    } finally {
      cacheSignal.cleanup();
    }
  } catch {
    // Local Vite and a newly-created cloud database have no cache yet; use the direct proxy.
  }

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
    errors,
    background: false
  };
}
