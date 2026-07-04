import { latestClosed } from "../ict/candles";
import type { Candle, MarketContext, MarketSymbol } from "../ict/types";
import { buildCrtContext } from "./crtEngine";
import { detectBias } from "./biasEngine";
import { buildDataConfidence } from "./dataConfidenceEngine";
import { buildEventRisk } from "./eventRiskEngine";
import { buildKillzoneContext } from "./killzoneContextEngine";
import { buildLiquidityPools, detectSweeps } from "./liquidityMapEngine";
import { buildLiquidityObjectives } from "./liquidityObjectives";
import { classifyMarketRegime } from "./marketRegimeEngine";
import { buildPremiumDiscountContext } from "./premiumDiscountContextEngine";
import { buildDealingRange } from "./rangeEngine";
import { buildRetracementContext, detectDisplacements, detectFairValueGaps, detectMarketStructureShifts, detectOrderBlocks, detectSwingPoints } from "./structureEngine";
import { buildVolatilityContext } from "./volatilityEngine";

export type MarketTimeframes = {
  monthly: Candle[];
  weekly: Candle[];
  daily: Candle[];
  h4: Candle[];
  h1: Candle[];
  m15: Candle[];
  m5: Candle[];
};

export function buildMarketContext(symbol: MarketSymbol, timeframes: MarketTimeframes): MarketContext {
  const execution = timeframes.m15.length ? timeframes.m15 : timeframes.m5;
  const latest = latestClosed(execution);
  const dealingRange = buildDealingRange(timeframes.h4.length ? timeframes.h4 : execution, "Active H4 dealing range");
  const liquidityObjectives = buildLiquidityObjectives(timeframes.daily, dealingRange);
  const objectivePools = liquidityObjectives.map((objective) => ({
    id: objective.id,
    side: objective.side,
    level: objective.level,
    label: objective.label,
    strength: objective.strength
  }));
  const liquidityPools = [
    ...buildLiquidityPools(timeframes.h4.length ? timeframes.h4 : execution, "h4"),
    ...buildLiquidityPools(execution, "exec"),
    ...objectivePools
  ];
  const sweeps = detectSweeps(execution, liquidityPools);
  const swingPoints = detectSwingPoints(execution);
  const marketStructureShifts = detectMarketStructureShifts(execution);
  const orderBlocks = detectOrderBlocks(execution, swingPoints);
  const fairValueGaps = detectFairValueGaps(execution);
  const retracement = buildRetracementContext(execution, swingPoints);
  const feed = latest.feed ?? "mid-only";
  const dataFeed = {
    source: feed,
    executionPrice: feed === "broker-bid-ask" || feed === "synthetic-bid-ask" ? "bid-ask" as const : "mid" as const,
    note: feed === "synthetic-bid-ask"
      ? "Yahoo mid candles with modeled bid/ask spread."
      : feed === "broker-bid-ask"
        ? "Broker bid/ask candles."
        : feed === "demo"
          ? "Demo/fallback candles."
          : "Mid-only candles; executable bid/ask not available."
  };
  return {
    symbol,
    timeframes,
    bias: {
      monthly: detectBias(timeframes.monthly),
      weekly: detectBias(timeframes.weekly),
      daily: detectBias(timeframes.daily),
      h4: detectBias(timeframes.h4),
      h1: detectBias(timeframes.h1)
    },
    dealingRange,
    premiumDiscount: buildPremiumDiscountContext(latest, dealingRange),
    killzones: buildKillzoneContext(latest.time),
    liquidityPools,
    liquidityObjectives,
    sweeps,
    swingPoints,
    judasSwings: sweeps.map((sweep) => ({
      direction: sweep.side === "buy-side" ? "short" : "long",
      session: buildKillzoneContext(latest.time).find((zone) => zone.active)?.name ?? "Outside",
      sweepLevel: sweep.level
    })),
    displacements: detectDisplacements(execution),
    marketStructureShifts,
    fairValueGaps,
    orderBlocks,
    retracement,
    smtDivergences: [],
    volatility: buildVolatilityContext(execution),
    regime: classifyMarketRegime(execution),
    eventRisk: buildEventRisk(symbol, latest.time),
    dataConfidence: buildDataConfidence({ timeframes, dataFeed, now: latest.time }),
    dataFeed,
    crt: buildCrtContext({
      monthly: timeframes.monthly,
      weekly: timeframes.weekly,
      daily: timeframes.daily,
      h4: timeframes.h4,
      fairValueGaps,
      orderBlocks
    })
  };
}
