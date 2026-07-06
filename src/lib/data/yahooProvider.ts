import { createDemoMarkets, type DemoMarket } from "../../data/demoData";
import { aggregateCandles, trimCandles } from "./candleAggregation";
import type { Candle, MarketSymbol } from "../ict/types";
import { enrichWithSyntheticBidAsk } from "./bidAsk";

export type MarketDataSource = "yahoo-live" | "mixed" | "demo";
export type MarketFeedMode = "synthetic-bid-ask" | "mid-only" | "demo";

export type MarketDataLoadResult = {
  markets: DemoMarket[];
  source: MarketDataSource;
  feedMode: MarketFeedMode;
  loadedAt: number;
  errors: string[];
};

type YahooInterval = "5m" | "15m" | "1h" | "1d";
type YahooRange = "5d" | "60d" | "1y";

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

const YAHOO_SYMBOLS: Array<{ symbol: MarketSymbol; name: string; yahoo: string }> = [
  { symbol: "XAUUSD", name: "Gold Futures", yahoo: "GC=F" },
  { symbol: "NAS100", name: "Nasdaq 100 Futures", yahoo: "NQ=F" },
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

export function parseYahooChartResponse(payload: YahooChartResponse): Candle[] {
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

    candles.push({
      time: timestamp * 1000,
      open,
      high,
      low,
      close,
      volume: quote.volume?.[index] ?? 0
    });
  });

  return candles.sort((a, b) => a.time - b.time);
}

async function fetchYahooCandles(
  yahooSymbol: string,
  interval: YahooInterval,
  range: YahooRange,
  signal?: AbortSignal
): Promise<Candle[]> {
  const url = `/yahoo/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}&includePrePost=false`;
  const requestSignal = createTimeoutSignal(signal);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: requestSignal.signal });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 140).replace(/\s+/g, " ");
      throw new Error(`${yahooSymbol} ${interval}: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`);
    }
    return parseYahooChartResponse((await response.json()) as YahooChartResponse);
  } catch (error) {
    if (requestSignal.signal.aborted && !signal?.aborted) {
      throw new Error(`${yahooSymbol} ${interval}: provider timeout`);
    }
    throw error;
  } finally {
    requestSignal.cleanup();
  }
}

async function withRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function loadYahooMarket(item: (typeof YAHOO_SYMBOLS)[number], signal?: AbortSignal): Promise<DemoMarket> {
  const [m5, m15, h1, daily] = await Promise.all([
    withRetry(`${item.symbol} 5m`, () => fetchYahooCandles(item.yahoo, "5m", "5d", signal)),
    withRetry(`${item.symbol} 15m`, () => fetchYahooCandles(item.yahoo, "15m", "60d", signal)),
    withRetry(`${item.symbol} 1h`, () => fetchYahooCandles(item.yahoo, "1h", "60d", signal)),
    withRetry(`${item.symbol} 1d`, () => fetchYahooCandles(item.yahoo, "1d", "1y", signal))
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

export async function loadYahooMarkets(signal?: AbortSignal): Promise<MarketDataLoadResult> {
  const demoMarkets = createDemoMarkets();
  const demoBySymbol = new Map(demoMarkets.map((market) => [market.symbol, market]));
  const settled = await Promise.allSettled(YAHOO_SYMBOLS.map((item) => loadYahooMarket(item, signal)));
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
