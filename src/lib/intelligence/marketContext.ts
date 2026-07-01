import { latestClosed } from "../ict/candles";
import type { Candle, MarketContext, MarketSymbol } from "../ict/types";
import { detectBias } from "./biasEngine";
import { buildKillzoneContext } from "./killzoneContextEngine";
import { buildLiquidityPools, detectSweeps } from "./liquidityMapEngine";
import { buildLiquidityObjectives } from "./liquidityObjectives";
import { buildPremiumDiscountContext } from "./premiumDiscountContextEngine";
import { buildDealingRange } from "./rangeEngine";
import { detectDisplacements, detectFairValueGaps, detectMarketStructureShifts } from "./structureEngine";
import { buildVolatilityContext } from "./volatilityEngine";

export type MarketTimeframes = {
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
  const feed = latest.feed ?? "mid-only";
  return {
    symbol,
    timeframes,
    bias: {
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
    judasSwings: sweeps.map((sweep) => ({
      direction: sweep.side === "buy-side" ? "short" : "long",
      session: buildKillzoneContext(latest.time).find((zone) => zone.active)?.name ?? "Outside",
      sweepLevel: sweep.level
    })),
    displacements: detectDisplacements(execution),
    marketStructureShifts: detectMarketStructureShifts(execution),
    fairValueGaps: detectFairValueGaps(execution),
    smtDivergences: [],
    volatility: buildVolatilityContext(execution),
    dataFeed: {
      source: feed,
      executionPrice: feed === "broker-bid-ask" || feed === "synthetic-bid-ask" ? "bid-ask" : "mid",
      note: feed === "synthetic-bid-ask"
        ? "Yahoo mid candles with modeled bid/ask spread."
        : feed === "broker-bid-ask"
          ? "Broker bid/ask candles."
          : "Mid-only candles; executable bid/ask not available."
    }
  };
}
