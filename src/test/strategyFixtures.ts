import type { Candle, MarketContext } from "../lib/ict/types";

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

export function createStructureContext(overrides: Partial<MarketContext> = {}): MarketContext {
  const candles = makeExecutionCandles();
  const base: MarketContext = {
    symbol: "XAUUSD",
    timeframes: {
      daily: candles,
      h4: candles,
      h1: candles,
      m15: candles,
      m5: candles
    },
    bias: {
      daily: "bearish",
      h4: "bearish",
      h1: "bearish"
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
    }
  };

  return {
    ...base,
    ...overrides,
    timeframes: {
      ...base.timeframes,
      ...overrides.timeframes
    },
    bias: {
      ...base.bias,
      ...overrides.bias
    }
  };
}
