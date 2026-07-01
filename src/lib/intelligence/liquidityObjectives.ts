import { aggregateCandles } from "../data/candleAggregation";
import { highestHigh, lowestLow } from "../ict/candles";
import type { Candle, DealingRange, LiquidityObjective } from "../ict/types";

function objective(
  kind: LiquidityObjective["kind"],
  side: LiquidityObjective["side"],
  level: number,
  timeframe: LiquidityObjective["timeframe"],
  source: string,
  strength: LiquidityObjective["strength"] = "strong"
): LiquidityObjective {
  return {
    id: `${kind}-${timeframe}-${level.toFixed(5)}`,
    kind,
    side,
    level,
    label: `${kind} ${side === "buy-side" ? "buy-side liquidity" : "sell-side liquidity"}`,
    timeframe,
    source,
    strength
  };
}

function previousClosed(candles: Candle[]): Candle | undefined {
  return candles.length >= 2 ? candles[candles.length - 2] : undefined;
}

function previousRange(candles: Candle[], timeframe: "1w" | "1M"): Candle | undefined {
  const aggregated = aggregateCandles(candles, timeframe);
  return previousClosed(aggregated);
}

export function buildLiquidityObjectives(dailyCandles: Candle[], dealingRange: DealingRange): LiquidityObjective[] {
  const objectives: LiquidityObjective[] = [];
  const previousDay = previousClosed(dailyCandles);
  const previousWeek = previousRange(dailyCandles, "1w");
  const previousMonth = previousRange(dailyCandles, "1M");

  if (previousDay) {
    objectives.push(objective("PDH", "buy-side", previousDay.high, "1d", "Previous daily high"));
    objectives.push(objective("PDL", "sell-side", previousDay.low, "1d", "Previous daily low"));
  }
  if (previousWeek) {
    objectives.push(objective("PWH", "buy-side", previousWeek.high, "1w", "Previous weekly high"));
    objectives.push(objective("PWL", "sell-side", previousWeek.low, "1w", "Previous weekly low"));
  } else if (dailyCandles.length >= 6) {
    const weekFallback = dailyCandles.slice(-6, -1);
    objectives.push(objective("PWH", "buy-side", highestHigh(weekFallback), "1w", "Previous week fallback from daily candles", "moderate"));
    objectives.push(objective("PWL", "sell-side", lowestLow(weekFallback), "1w", "Previous week fallback from daily candles", "moderate"));
  }
  if (previousMonth) {
    objectives.push(objective("PMH", "buy-side", previousMonth.high, "1M", "Previous monthly high"));
    objectives.push(objective("PML", "sell-side", previousMonth.low, "1M", "Previous monthly low"));
  } else if (dailyCandles.length >= 22) {
    const monthFallback = dailyCandles.slice(-22, -1);
    objectives.push(objective("PMH", "buy-side", highestHigh(monthFallback), "1M", "Previous month fallback from daily candles", "moderate"));
    objectives.push(objective("PML", "sell-side", lowestLow(monthFallback), "1M", "Previous month fallback from daily candles", "moderate"));
  }

  objectives.push(objective("DRH", "buy-side", dealingRange.high, "4h", dealingRange.source, "moderate"));
  objectives.push(objective("DRL", "sell-side", dealingRange.low, "4h", dealingRange.source, "moderate"));

  return objectives.filter((item, index) =>
    objectives.findIndex((candidate) => candidate.kind === item.kind && Math.abs(candidate.level - item.level) < Math.abs(item.level || 1) * 0.000001) === index
  );
}
