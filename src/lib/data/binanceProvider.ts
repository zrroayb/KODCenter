import { type DemoMarket } from "../../data/demoData";
import { aggregateCandles, trimCandles } from "./candleAggregation";
import type { Candle, MarketSymbol } from "../ict/types";
import { enrichWithSyntheticBidAsk } from "./bidAsk";
import { isCryptoSymbol } from "../ict/symbols";

// Kripto için gerçek borsa verisi (Binance). Yahoo'nun ücretsiz kripto feed'i ~3.8 saat bayat
// döndürüyordu (ölçüldü 2026-07-24: 5 kriptonun tümü 226 dk geride, FX/futures tazeyken).
// `data-api.binance.vision` Binance'in coğrafi engelsiz PUBLIC market-data ucu — key istemez,
// 7/24 canlı. FX/metal/endeks Yahoo'da kalır (onlar zaten taze). Hata olursa çağıran Yahoo'ya düşer.

const BINANCE_INTERVAL_MS: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

// Uygulama sembolü → Binance sembolü. Binance USDT paritelerini kullanır (USD ≈ USDT spot).
const BINANCE_SYMBOLS: Partial<Record<MarketSymbol, string>> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XRPUSD: "XRPUSDT",
  BNBUSD: "BNBUSDT",
  SOLUSD: "SOLUSDT"
};

export function binanceSymbolFor(symbol: MarketSymbol): string | undefined {
  return BINANCE_SYMBOLS[symbol];
}

export function isBinanceSymbol(symbol: MarketSymbol): boolean {
  return isCryptoSymbol(symbol) && Boolean(BINANCE_SYMBOLS[symbol]);
}

type BinanceRequestOptions = {
  fetcher?: typeof fetch;
  baseUrl?: string;
  retryAttempts?: number;
};

// Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]. OHLCV string gelir.
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

export function parseBinanceKlines(payload: unknown, interval: string, now = Date.now()): Candle[] {
  if (!Array.isArray(payload)) return [];
  const candles: Candle[] = [];
  for (const row of payload as BinanceKline[]) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    const intervalMs = BINANCE_INTERVAL_MS[interval] ?? 0;
    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      ...(intervalMs ? { closed: time + intervalMs <= now } : {})
    });
  }
  return candles.sort((a, b) => a.time - b.time);
}

async function fetchBinanceCandles(
  binanceSymbol: string,
  interval: string,
  limit: number,
  signal?: AbortSignal,
  options: BinanceRequestOptions = {}
): Promise<Candle[]> {
  const fetcher = options.fetcher ?? fetch;
  // Binance `access-control-allow-origin: *` gönderdiği için tarayıcı DOĞRUDAN çekebilir — worker
  // proxy'sine gerek yok (Cloudflare egress IP'si zaten 403 yiyordu, kullanıcının IP'si engelsiz).
  const baseUrl = options.baseUrl?.replace(/\/+$/, "") ?? "https://data-api.binance.vision";
  const url = `${baseUrl}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
  const response = await fetcher(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Binance ${binanceSymbol} ${interval}: HTTP ${response.status}`);
  return parseBinanceKlines(await response.json(), interval);
}

async function withRetry<T>(label: string, task: () => Promise<T>, attempts: number): Promise<T> {
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

// Binance limit'i istek başına 1000. Tek istekle: 15m≈10gün, 1h≈41gün, 1d≈2.7yıl — CRT'nin
// tazelik/lookback pencereleri için fazlasıyla yeterli (sayfalama gerekmiyor). Aylık/haftalık/4h
// Yahoo ile BİREBİR aynı şekilde günlük/1h'ten türetilir ki yapı motoru tutarlı kalsın.
export async function loadBinanceMarket(
  symbol: MarketSymbol,
  name: string,
  signal?: AbortSignal,
  options: BinanceRequestOptions = {}
): Promise<DemoMarket> {
  const binanceSymbol = BINANCE_SYMBOLS[symbol];
  if (!binanceSymbol) throw new Error(`${symbol}: Binance sembolü tanımlı değil`);
  const attempts = options.retryAttempts ?? 2;
  const [m5, m15, h1, daily] = await Promise.all([
    withRetry(`${symbol} 5m`, () => fetchBinanceCandles(binanceSymbol, "5m", 500, signal, options), attempts),
    withRetry(`${symbol} 15m`, () => fetchBinanceCandles(binanceSymbol, "15m", 1000, signal, options), attempts),
    withRetry(`${symbol} 1h`, () => fetchBinanceCandles(binanceSymbol, "1h", 1000, signal, options), attempts),
    withRetry(`${symbol} 1d`, () => fetchBinanceCandles(binanceSymbol, "1d", 1000, signal, options), attempts)
  ]);

  if (!m15.length || !h1.length || !daily.length) {
    throw new Error(`${symbol}: Binance eksik candle döndürdü`);
  }

  return {
    symbol,
    name,
    timeframes: {
      monthly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(daily, "1M"), 24), symbol),
      weekly: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(daily, "1w"), 80), symbol),
      daily: enrichWithSyntheticBidAsk(trimCandles(daily, 180), symbol),
      h4: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(h1, "4h"), 180), symbol),
      h1: enrichWithSyntheticBidAsk(trimCandles(h1, 780), symbol),
      m15: enrichWithSyntheticBidAsk(trimCandles(m15, 3_000), symbol),
      m5: enrichWithSyntheticBidAsk(trimCandles(m5, 160), symbol)
    }
  };
}
