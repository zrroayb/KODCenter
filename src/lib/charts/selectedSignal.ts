import type { Displacement, FairValueGap, JudasSwing, MarketStructureShift, SmtDivergence, Sweep, TradingSignal } from "../ict/types";

export type FocusedTimeRange = {
  from: number;
  to: number;
};

export type SelectedSignalState = {
  selectedSignalId: string | null;
  focusedTimeRange?: FocusedTimeRange;
  showSelectedSignalOnly: boolean;
};

export type SelectedSignalAnnotations = {
  sweep?: Sweep;
  displacement?: Displacement;
  marketStructureShift?: MarketStructureShift;
  fairValueGap?: FairValueGap;
  smtDivergence?: SmtDivergence;
  judasSwing?: JudasSwing;
};

function executionCandles(signal: TradingSignal) {
  return signal.context.timeframes.m15.length ? signal.context.timeframes.m15 : signal.context.timeframes.m5;
}

function expectedSweepSide(signal: TradingSignal): Sweep["side"] {
  return signal.direction === "short" ? "buy-side" : "sell-side";
}

function latestByIndex<T extends { candleIndex: number }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function planFairValueGap(signal: TradingSignal): FairValueGap | undefined {
  return signal.plan.entryModel.fairValueGap;
}

export function selectedSignalAnnotations(signal: TradingSignal): SelectedSignalAnnotations {
  const sweepSide = expectedSweepSide(signal);

  return {
    sweep: latestByIndex(signal.context.sweeps.filter((sweep) => sweep.side === sweepSide && sweep.reclaimed)) ?? latestByIndex(signal.context.sweeps),
    displacement: latestByIndex(signal.context.displacements.filter((item) => item.direction === signal.direction)),
    marketStructureShift: latestByIndex(signal.context.marketStructureShifts.filter((item) => item.direction === signal.direction)),
    fairValueGap: planFairValueGap(signal),
    smtDivergence: latestByIndex(signal.context.smtDivergences.filter((item) => item.direction === signal.direction)),
    judasSwing: signal.context.judasSwings.find((item) => item.direction === signal.direction)
  };
}

export function signalAnchorIndex(signal: TradingSignal): number {
  const annotations = selectedSignalAnnotations(signal);
  const indexes = [
    annotations.sweep?.candleIndex,
    annotations.displacement?.candleIndex,
    annotations.marketStructureShift?.candleIndex,
    annotations.fairValueGap?.candleIndex,
    annotations.smtDivergence?.candleIndex
  ].filter((index): index is number => typeof index === "number");
  return indexes.length ? Math.max(...indexes) : executionCandles(signal).length - 1;
}

export function signalAnchorTime(signal: TradingSignal): number {
  const candles = executionCandles(signal);
  return candles[Math.min(Math.max(signalAnchorIndex(signal), 0), candles.length - 1)]?.time ?? signal.createdAt;
}

export function focusChartOnSignal(signal: TradingSignal, paddingCandles = 30): FocusedTimeRange {
  const candles = executionCandles(signal);
  if (candles.length === 0) {
    return {
      from: signal.createdAt - paddingCandles * 15 * 60 * 1000,
      to: signal.createdAt + 50 * 15 * 60 * 1000
    };
  }

  const annotations = selectedSignalAnnotations(signal);
  const indexes = [
    annotations.sweep?.candleIndex,
    annotations.displacement?.candleIndex,
    annotations.marketStructureShift?.candleIndex,
    annotations.fairValueGap?.candleIndex,
    annotations.smtDivergence?.candleIndex,
    candles.length - 1
  ].filter((index): index is number => typeof index === "number");

  const first = Math.max(0, Math.min(...indexes) - paddingCandles);
  const last = Math.min(candles.length - 1, Math.max(...indexes) + paddingCandles);
  const fallbackTo = signal.createdAt + 50 * 15 * 60 * 1000;

  return {
    from: candles[first]?.time ?? signal.createdAt - paddingCandles * 15 * 60 * 1000,
    to: candles[last]?.time ?? fallbackTo
  };
}
