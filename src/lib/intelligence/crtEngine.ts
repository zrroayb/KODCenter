import type { Candle, CrtBiasContext, CrtContext, CrtPoi, DealingRange, FairValueGap, MarketContext, OrderBlock, Timeframe, TradeDirection } from "../ict/types";
import { buildDealingRange } from "./rangeEngine";

type CrtRangeTimeframe = Extract<Timeframe, "1M" | "1w" | "1d" | "4h" | "1h">;

function latestPair(candles: Candle[]): [Candle, Candle] | undefined {
  if (candles.length < 2) return undefined;
  return [candles[candles.length - 2], candles[candles.length - 1]];
}

function neutralBias(timeframe: CrtRangeTimeframe, candles: Candle[]): CrtBiasContext {
  const latest = candles[candles.length - 1];
  const high = latest?.high ?? 0;
  const low = latest?.low ?? 0;
  return {
    timeframe,
    kind: "neutral",
    direction: "neutral",
    drawLevel: latest?.close ?? 0,
    drawSide: "none",
    rangeHigh: high,
    rangeLow: low,
    midpoint: (high + low) / 2,
    currentHigh: high,
    currentLow: low,
    strength: "weak",
    summary: `${timeframe} CRT bias neutral; kapanış previous range dışında değil.`
  };
}

export function buildCrtBias(candles: Candle[], timeframe: CrtRangeTimeframe): CrtBiasContext {
  const pair = latestPair(candles);
  if (!pair) return neutralBias(timeframe, candles);
  const [previous, current] = pair;
  const midpoint = (current.high + current.low) / 2;
  const base = {
    timeframe,
    rangeHigh: current.high,
    rangeLow: current.low,
    midpoint,
    previousHigh: previous.high,
    previousLow: previous.low,
    currentHigh: current.high,
    currentLow: current.low
  };

  if (current.close > previous.high) {
    return {
      ...base,
      kind: "bullish-continuation",
      direction: "long",
      drawLevel: current.high,
      drawSide: "buy-side",
      strength: "strong",
      summary: `${timeframe} close previous high üstünde; DOL current high.`
    };
  }
  if (current.close < previous.low) {
    return {
      ...base,
      kind: "bearish-continuation",
      direction: "short",
      drawLevel: current.low,
      drawSide: "sell-side",
      strength: "strong",
      summary: `${timeframe} close previous low altında; DOL current low.`
    };
  }
  if (current.high > previous.high && current.close < previous.high) {
    return {
      ...base,
      kind: "bearish-reversal",
      direction: "short",
      drawLevel: current.low,
      drawSide: "sell-side",
      strength: "strong",
      summary: `${timeframe} previous high sweep + altında kapanış; zayıflık, DOL current low.`
    };
  }
  if (current.low < previous.low && current.close > previous.low) {
    return {
      ...base,
      kind: "bullish-reversal",
      direction: "long",
      drawLevel: current.high,
      drawSide: "buy-side",
      strength: "strong",
      summary: `${timeframe} previous low sweep + üstünde kapanış; güç, DOL current high.`
    };
  }

  return {
    ...base,
    kind: "neutral",
    direction: "neutral",
    drawLevel: current.close,
    drawSide: "none",
    strength: "weak",
    summary: `${timeframe} CRT bias neutral; sweep/continuation kapanışı yok.`
  };
}

export function validCrtPullback(candles: Candle[], direction: TradeDirection | "neutral"): { valid: boolean; summary: string } {
  if (direction === "neutral" || candles.length < 5) {
    return { valid: false, summary: "Valid pullback için yeterli yönlü CRT range yok." };
  }
  const sample = candles.slice(-18);
  if (direction === "short") {
    const extremeIndex = sample.reduce((best, candle, index) => candle.high > sample[best].high ? index : best, 0);
    const extreme = sample[extremeIndex];
    const violated = sample.slice(extremeIndex + 1).some((candle) => candle.low < extreme.low);
    return {
      valid: violated,
      summary: violated
        ? "Bearish pullback valid: extreme high mumunun low'u ihlal edildi."
        : "Bearish pullback henüz valid değil: extreme high mumunun low'u kırılmadı."
    };
  }
  const extremeIndex = sample.reduce((best, candle, index) => candle.low < sample[best].low ? index : best, 0);
  const extreme = sample[extremeIndex];
  const violated = sample.slice(extremeIndex + 1).some((candle) => candle.high > extreme.high);
  return {
    valid: violated,
    summary: violated
      ? "Bullish pullback valid: extreme low mumunun high'ı ihlal edildi."
      : "Bullish pullback henüz valid değil: extreme low mumunun high'ı kırılmadı."
  };
}

