import type { Candle, TradingSignal } from "../ict/types";
import { formatPrice } from "../ict/format";

function executionCandles(signal: TradingSignal): Candle[] {
  return signal.context.timeframes.m15.length ? signal.context.timeframes.m15 : signal.context.timeframes.m5;
}

export type CloseConfirmationRequirement = {
  timeframe: "15m" | "5m" | "1h" | "4h" | "1d";
  level: number;
  side: "above" | "below";
  candleIndex: number;
  candleTime: number;
  reference: "last-closed-high" | "last-closed-low";
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
  const candleIndex = candles.length - 1;
  const referenceCandle = candles[candleIndex];
  const timeframe: CloseConfirmationRequirement["timeframe"] = confirmTf === "4h" || confirmTf === "1h" || confirmTf === "1d"
    ? confirmTf
    : signal.context.timeframes.m15.length ? "15m" : "5m";
  const side = signal.direction === "long" ? "above" : "below";
  const level = signal.direction === "long" ? referenceCandle.high : referenceCandle.low;
  const reference = signal.direction === "long" ? "last-closed-high" : "last-closed-low";
  return {
    timeframe,
    level,
    side,
    candleIndex,
    candleTime: referenceCandle.time,
    reference,
    label: `${timeframe} mum ${formatPrice(level)} ${side === "above" ? "üstünde" : "altında"}`,
    reason: signal.direction === "long"
      ? "ChoCH/Just için referans high. Üstünde kapanış gelirse alıcı karakter değişimi onaylanır."
      : "ChoCH/Just için referans low. Altında kapanış gelirse satıcı karakter değişimi onaylanır."
  };
}

export function entryRetestRequirement(signal: TradingSignal): string | null {
  if (signal.plan.entryModel.retested) return null;
  const gap = signal.plan.entryModel.fairValueGap;
  if (!gap) return `Fiyat giriş seviyesine dokunsun: ${formatPrice(signal.plan.entry)}.`;
  return `Fiyat giriş kutusuna dokunsun: ${formatPrice(gap.low)} - ${formatPrice(gap.high)}.`;
}
