import type { DemoMarket } from "../../data/demoData";
import type { Candle, MarketSymbol } from "../ict/types";
import type { MarketDataLoadResult, MarketDataSource, MarketFeedMode } from "./yahooProvider";

export type DataHealthStatus = "ok" | "warning" | "error";

export type DataHealthRow = {
  symbol: MarketSymbol;
  source: MarketDataSource;
  feedMode: MarketFeedMode;
  latest: Record<"m5" | "m15" | "h1" | "h4" | "daily", number | undefined>;
  counts: Record<"m5" | "m15" | "h1" | "h4" | "daily", number>;
  maxLagMinutes: number;
  executionLagMinutes: number;
  htfAgeMinutes: number;
  maxIntradayLagMinutes: number;
  dailyAgeMinutes: number;
  issues: string[];
};

export type DataHealthReport = {
  status: DataHealthStatus;
  source: MarketDataSource;
  feedMode: MarketFeedMode;
  loadedAt: number;
  rows: DataHealthRow[];
  issues: string[];
};

const MAX_LAG_MINUTES = {
  m5: 20,
  m15: 45,
  h1: 180,
  h4: 720,
  daily: 60 * 60
};

function latestTime(candles: Candle[]): number | undefined {
  return candles[candles.length - 1]?.time;
}

function lagMinutes(time: number | undefined, now: number): number {
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((now - time) / 60_000));
}

function issueForTimeframe(label: keyof typeof MAX_LAG_MINUTES, candles: Candle[], now: number): string | undefined {
  if (candles.length < 20) return `${label}: candle sayısı düşük (${candles.length})`;
  const lag = lagMinutes(latestTime(candles), now);
  if (lag > MAX_LAG_MINUTES[label]) return `${label}: veri gecikmiş (${lag} dk)`;
  return undefined;
}

export function buildDataHealthReport(markets: DemoMarket[], state: Omit<MarketDataLoadResult, "markets">, now = Date.now()): DataHealthReport {
  const rows = markets.map((market) => {
    const latest = {
      m5: latestTime(market.timeframes.m5),
      m15: latestTime(market.timeframes.m15),
      h1: latestTime(market.timeframes.h1),
      h4: latestTime(market.timeframes.h4),
      daily: latestTime(market.timeframes.daily)
    };
    const counts = {
      m5: market.timeframes.m5.length,
      m15: market.timeframes.m15.length,
      h1: market.timeframes.h1.length,
      h4: market.timeframes.h4.length,
      daily: market.timeframes.daily.length
    };
    const source: MarketDataSource = state.errors.some((error) => error.startsWith(`${market.symbol}:`)) ? "demo" : state.source;
    const feedMode: MarketFeedMode = source === "demo" ? "demo" : state.feedMode;
    const issues = [
      issueForTimeframe("m5", market.timeframes.m5, now),
      issueForTimeframe("m15", market.timeframes.m15, now),
      issueForTimeframe("h1", market.timeframes.h1, now),
      issueForTimeframe("h4", market.timeframes.h4, now),
      issueForTimeframe("daily", market.timeframes.daily, now)
    ].filter((issue): issue is string => Boolean(issue));
    const executionLagMinutes = Math.max(...[latest.m5, latest.m15].map((time) => lagMinutes(time, now)));
    const htfAgeMinutes = Math.max(...[latest.h1, latest.h4].map((time) => lagMinutes(time, now)));
    const maxIntradayLagMinutes = Math.max(executionLagMinutes, htfAgeMinutes);
    const dailyAgeMinutes = lagMinutes(latest.daily, now);
    const maxLagMinutes = Math.max(maxIntradayLagMinutes, dailyAgeMinutes);
    return {
      symbol: market.symbol,
      source,
      feedMode,
      latest,
      counts,
      maxLagMinutes,
      executionLagMinutes,
      htfAgeMinutes,
      maxIntradayLagMinutes,
      dailyAgeMinutes,
      issues
    };
  });

  const issues = [...state.errors, ...rows.flatMap((row) => row.issues.map((issue) => `${row.symbol}: ${issue}`))];
  const status: DataHealthStatus = state.source === "demo"
    ? "error"
    : issues.length || state.source === "mixed"
      ? "warning"
      : "ok";

  return {
    status,
    source: state.source,
    feedMode: state.feedMode,
    loadedAt: state.loadedAt,
    rows,
    issues
  };
}
