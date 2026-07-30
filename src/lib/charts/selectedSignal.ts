import type { Candle, Displacement, FairValueGap, JudasSwing, MarketStructureShift, SmtDivergence, Sweep, Timeframe, TradingSignal } from "../ict/types";

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
  turtleSoup?: {
    rangeCandleIndex: number;
    turtleCandleIndex: number;
    rangeHigh: number;
    rangeLow: number;
    rangeMidpoint: number;
    sweepLevel: number;
    reclaimLevel: number;
    wickRatio: number;
  };
};

export type ConfirmationTimeframe = Extract<Timeframe, "5m" | "15m" | "1h" | "4h">;

const TF_MS: Record<ConfirmationTimeframe, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000
};

// The timeframe a signal's setup structure lives on: CRT anchors confirm on their own lower
// timeframe (4H->15m, 1D->1H, 1W->4H); everything else confirms on the execution TF.
export function signalConfirmTimeframe(signal: TradingSignal): ConfirmationTimeframe {
  const tf = signal.crtAnchor?.confirmTf;
  if (tf === "1h" || tf === "4h") return tf;
  // Non-CRT playbooks (Trend Continuation) have no crtAnchor — their POI/entry live on the signal's
  // own execution timeframe (1h), so the chart must open THERE, not default to m15.
  if (!signal.crtAnchor && (signal.timeframe === "1h" || signal.timeframe === "4h")) return signal.timeframe;
  return signal.context.timeframes.m15.length ? "15m" : "5m";
}

// Candles of the signal's confirmation timeframe — annotation candleIndex values point here.
export function confirmationCandles(signal: TradingSignal): Candle[] {
  const tf = signalConfirmTimeframe(signal);
  if (tf === "1h") return signal.context.timeframes.h1;
  if (tf === "4h") return signal.context.timeframes.h4;
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
  const confirmTf = signalConfirmTimeframe(signal);
  // Context-wide structures (sweeps, displacement, SMT, Judas) are detected on the execution
  // TF; they only belong next to the setup when the signal confirms there too — a 1D-anchor
  // setup's structure lives on 1H candles and an m15 sweep index means nothing there.
  const contextIsConfirm = confirmTf === "15m" || confirmTf === "5m";
  const crt = signal.strategyId === "crt";
  const evidenceOf = (id: string) => signal.evidence.find((item) => item.id === id && item.status === "pass");
  // CRT setup structure comes from the signal's own evidence (indexed on the confirmation
  // TF), not from random global m15 context items that may describe another move entirely.
  const chochEvidence = crt ? evidenceOf("choch") : undefined;
  const crtChoch: MarketStructureShift | undefined = chochEvidence
    && typeof chochEvidence.price === "number" && typeof chochEvidence.candleIndex === "number"
    ? { direction: signal.direction, level: chochEvidence.price, candleIndex: chochEvidence.candleIndex, brokenIndex: chochEvidence.candleIndex, kind: "choch" }
    : undefined;
  const manipulationEvidence = crt ? evidenceOf("manipulation") : undefined;
  const crtSweep: Sweep | undefined = manipulationEvidence
    && typeof manipulationEvidence.price === "number" && typeof manipulationEvidence.candleIndex === "number"
    ? { side: sweepSide, level: manipulationEvidence.price, candleIndex: manipulationEvidence.candleIndex, reclaimed: true }
    : undefined;
  const turtleSoupEvidence = crt && signal.plan.entrySource === "turtle-soup-open" ? evidenceOf("turtle-soup") : undefined;
  const turtleSoupMeta = turtleSoupEvidence?.metadata;
  const turtleSoup = turtleSoupMeta
    && typeof turtleSoupMeta.rangeCandleIndex === "number"
    && typeof turtleSoupMeta.turtleCandleIndex === "number"
    && typeof turtleSoupMeta.rangeHigh === "number"
    && typeof turtleSoupMeta.rangeLow === "number"
    && typeof turtleSoupMeta.rangeMidpoint === "number"
    && typeof turtleSoupMeta.sweepLevel === "number"
    && typeof turtleSoupMeta.reclaimLevel === "number"
    && typeof turtleSoupMeta.wickRatio === "number"
    ? {
        rangeCandleIndex: turtleSoupMeta.rangeCandleIndex,
        turtleCandleIndex: turtleSoupMeta.turtleCandleIndex,
        rangeHigh: turtleSoupMeta.rangeHigh,
        rangeLow: turtleSoupMeta.rangeLow,
        rangeMidpoint: turtleSoupMeta.rangeMidpoint,
        sweepLevel: turtleSoupMeta.sweepLevel,
        reclaimLevel: turtleSoupMeta.reclaimLevel,
        wickRatio: turtleSoupMeta.wickRatio
      }
    : undefined;

  return {
    sweep: crt
      ? crtSweep
      : latestByIndex(signal.context.sweeps.filter((sweep) => sweep.side === sweepSide && sweep.reclaimed)) ?? latestByIndex(signal.context.sweeps),
    displacement: contextIsConfirm ? latestByIndex(signal.context.displacements.filter((item) => item.direction === signal.direction)) : undefined,
    marketStructureShift: crt
      ? crtChoch
      : latestByIndex(signal.context.marketStructureShifts.filter((item) => item.direction === signal.direction)),
    fairValueGap: planFairValueGap(signal),
    smtDivergence: contextIsConfirm ? latestByIndex(signal.context.smtDivergences.filter((item) => item.direction === signal.direction)) : undefined,
    judasSwing: contextIsConfirm ? signal.context.judasSwings.find((item) => item.direction === signal.direction) : undefined,
    turtleSoup
  };
}

