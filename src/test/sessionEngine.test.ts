import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import type { Candle, MarketContext, TradingSignal } from "../lib/ict/types";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { sessionProfileForSymbol } from "../lib/session/profiles";
import { buildSessionSetups } from "../lib/session/sessionConfluenceEngine";
import { buildProfileSessionClock, buildSessionOccurrences, buildSessionRanges } from "../lib/session/sessionRangeEngine";
import { reconcileSessionSetupStore } from "../lib/session/sessionSetupStore";

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

describe("CRT × session confluence", () => {
  it("confirms Asia low sweep -> reclaim -> bullish displacement symmetrically", () => {
    const candles = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.102, 1.099, 1.1002),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1002, 1.1008, 1.0992, 1.1001),
      candle(Date.UTC(2026, 6, 16, 6, 0), 1.1, 1.1004, 1.0984, 1.0994),
      candle(Date.UTC(2026, 6, 16, 6, 15), 1.0994, 1.1015, 1.0993, 1.1013)
    ];
    const context = contextWithM15(candles, "bullish");
    const setups = buildSessionSetups({
      contexts: [context],
      signals: [readySignal(context, "long")],
      now: Date.UTC(2026, 6, 16, 6, 30)
    });
    const setup = setups.find((item) => item.setupModel === "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT");
    expect(setup?.sweptSide).toBe("LOW");
    expect(setup?.lifecycleStatus).toBe("CONFIRMED");
    expect(setup?.direction).toBe("long");
    expect(setup?.events.find((event) => event.kind === "reclaim")?.status).toBe("pass");
  });

  it("confirms the inverse Asia high sweep bearish model", () => {
    const candles = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.102, 1.099, 1.1002),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1002, 1.1008, 1.0992, 1.1001),
      candle(Date.UTC(2026, 6, 16, 6, 0), 1.1, 1.1028, 1.0998, 1.1015),
      candle(Date.UTC(2026, 6, 16, 6, 15), 1.1015, 1.1016, 1.0991, 1.0992)
    ];
    const context = contextWithM15(candles, "bearish");
    const setups = buildSessionSetups({
      contexts: [context],
      signals: [readySignal(context, "short")],
      now: Date.UTC(2026, 6, 16, 6, 30)
    });
    const setup = setups.find((item) => item.setupModel === "ASIA_RANGE_LONDON_HIGH_SWEEP_BEARISH_CRT");
    expect(setup?.sweptSide).toBe("HIGH");
    expect(setup?.lifecycleStatus).toBe("CONFIRMED");
    expect(setup?.direction).toBe("short");
  });

  it("does not promote a level touch directly to confirmed", () => {
    const candles = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.101, 1.099, 1.1002),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1002, 1.1008, 1.0992, 1.1001),
      candle(Date.UTC(2026, 6, 16, 6, 0), 1.1, 1.1014, 1.1008, 1.1012)
    ];
    const context = contextWithM15(candles, "bearish");
    const setup = buildSessionSetups({ contexts: [context], signals: [], now: Date.UTC(2026, 6, 16, 6, 15) })[0];
    expect(setup?.lifecycleStatus).not.toBe("CONFIRMED");
    expect(setup?.blockers.length).toBeGreaterThan(0);
  });

  it("creates separate PD liquidity and previous-HTF setup families only after a session sweep", () => {
    const candles = [
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.102, 1.099, 1.1002),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1002, 1.1008, 1.0992, 1.1001),
      candle(Date.UTC(2026, 6, 16, 6, 0), 1.1, 1.1004, 1.0984, 1.0994),
      candle(Date.UTC(2026, 6, 16, 6, 15), 1.0994, 1.1015, 1.0993, 1.1013)
    ];
    const base = contextWithM15(candles, "bullish");
    const context = {
      ...base,
      timeframes: {
        ...base.timeframes,
        daily: [candle(Date.UTC(2026, 6, 15), 1.1, 1.102, 1.099, 1.1005)]
      }
    };
    const signal = {
      ...readySignal(context, "long"),
      crtAnchor: {
        rangeTf: "4h",
        confirmTf: "15m",
        raidActive: true,
        raidClosed: false,
        rangeHigh: 1.102,
        rangeLow: 1.099
      }
    } as TradingSignal;
    const setups = buildSessionSetups({
      contexts: [context],
      signals: [signal],
      now: Date.UTC(2026, 6, 16, 6, 30)
    });
    expect(setups.some((setup) => setup.setupModel === "PDL_SESSION_SWEEP_BULLISH_CRT")).toBe(true);
    expect(setups.some((setup) => setup.setupModel === "PREV_HTF_LOW_SESSION_SWEEP_BULLISH_CRT")).toBe(true);
  });

  it("writes only one idempotent log for the same lifecycle transition", () => {
    const context = contextWithM15([
      candle(Date.UTC(2026, 6, 15, 23, 0), 1.1, 1.101, 1.099, 1.1002),
      candle(Date.UTC(2026, 6, 16, 3, 45), 1.1002, 1.1008, 1.0992, 1.1001)
    ], "bullish");
    const incoming = buildSessionSetups({ contexts: [context], signals: [], now: Date.UTC(2026, 6, 16, 5) });
    const first = reconcileSessionSetupStore([], incoming, []);
    const second = reconcileSessionSetupStore(first.setups, incoming, first.logs);
    expect(second.logs.length).toBe(first.logs.length);
    expect(new Set(second.logs.map((log) => log.id)).size).toBe(second.logs.length);
  });
});
