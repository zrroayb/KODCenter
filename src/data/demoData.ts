import type { Candle, MarketSymbol } from "../lib/ict/types";
import { aggregateCandles, trimCandles } from "../lib/data/candleAggregation";
import { enrichWithSyntheticBidAsk } from "../lib/data/bidAsk";
import { buildMarketContext, type MarketTimeframes } from "../lib/intelligence/marketContext";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";

export type DemoMarket = {
  symbol: MarketSymbol;
  name: string;
  timeframes: MarketTimeframes;
};

const SYMBOLS: Array<{ symbol: MarketSymbol; name: string; base: number; trend: number }> = [
  { symbol: "XAUUSD", name: "Gold", base: 2348, trend: -0.18 },
  { symbol: "NAS100", name: "Nasdaq 100", base: 19980, trend: 7.5 },
  { symbol: "EURUSD", name: "Euro Dollar", base: 1.078, trend: -0.00008 },
  { symbol: "GBPUSD", name: "Pound Dollar", base: 1.268, trend: 0.00009 },
  { symbol: "BTCUSD", name: "Bitcoin", base: 67100, trend: 32 }
];

export function createDemoMarkets(now = Date.UTC(2026, 5, 30, 8, 45)): DemoMarket[] {
  return SYMBOLS.map((item, symbolIndex) => {
    const m5Base = candles(9000, now, 5 * 60 * 1000, item.base, item.trend * 0.12, symbolIndex, true);
    return {
      symbol: item.symbol,
      name: item.name,
      timeframes: {
        daily: enrichWithSyntheticBidAsk(candles(90, now, 24 * 60 * 60 * 1000, item.base, item.trend * 20, symbolIndex), item.symbol),
        h4: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(m5Base, "4h"), 180), item.symbol),
        h1: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(m5Base, "1h"), 780), item.symbol),
        m15: enrichWithSyntheticBidAsk(trimCandles(aggregateCandles(m5Base, "15m"), 3000), item.symbol),
        m5: enrichWithSyntheticBidAsk(trimCandles(m5Base, 320), item.symbol)
      }
    };
  });
}

export function createDemoContexts() {
  return attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)));
}

function candles(count: number, now: number, stepMs: number, base: number, trend: number, seed: number, forceSweep = false): Candle[] {
  const result: Candle[] = [];
  let previousClose = base;
  const bodyUnit = Math.max(Math.abs(trend) * 7, base * 0.00032);
  for (let index = 0; index < count; index += 1) {
    const impulse = Math.sin(index / 4.8 + seed) * bodyUnit * 0.52 + Math.cos(index / 8.5 + seed * 0.7) * bodyUnit * 0.28;
    const open = previousClose;
    const close = previousClose + trend + impulse * 0.28;
    const body = Math.abs(close - open);
    const spread = Math.max(body * 0.55, bodyUnit * 0.34);
    const high = Math.max(open, close) + spread * (0.75 + (index % 5) / 12);
    const low = Math.min(open, close) - spread * (0.72 + (index % 7) / 14);
    result.push({
      time: now - (count - index) * stepMs,
      open,
      high,
      low,
      close,
      volume: 1000 + index * 11 + seed * 37
    });
    previousClose = close;
  }
  if (forceSweep && result.length > 8) {
    const latest = result[result.length - 1];
    const previous = result.slice(-32, -1);
    const priorHigh = Math.max(...previous.map((candle) => candle.high));
    const priorLow = Math.min(...previous.map((candle) => candle.low));
    const bullishSweep = seed % 2 === 1;
    result[result.length - 1] = bullishSweep
      ? {
          ...latest,
          low: priorLow - Math.max(Math.abs(trend) * 2, latest.close * 0.0007),
          close: priorLow + Math.max(Math.abs(trend) * 4, latest.close * 0.0012),
          high: Math.max(latest.high, latest.close + Math.abs(trend) * 2)
        }
      : {
          ...latest,
          high: priorHigh + Math.max(Math.abs(trend) * 2, latest.close * 0.0007),
          close: priorHigh - Math.max(Math.abs(trend) * 4, latest.close * 0.0012),
          low: Math.min(latest.low, latest.close - Math.abs(trend) * 2)
        };
  }
  return result;
}
