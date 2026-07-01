import type { Candle, LiquidityPool, Sweep } from "../ict/types";
import { executableHigh, executableLow } from "../data/bidAsk";

function equalLiquidityPools(candles: Candle[]): LiquidityPool[] {
  const sample = candles.slice(-48);
  const pools: LiquidityPool[] = [];
  const averageRange = sample.reduce((sum, candle) => sum + Math.max(candle.high - candle.low, 0), 0) / Math.max(sample.length, 1);
  const lastClose = sample[sample.length - 1]?.close ?? 1;
  const tolerance = Math.max(averageRange * 0.08, Math.abs(lastClose) * 0.00003);

  for (let index = 2; index < sample.length - 2; index += 1) {
    const candle = sample[index];
    const nearby = sample.slice(Math.max(0, index - 5), Math.min(sample.length, index + 6));
    const equalHighs = nearby.filter((item) => Math.abs(item.high - candle.high) <= tolerance);
    const equalLows = nearby.filter((item) => Math.abs(item.low - candle.low) <= tolerance);

    if (equalHighs.length >= 3) {
      pools.push({
        id: `eqh-${Math.round(candle.high / tolerance)}`,
        side: "buy-side",
        level: candle.high,
        label: "Equal highs buy-side liquidity",
        strength: "moderate"
      });
    }
    if (equalLows.length >= 3) {
      pools.push({
        id: `eql-${Math.round(candle.low / tolerance)}`,
        side: "sell-side",
        level: candle.low,
        label: "Equal lows sell-side liquidity",
        strength: "moderate"
      });
    }
  }

  return pools.filter((pool, index) =>
    pools.findIndex((item) => item.side === pool.side && Math.abs(item.level - pool.level) <= tolerance) === index
  );
}

export function buildLiquidityPools(candles: Candle[], prefix = "range"): LiquidityPool[] {
  const sample = candles.slice(-32);
  const high = Math.max(...sample.map((candle) => candle.high));
  const low = Math.min(...sample.map((candle) => candle.low));
  return [
    { id: `${prefix}-buy-side-high`, side: "buy-side", level: high, label: "Buy-side liquidity above range high", strength: "strong" },
    { id: `${prefix}-sell-side-low`, side: "sell-side", level: low, label: "Sell-side liquidity below range low", strength: "strong" },
    ...equalLiquidityPools(candles)
  ];
}

export function detectSweeps(candles: Candle[], pools: LiquidityPool[]): Sweep[] {
  const latest = candles[candles.length - 1];
  const windowStart = Math.max(0, candles.length - 8);
  const recent = candles.slice(windowStart);
  const sweeps: Sweep[] = [];
  for (const pool of pools) {
    let touchOffset = -1;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const candle = recent[index];
      const touched = pool.side === "buy-side"
        ? executableHigh(candle, "buy") >= pool.level
        : executableLow(candle, "sell") <= pool.level;
      if (touched) {
        touchOffset = index;
        break;
      }
    }
    if (touchOffset < 0) continue;
    const reclaimed = pool.side === "buy-side" ? latest.close < pool.level : latest.close > pool.level;
    sweeps.push({
      side: pool.side,
      level: pool.level,
      candleIndex: windowStart + touchOffset,
      reclaimed
    });
  }
  return sweeps;
}
