import type { Candle, ICTBias } from "../ict/types";

// LEGACY (2026-07-22'ye kadar tek HTF bias kaynağıydı): 8 mumluk kapanış farkı + HH/LL kontrolü.
// Yapı analizi değil sürüklenme ölçümüdür ve matematiksel olarak neredeyse hiç "neutral"
// dönemez — bu yüzden yerini `detectStructuralBias` aldı. Karşılaştırma/regresyon için durur.
export function detectDriftBias(candles: Candle[]): ICTBias {
  if (candles.length < 8) return "neutral";
  const recent = candles.slice(-8);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const higherHigh = last.high > Math.max(...recent.slice(0, -1).map((candle) => candle.high));
  const lowerLow = last.low < Math.min(...recent.slice(0, -1).map((candle) => candle.low));
  if (last.close > first.close && higherHigh) return "bullish";
  if (last.close < first.close && lowerLow) return "bearish";
  if (last.close > first.close) return "bullish";
  if (last.close < first.close) return "bearish";
  return "neutral";
}
