import type { Candle, TradingSignal } from "../ict/types";
import { formatPrice } from "../ict/format";
import { latestClosed } from "../ict/candles";

function executionCandles(signal: TradingSignal): Candle[] {
  return signal.context.timeframes.m15.length ? signal.context.timeframes.m15 : signal.context.timeframes.m5;
}

export type CloseConfirmationRequirement = {
  timeframe: "15m" | "5m" | "1h" | "4h" | "1d";
  level: number;
  side: "above" | "below";
  candleIndex: number;
  candleTime: number;
  reference: "internal-swing-high" | "internal-swing-low" | "last-closed-high" | "last-closed-low";
  label: string;
  reason: string;
};

export function closeConfirmationRequirement(signal: TradingSignal): CloseConfirmationRequirement | null {
  if (signal.plan.entryModel.cisdConfirmed) return null;
  // The confirmation candle lives on the signal's confirmation timeframe — a weekly-anchor
  // setup waits for a 4H close, not a 15m one.
  const confirmTf = signal.crtAnchor?.confirmTf;
  const candles = confirmTf === "4h"
    ? signal.context.timeframes.h4
    : confirmTf === "1h"
      ? signal.context.timeframes.h1
      : confirmTf === "1d"
        ? signal.context.timeframes.daily
        : executionCandles(signal);
  if (candles.length < 1) return null;
  const chochEvidence = signal.evidence.find((item) => item.id === "choch");
  const evidenceReferenceIndex = typeof chochEvidence?.metadata?.referenceCandleIndex === "number"
    ? chochEvidence.metadata.referenceCandleIndex
    : undefined;
  const evidenceReferencePrice = typeof chochEvidence?.price === "number" ? chochEvidence.price : undefined;
  const hasInternalReference = typeof evidenceReferencePrice === "number" && typeof evidenceReferenceIndex === "number";
  const fallbackCandle = latestClosed(candles);
  const fallbackIndex = Math.max(0, candles.indexOf(fallbackCandle));
  const candleIndex = evidenceReferenceIndex ?? fallbackIndex;
  const referenceCandle = candles[candleIndex] ?? fallbackCandle;
  const timeframe: CloseConfirmationRequirement["timeframe"] = confirmTf === "4h" || confirmTf === "1h" || confirmTf === "1d"
    ? confirmTf
    : signal.context.timeframes.m15.length ? "15m" : "5m";
  const side = signal.direction === "long" ? "above" : "below";
  const level = evidenceReferencePrice ?? (signal.direction === "long" ? referenceCandle.high : referenceCandle.low);
  const reference = hasInternalReference
    ? signal.direction === "long" ? "internal-swing-high" : "internal-swing-low"
    : signal.direction === "long" ? "last-closed-high" : "last-closed-low";
  return {
    timeframe,
    level,
    side,
    candleIndex,
    candleTime: referenceCandle.time,
    reference,
    label: `${timeframe} mum ${formatPrice(level)} ${side === "above" ? "üstünde" : "altında"}`,
    reason: signal.direction === "long"
      ? `${hasInternalReference ? "Raid öncesinde doğrulanmış internal swing high" : "Son kapalı mum high"}. Güçlü displacement kapanışı üstüne gelirse alıcı karakter değişimi onaylanır.`
      : `${hasInternalReference ? "Raid öncesinde doğrulanmış internal swing low" : "Son kapalı mum low"}. Güçlü displacement kapanışı altına gelirse satıcı karakter değişimi onaylanır.`
  };
}

export function entryRetestRequirement(signal: TradingSignal): string | null {
  if (signal.plan.entryModel.retested) return null;
  const gap = signal.plan.entryModel.fairValueGap;
  if (!gap) return `Fiyat giriş seviyesine dokunsun: ${formatPrice(signal.plan.entry)}.`;
  return `Fiyat giriş kutusuna dokunsun: ${formatPrice(gap.low)} - ${formatPrice(gap.high)}.`;
}
