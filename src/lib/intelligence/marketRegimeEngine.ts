import type { Candle, MarketRegimeContext } from "../ict/types";

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function candleRange(candle: Candle): number {
  return Math.max(0, candle.high - candle.low);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function classifyMarketRegime(candles: Candle[]): MarketRegimeContext {
  const sample = candles.slice(-36);
  if (sample.length < 18) {
    return {
      type: "chop",
      tradeability: "blocked",
      scoreImpact: -18,
      efficiency: 0,
      volatilityRatio: 0,
      rangePosition: "middle",
      summary: "Rejim okunamıyor: candle sayısı düşük.",
      warnings: ["Rejim filtresi için yeterli candle yok."]
    };
  }

  const latest = sample[sample.length - 1];
  const ranges = sample.map(candleRange);
  const avgRange = average(ranges.slice(0, -1));
  const latestRange = candleRange(latest);
  const volatilityRatio = avgRange > 0 ? latestRange / avgRange : 1;
  const netMove = Math.abs(latest.close - sample[0].open);
  const path = sample.slice(1).reduce((sum, candle, index) => sum + Math.abs(candle.close - sample[index].close), 0);
  const efficiency = path > 0 ? clamp(netMove / path, 0, 1) : 0;
  const high = Math.max(...sample.map((candle) => candle.high));
  const low = Math.min(...sample.map((candle) => candle.low));
  const width = Math.max(high - low, avgRange || 1);
  const positionPct = clamp((latest.close - low) / width, 0, 1);
  const rangePosition = positionPct > 0.66 ? "upper" : positionPct < 0.34 ? "lower" : "middle";
  const lastThreeExpansion = ranges.slice(-3).some((range) => avgRange > 0 && range / avgRange >= 2.4);

  if (lastThreeExpansion && volatilityRatio >= 1.8) {
    return {
      type: "news-expansion",
      tradeability: "blocked",
      scoreImpact: -22,
      efficiency,
      volatilityRatio,
      rangePosition,
      summary: "Ani expansion var; haber/spike ortamı gibi davranıyor.",
      warnings: ["Son mumlarda normalin çok üstünde range var; chase/late entry riski yüksek."]
    };
  }

  if (efficiency >= 0.52 && volatilityRatio <= 1.9) {
    return {
      type: "trend",
      tradeability: "caution",
      scoreImpact: -4,
      efficiency,
      volatilityRatio,
      rangePosition,
      summary: "Trend rejimi: reversal KOD için daha seçici olmak gerekir.",
      warnings: ["Trend gününde counter-sweep setup devam hareketine dönüşebilir."]
    };
  }

  if (efficiency <= 0.18 && volatilityRatio <= 0.85) {
    return {
      type: "chop",
      tradeability: "blocked",
      scoreImpact: -18,
      efficiency,
      volatilityRatio,
      rangePosition,
      summary: "Chop/low-energy rejim: fake MSS ve zayıf FVG riski yüksek.",
      warnings: ["Range dar ve yönsüz; temiz displacement gelmeden READY verilmez."]
    };
  }

  if (efficiency <= 0.32) {
    return {
      type: "range",
      tradeability: "good",
      scoreImpact: 6,
      efficiency,
      volatilityRatio,
      rangePosition,
      summary: "Range rejimi: liquidity sweep ve mean reversion için uygun.",
      warnings: []
    };
  }

  return {
    type: "post-sweep-continuation",
    tradeability: "caution",
    scoreImpact: -6,
    efficiency,
    volatilityRatio,
    rangePosition,
    summary: "Orta momentum rejimi: sweep sonrası continuation riski kontrol edilmeli.",
    warnings: ["Momentum nötr değil; entry gecikirse setup kovalanmamalı."]
  };
}