export function signalAnchorIndex(signal: TradingSignal): number {
  const annotations = selectedSignalAnnotations(signal);
  const indexes = [
    annotations.sweep?.candleIndex,
    annotations.displacement?.candleIndex,
    annotations.marketStructureShift?.candleIndex,
    annotations.fairValueGap?.candleIndex,
    annotations.turtleSoup?.rangeCandleIndex,
    annotations.turtleSoup?.turtleCandleIndex,
    annotations.smtDivergence?.candleIndex
  ].filter((index): index is number => typeof index === "number");
  return indexes.length ? Math.max(...indexes) : confirmationCandles(signal).length - 1;
}

export function signalAnchorTime(signal: TradingSignal): number {
  const candles = confirmationCandles(signal);
  return candles[Math.min(Math.max(signalAnchorIndex(signal), 0), candles.length - 1)]?.time ?? signal.createdAt;
}

export function focusChartOnSignal(signal: TradingSignal, paddingCandles = 30): FocusedTimeRange {
  const candles = confirmationCandles(signal);
  const stepMs = TF_MS[signalConfirmTimeframe(signal)];
  if (candles.length === 0) {
    return {
      from: signal.createdAt - paddingCandles * stepMs,
      to: signal.createdAt + 50 * stepMs
    };
  }

  const annotations = selectedSignalAnnotations(signal);
  const indexes = [
    annotations.sweep?.candleIndex,
    annotations.displacement?.candleIndex,
    annotations.marketStructureShift?.candleIndex,
    annotations.fairValueGap?.candleIndex,
    annotations.turtleSoup?.rangeCandleIndex,
    annotations.turtleSoup?.turtleCandleIndex,
    annotations.smtDivergence?.candleIndex,
    candles.length - 1
  ].filter((index): index is number => typeof index === "number");

  // Never open a window wider than ~150 candles: one stale annotation index must not
  // squeeze weeks of price action into a single unreadable screen.
  const maxSpan = 150;
  const last = Math.min(candles.length - 1, Math.max(...indexes) + paddingCandles);
  const first = Math.max(0, last - maxSpan, Math.min(...indexes) - paddingCandles);
  const fallbackTo = signal.createdAt + 50 * stepMs;

  return {
    from: candles[first]?.time ?? signal.createdAt - paddingCandles * stepMs,
    to: candles[last]?.time ?? fallbackTo
  };
}
