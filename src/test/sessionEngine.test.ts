import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import type { Candle, MarketContext, TradingSignal } from "../lib/ict/types";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { sessionProfileForSymbol } from "../lib/session/profiles";
import { buildProfileSessionClock, buildSessionOccurrences, buildSessionRanges } from "../lib/session/sessionRangeEngine";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1_000, closed: true };
}

function contextWithM15(candles: Candle[], direction: "bullish" | "bearish"): MarketContext {
  const market = createDemoMarkets(Date.UTC(2026, 6, 16, 9))[2];
  const context = buildMarketContext(market.symbol, { ...market.timeframes, m15: candles });
  return {
    ...context,
    timeframes: { ...context.timeframes, m15: candles },
    bias: {
      monthly: direction,
      weekly: direction,
      daily: direction,
      h4: direction,
      h1: direction
    }
  };
}

function readySignal(context: MarketContext, direction: "long" | "short"): TradingSignal {
  const entry = direction === "long" ? 1.1005 : 1.0995;
  const stop = direction === "long" ? 1.098 : 1.102;
  return {
    id: `${context.symbol}-${direction}-session-fixture`,
    symbol: context.symbol,
    direction,
    stage: "ready",
    score: 82,
    grade: "A",
    timeframe: "15m",
    createdAt: Date.UTC(2026, 6, 16, 7, 0),
    strategyId: "crt",
    context,
    evidence: [{ id: "choch", label: "ChoCH", status: "pass", detail: "confirmed", timeframe: "15m" }],
    plan: {
      entry,
      entrySource: "poi-retest",
      entryStatus: "confirmed",
      entryModel: {
        source: "poi-retest",
        status: "confirmed",
        level: entry,
        retested: true,
        cisdConfirmed: true,
        warnings: []
      },
      stopLoss: stop,
      targets: direction === "long" ? [1.102, 1.104] : [1.098, 1.096],
      invalidation: stop,
      rr: 2,
      grossRR: 2.2,
      riskDistance: Math.abs(entry - stop),
      stopSource: "manipulation",
      stopBuffer: 0.0002,
      targetSource: "crt-dol",
      executionCosts: {
        stress: "normal",
        spread: 0,
        slippage: 0,
        commission: 0,
        total: 0,
        grossReward: 0.0035,
        netReward: 0.0035,
        riskAfterCosts: Math.abs(entry - stop)
      },
      planWarnings: []
    }
  } as unknown as TradingSignal;
}

describe("CRT session foundation", () => {
  it("converts London profiles with IANA DST instead of a fixed UTC offset", () => {
    const profile = sessionProfileForSymbol("EURUSD");
    const summer = buildSessionOccurrences(profile, [], Date.UTC(2026, 6, 16, 12))
      .find((item) => item.session === "LONDON" && item.localDate === "2026-07-16");
    const winter = buildSessionOccurrences(profile, [], Date.UTC(2026, 0, 16, 12))
      .find((item) => item.session === "LONDON" && item.localDate === "2026-01-16");
    expect(new Date(summer!.startsAt).getUTCHours()).toBe(6);
    expect(new Date(winter!.startsAt).getUTCHours()).toBe(7);
    expect(buildProfileSessionClock("EURUSD", Date.UTC(2026, 6, 16, 6, 30)).activeSession).toBe("London");
  });

  it("keeps a midnight-crossing Asia range under one stable trading day", () => {
    const profile = sessionProfileForSymbol("EURUSD");
    const candles = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.101, 1.099, 1.1005),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1005, 1.102, 1.0985, 1.101)
    ];
    const context = contextWithM15(candles, "bullish");
    const ranges = buildSessionRanges(context, profile, Date.UTC(2026, 6, 16, 4, 15));
    const asia = ranges.find((item) => item.session === "ASIA" && item.localDate === "2026-07-15");
    expect(asia?.state).toBe("LOCKED");
    expect(asia?.candleCount).toBe(2);
    expect(asia?.tradingDayId.endsWith("2026-07-16")).toBe(true);
  });

  it("freezes a locked range and ignores later candles outside its window", () => {
    const profile = sessionProfileForSymbol("EURUSD");
    const asia = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.101, 1.099, 1.1005),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1005, 1.102, 1.0985, 1.101)
    ];
    const before = buildSessionRanges(contextWithM15(asia, "bullish"), profile, Date.UTC(2026, 6, 16, 4, 15))
      .find((item) => item.session === "ASIA" && item.localDate === "2026-07-15");
    const after = buildSessionRanges(
      contextWithM15([...asia, candle(Date.UTC(2026, 6, 16, 6, 0), 1.1, 1.2, 0.9, 1.15)], "bullish"),
      profile,
      Date.UTC(2026, 6, 16, 6, 15)
    ).find((item) => item.session === "ASIA" && item.localDate === "2026-07-15");
    expect(after?.high).toBe(before?.high);
    expect(after?.low).toBe(before?.low);
  });
});
