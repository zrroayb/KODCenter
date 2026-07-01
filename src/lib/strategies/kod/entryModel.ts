import type { Candle, EntrySource, EntryStatus, FairValueGap, MarketContext, TradeDirection, TradePlan } from "../../ict/types";

export type KodEntryModel = TradePlan["entryModel"];

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function latestSetupSweepIndex(context: MarketContext, direction: TradeDirection): number {
  const side = direction === "short" ? "buy-side" : "sell-side";
  const sweep = [...context.sweeps]
    .filter((item) => item.side === side && item.reclaimed)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  return sweep?.candleIndex ?? 0;
}

function belongsToCurrentSetup(gap: FairValueGap, setupIndex: number): boolean {
  return gap.candleIndex >= setupIndex - 2;
}

function latestDirectionalGap(context: MarketContext, direction: TradeDirection): FairValueGap | undefined {
  const setupIndex = latestSetupSweepIndex(context, direction);
  return [...context.fairValueGaps]
    .filter((gap) => gap.direction === direction && belongsToCurrentSetup(gap, setupIndex))
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function latestInverseGap(context: MarketContext, direction: TradeDirection): FairValueGap | undefined {
  const opposite = direction === "short" ? "long" : "short";
  const candles = executionCandles(context);
  const latest = candles[candles.length - 1];
  const setupIndex = latestSetupSweepIndex(context, direction);
  return [...context.fairValueGaps]
    .filter((gap) => {
      if (gap.direction !== opposite) return false;
      if (!belongsToCurrentSetup(gap, setupIndex)) return false;
      if (direction === "short") return latest.close < gap.low;
      return latest.close > gap.high;
    })
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function gapWasRetested(candles: Candle[], gap: FairValueGap): boolean {
  return candles.slice(gap.candleIndex + 1).some((candle) => candle.low <= gap.high && candle.high >= gap.low);
}

function latestCloseBreaksPreviousCandle(candles: Candle[], direction: TradeDirection): boolean {
  if (candles.length < 2) return false;
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  return direction === "short" ? latest.close < previous.low : latest.close > previous.high;
}

function hasMssOrCisd(context: MarketContext, direction: TradeDirection): boolean {
  return context.marketStructureShifts.some((shift) => shift.direction === direction)
    || latestCloseBreaksPreviousCandle(executionCandles(context), direction);
}

function statusFrom(retested: boolean, cisdConfirmed: boolean, fallback = false): EntryStatus {
  if (fallback) return "fallback";
  return retested && cisdConfirmed ? "confirmed" : "pending";
}

function warningsFor(input: { source: EntrySource; retested: boolean; cisdConfirmed: boolean; fallback?: boolean }): string[] {
  const warnings: string[] = [];
  if (input.fallback) warnings.push("FVG/iFVG entry map yok; MSS close fallback kullanıldı. READY değil.");
  if (!input.retested) warnings.push("Entry: FVG/iFVG retest bekleniyor.");
  if (!input.cisdConfirmed) warnings.push("Entry: MSS/CISD confirmation bekleniyor.");
  if (input.source === "ifvg-retest") warnings.push("Entry iFVG üzerinden map edildi; failure/retest temiz kalmalı.");
  return warnings;
}

export function buildKodEntryModel(context: MarketContext, direction: TradeDirection): KodEntryModel {
  const candles = executionCandles(context);
  const latest = candles[candles.length - 1];
  const cisdConfirmed = hasMssOrCisd(context, direction);
  const inverseGap = latestInverseGap(context, direction);
  const directionalGap = latestDirectionalGap(context, direction);
  const selectedGap = inverseGap ?? directionalGap;
  const source: EntrySource = inverseGap ? "ifvg-retest" : directionalGap ? "fvg-retest" : "mss-close";

  if (selectedGap) {
    const retested = gapWasRetested(candles, selectedGap);
    const status = statusFrom(retested, cisdConfirmed);
    return {
      source,
      status,
      level: selectedGap.midpoint,
      retested,
      cisdConfirmed,
      fairValueGap: selectedGap,
      warnings: warningsFor({ source, retested, cisdConfirmed })
    };
  }

  const fallbackConfirmed = cisdConfirmed && context.marketStructureShifts.some((shift) => shift.direction === direction);
  return {
    source: fallbackConfirmed ? "mss-close" : "fallback-close",
    status: fallbackConfirmed ? "pending" : "fallback",
    level: latest.close,
    retested: false,
    cisdConfirmed,
    warnings: warningsFor({ source: fallbackConfirmed ? "mss-close" : "fallback-close", retested: false, cisdConfirmed, fallback: true })
  };
}
