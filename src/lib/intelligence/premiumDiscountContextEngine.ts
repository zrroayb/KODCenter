import type { Candle, DealingRange, PremiumDiscountContext } from "../ict/types";

export function buildPremiumDiscountContext(candle: Candle, range: DealingRange): PremiumDiscountContext {
  const width = Math.max(range.high - range.low, 0.000001);
  const positionPct = ((candle.close - range.low) / width) * 100;
  const zone = positionPct >= 55 ? "premium" : positionPct <= 45 ? "discount" : "equilibrium";
  return {
    zone,
    positionPct: Math.round(positionPct * 10) / 10,
    midpoint: range.midpoint
  };
}
