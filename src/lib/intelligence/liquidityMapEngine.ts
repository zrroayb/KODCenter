import type { Candle, LiquidityPool, Sweep } from "../ict/types";
import { executableHigh, executableLow } from "../data/bidAsk";
import { detectSwingPoints } from "./structureEngine";

function equalLiquidityPools(candles: Candle[]): LiquidityPool[] {
  const sample = candles.slice(-48);
  const pools: LiquidityPool[] = [];
  if (sample.length < 8) return pools;
  const high = Math.max(...sample.map((candle) => candle.high));
  const low = Math.min(...sample.map((candle) => candle.low));
  const tolerance = Math.max((high - low) * 0.01, Math.abs(sample[sample.length - 1]?.close ?? 1) * 0.00003);
  const swings = detectSwingPoints(sample, 2, sample.length);

  for (const side of ["high", "low"] as const) {
    const candidates = swings.filter((point) => point.side === side);
    const used = new Set<number>();
    for (const point of candidates) {
      if (used.has(point.candleIndex)) continue;
      const group = candidates.filter((candidate) =>
        candidate.candleIndex >= point.candleIndex
        && Math.abs(candidate.level - point.level) <= tolerance
      );
      if (group.length < 2) continue;
      group.forEach((candidate) => used.add(candidate.candleIndex));
      const level = group.reduce((sum, candidate) => sum + candidate.level, 0) / group.length;
      const strong = group.length >= 3 ? "strong" : "moderate";

      pools.push({
        id: `${side === "high" ? "eqh" : "eql"}-${Math.round(level / tolerance)}`,
        side: side === "high" ? "buy-side" : "sell-side",
        level,
        label: side === "high" ? "Swing equal highs buy-side liquidity" : "Swing equal lows sell-side liquidity",
        strength: strong
      });
    }
  }

  return pools.filter((pool, index) =>
    pools.findIndex((item) => item.side === pool.side && Math.abs(item.level - pool.level) <= tolerance) === index
  );
}

export function buildLiquidityPools(candles: Candle[], prefix = "range"): LiquidityPool[] {
  const sample = candles.slice(-32);
  if (!sample.length) return [];
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
  if (!latest) return [];
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
