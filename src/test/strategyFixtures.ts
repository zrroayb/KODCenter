import type { Candle, MarketContext } from "../lib/ict/types";
import { buildCrtContext } from "../lib/intelligence/crtEngine";

function makeExecutionCandles(): Candle[] {
  const now = Date.UTC(2026, 5, 30, 12, 0);
  return Array.from({ length: 24 }, (_, index) => ({
    time: now + index * 15 * 60 * 1000,
    open: 100,
    high: 100.4,
    low: 99.6,
    close: 100,
    volume: 1000 + index
  }));
}

const bearishRead = {
  bias: "bearish" as const,
  pattern: "downtrend" as const,
  confidence: "moderate" as const,
  reasons: ["fixture: LH + LL downtrend"]
};

export function createStructureContext(overrides: Partial<MarketContext> = {}): MarketContext {
  const candles = makeExecutionCandles();
  const base: MarketContext = {
    symbol: "XAUUSD",
    timeframes: {
      monthly: candles,
      weekly: candles,
      daily: candles,
      h4: candles,
      h1: candles,
      m15: candles,
      m5: candles
    },
    bias: {
      monthly: "bearish",
      weekly: "bearish",
      daily: "bearish",
      h4: "bearish",
      h1: "bearish"
    },
    biasDetail: {
      monthly: bearishRead,
      weekly: bearishRead,
      daily: bearishRead,
      h4: bearishRead,
      h1: bearishRead
    },
    dealingRange: {
      high: 105,
      low: 95,
      midpoint: 100,
      source: "Synthetic range"
    },
    premiumDiscount: {
      zone: "premium",
      positionPct: 0.7,
      midpoint: 100
    },
    killzones: [
      { name: "New York AM", active: true, startHourUtc: 12, endHourUtc: 15 }
    ],
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 95, label: "Sell-side", strength: "strong" }
    ],
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 105, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ],
    sweeps: [],
    swingPoints: [
      { side: "low", level: 99, candleIndex: 8, strength: "minor" },
      { side: "high", level: 101, candleIndex: 16, strength: "minor" }
    ],
    judasSwings: [],
    displacements: [],
    marketStructureShifts: [],
    fairValueGaps: [],
    orderBlocks: [],
    retracement: {
      direction: "neutral",
      currentPct: 0,
      deepestPct: 0,
      summary: "Fixture retracement neutral."
    },
    smtDivergences: [],
    volatility: {
      atr: 1,
      averageRange: 1
    },
    regime: {
      type: "range",
      tradeability: "good",
      scoreImpact: 6,
      efficiency: 0.2,
      volatilityRatio: 1,
      rangePosition: "middle",
      summary: "Fixture range regime.",
      warnings: []
    },
    eventRisk: {
      level: "clear",
      noTrade: false,
      activeEvents: [],
      upcomingEvents: [],
      summary: "Fixture event clear.",
      warnings: []
    },
    dataConfidence: {
      score: 90,
      grade: "A",
      stale: false,
      source: "mid-only",
      summary: "Fixture data confidence.",
      warnings: []
    },
    dataFeed: {
      source: "mid-only",
      executionPrice: "mid",
      note: "fixture"
    },
    crt: buildCrtContext({
      monthly: candles,
      weekly: candles,
      daily: candles,
      h4: candles,
      fairValueGaps: [],
      orderBlocks: []
    })
  };

  const mergedFairValueGaps = overrides.fairValueGaps ?? base.fairValueGaps;
  const mergedOrderBlocks = overrides.orderBlocks ?? base.orderBlocks;
  const mergedTimeframes = {
    ...base.timeframes,
    ...overrides.timeframes
  };

  return {
    ...base,
    ...overrides,
    timeframes: mergedTimeframes,
    bias: {
      ...base.bias,
      ...overrides.bias
    },
    fairValueGaps: mergedFairValueGaps,
    orderBlocks: mergedOrderBlocks,
    crt: overrides.crt ?? buildCrtContext({
      monthly: mergedTimeframes.monthly,
      weekly: mergedTimeframes.weekly,
      daily: mergedTimeframes.daily,
      h4: mergedTimeframes.h4,
      fairValueGaps: mergedFairValueGaps,
      orderBlocks: mergedOrderBlocks
    })
  };
}

// A REAL CRT setup for pipeline tests (replaces the legacy KOD fixture, 2026-10-10): XAUUSD 4H
// range 95-101, C2 sweeps the high (buy-side) and closes back inside, 15m ChoCH + FVG retest,
// PDH/PDL key levels, all HTF bearish. The live CRT engine returns a confirmed SHORT: READY at the
// default exit RR (DOL net RR ~2.2), WATCH when the exit RR floor is set above that.
export function createCrtShortContext(): MarketContext {
  const base = createStructureContext();
  const h4 = base.timeframes.h4.map((candle, index) =>
    index === 21 ? { ...candle, open: 100, high: 101, low: 95, close: 99 }
      : index === 22 ? { ...candle, open: 99, high: 101.15, low: 96, close: 100.2 }
        : index === 23 ? { ...candle, open: 96.2, high: 96.5, low: 95.5, close: 95.9 }
          : candle);
  const mapped = base.timeframes.m15.map((candle, index) =>
    index === 18 ? { ...candle, low: 99.4 }
      : index === 21 ? { ...candle, open: 100.4, high: 100.8, low: 99.9, close: 100.6 }
        : index === 22 ? { ...candle, open: 100.8, high: 101.15, low: 100.2, close: 100.5 }
          : index === 23 ? { ...candle, open: 100.5, high: 100.6, low: 99.1, close: 99.3 }
            : candle);
  const last = mapped[mapped.length - 1];
  const m15 = [
    ...mapped,
    { ...last, time: last.time + 15 * 60 * 1000, open: 99.3, high: 99.8, low: 99.1, close: 99.4 },
    { ...last, time: last.time + 30 * 60 * 1000, open: 99.5, high: 100, low: 99.3, close: 99.7 }
  ];
  return createStructureContext({
    timeframes: { ...base.timeframes, m15, m5: m15, h4 },
    dealingRange: { high: 105, low: 90, midpoint: 97.5, source: "fixture" },
    premiumDiscount: { zone: "premium", positionPct: 0.72, midpoint: 97.5 },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 90, label: "Sell-side", strength: "strong" }
    ],
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 101.4, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101.3, candleIndex: 22, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
  });
}

// The CRT signal from createCrtShortContext. exitMinimumRR above ~2.2 turns the same setup WATCH.
export async function createCrtSignal(options: { exitMinimumRR?: number; context?: MarketContext } = {}) {
  const { crtStrategy } = await import("../lib/strategies/crt/crt.strategy");
  const context = options.context ?? createCrtShortContext();
  const signal = crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, exitMinimumRR: options.exitMinimumRR ?? 1, useExecutionCosts: false }
  }).signals.find((item) => item.crtAnchor?.rangeTf === "4h" && item.direction === "short");
  if (!signal) throw new Error("CRT fixture produced no 4H short signal");
  return signal;
}