function buildCrtRange(candles: Candle[]): DealingRange {
  // True CRT range: the previous closed HTF candle (3-candle model: range -> manipulation -> distribution).
  // The last candle is the live/manipulation candle and must not define the range.
  if (candles.length < 2) return buildDealingRange(candles, "CRT fallback dealing range");
  const rangeCandle = candles[candles.length - 2];
  return {
    high: rangeCandle.high,
    low: rangeCandle.low,
    midpoint: (rangeCandle.high + rangeCandle.low) / 2,
    source: "CRT range: previous closed candle"
  };
}

function poiFromGap(gap: FairValueGap): CrtPoi {
  return {
    type: gap.mitigated ? "breaker" : "fvg",
    direction: gap.direction,
    low: gap.low,
    high: gap.high,
    midpoint: gap.midpoint,
    candleIndex: gap.candleIndex,
    mitigated: gap.mitigated,
    label: gap.mitigated ? "Breaker / mitigated FVG" : "FVG"
  };
}

function poiFromOrderBlock(block: OrderBlock): CrtPoi {
  return {
    type: block.mitigated ? "breaker" : "ob",
    direction: block.direction,
    low: block.low,
    high: block.high,
    midpoint: block.midpoint,
    candleIndex: block.candleIndex,
    mitigated: block.mitigated,
    label: block.mitigated ? "Breaker Block" : "Order Block"
  };
}

function otePoi(range: DealingRange, direction: TradeDirection): CrtPoi {
  const span = Math.max(Math.abs(range.high - range.low), 0.000001);
  if (direction === "short") {
    return {
      type: "ote",
      direction,
      low: range.midpoint,
      high: range.high,
      midpoint: range.high - span * 0.25,
      mitigated: false,
      label: "OTE premium"
    };
  }
  return {
    type: "ote",
    direction,
    low: range.low,
    high: range.midpoint,
    midpoint: range.low + span * 0.25,
    mitigated: false,
    label: "OTE discount"
  };
}

export function buildCrtContext(input: {
  monthly: Candle[];
  weekly: Candle[];
  daily: Candle[];
  h4: Candle[];
  fairValueGaps: FairValueGap[];
  orderBlocks: OrderBlock[];
}): CrtContext {
  const macroBiases = [
    buildCrtBias(input.monthly, "1M"),
    buildCrtBias(input.weekly, "1w"),
    buildCrtBias(input.daily, "1d"),
    buildCrtBias(input.h4, "4h")
  ];
  // Setup timeframe drives direction (4h first); monthly/weekly act as confluence, not dictators.
  const selectedBias = [...macroBiases].reverse().find((bias) => bias.direction !== "neutral") ?? macroBiases[macroBiases.length - 1];
  const activeRange = buildCrtRange(input.h4.length >= 2 ? input.h4 : input.daily);
  const pullback = validCrtPullback(input.h4.length ? input.h4 : input.daily, selectedBias.direction);
  const direction = selectedBias.direction === "neutral" ? "long" : selectedBias.direction;
  const pois = [
    ...input.fairValueGaps.map(poiFromGap),
    ...input.orderBlocks.map(poiFromOrderBlock),
    otePoi(activeRange, direction)
  ];

  return {
    rangeTimeframe: input.h4.length ? "4h" : "1d",
    activeRange,
    selectedBias,
    macroBiases,
    validPullback: pullback.valid,
    pullbackSummary: pullback.summary,
    pois
  };
}

export function crtDirection(context: MarketContext): TradeDirection | undefined {
  return context.crt.selectedBias.direction === "neutral" ? undefined : context.crt.selectedBias.direction;
}
