import type { Candle, MarketContext, SignalActionWindow, SignalOutcome, TradeDirection, TradePlan } from "../ict/types";
import { executableHigh, executableLow } from "../data/bidAsk";

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function priceTouched(candle: Candle, level: number): boolean {
  return candle.low <= level && candle.high >= level;
}

function rAtPrice(direction: TradeDirection, entry: number, risk: number, price: number): number {
  if (risk <= 0) return 0;
  return direction === "short" ? (entry - price) / risk : (price - entry) / risk;
}

export function evaluateSignalOutcome(context: MarketContext, direction: TradeDirection, plan: TradePlan, setupStartIndex: number): SignalOutcome {
  const candles = executionCandles(context);
  const tracked = candles.slice(Math.max(0, Math.min(setupStartIndex, candles.length - 1)));
  const risk = Math.max(plan.riskDistance, 0.000001);
  const entryIndex = tracked.findIndex((candle) => priceTouched(candle, plan.entry));
  if (entryIndex < 0) {
    const latest = tracked[tracked.length - 1];
    const distanceR = latest ? Math.abs(rAtPrice(direction, plan.entry, risk, latest.close)) : 0;
    return {
      status: distanceR > 0.8 ? "missed" : "not-triggered",
      entryTouched: false,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesTracked: tracked.length,
      summary: distanceR > 0.8 ? "Fiyat entry alanından uzaklaşmış; kovalamamak gerekir." : "Entry alanı henüz tetiklenmedi."
    };
  }

  let maxFavorableR = Number.NEGATIVE_INFINITY;
  let maxAdverseR = Number.POSITIVE_INFINITY;
  let status: SignalOutcome["status"] = "open";
  let exitCandleIndex: number | undefined;
  const afterEntry = tracked.slice(entryIndex);

  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    const highR = rAtPrice(direction, plan.entry, risk, executableHigh(candle, direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(direction, plan.entry, risk, executableLow(candle, direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    maxAdverseR = Math.min(maxAdverseR, highR, lowR);

    const stopHit = direction === "short"
      ? executableHigh(candle, "buy") >= plan.stopLoss
      : executableLow(candle, "sell") <= plan.stopLoss;
    const tp2Hit = typeof plan.targets[1] === "number" && (direction === "short"
      ? executableLow(candle, "buy") <= plan.targets[1]
      : executableHigh(candle, "sell") >= plan.targets[1]);
    const tp1Hit = typeof plan.targets[0] === "number" && (direction === "short"
      ? executableLow(candle, "buy") <= plan.targets[0]
      : executableHigh(candle, "sell") >= plan.targets[0]);

    if (stopHit) {
      status = "stopped";
      exitCandleIndex = setupStartIndex + entryIndex + index;
      break;
    }
    if (tp2Hit) {
      status = "tp2";
      exitCandleIndex = setupStartIndex + entryIndex + index;
      break;
    }
    if (tp1Hit) {
      status = "tp1";
      exitCandleIndex = setupStartIndex + entryIndex + index;
      break;
    }
  }

  const entryCandleIndex = setupStartIndex + entryIndex;
  const safeMaxFavorable = Number.isFinite(maxFavorableR) ? maxFavorableR : 0;
  const safeMaxAdverse = Number.isFinite(maxAdverseR) ? maxAdverseR : 0;
  return {
    status,
    entryTouched: true,
    entryCandleIndex,
    exitCandleIndex,
    maxFavorableR: Math.max(0, safeMaxFavorable),
    maxAdverseR: Math.min(0, safeMaxAdverse),
    candlesTracked: afterEntry.length,
    summary: status === "open"
      ? `Entry tetiklendi; max ${Math.max(0, safeMaxFavorable).toFixed(2)}R, adverse ${Math.min(0, safeMaxAdverse).toFixed(2)}R.`
      : status === "stopped"
        ? "Entry sonrası stop/invalidation görüldü."
        : status === "tp2"
          ? "Entry sonrası TP2 görüldü."
          : "Entry sonrası TP1 görüldü."
  };
}

export function buildActionWindow(context: MarketContext, plan: TradePlan, outcome: SignalOutcome, stage: string): SignalActionWindow {
  if (stage === "invalidated" || stage === "missed" || outcome.status === "stopped" || outcome.status === "tp1" || outcome.status === "tp2") {
    return { status: "inactive", candlesRemaining: 0, summary: "Setup artık aktif action window içinde değil." };
  }
  if (!outcome.entryTouched || plan.entryStatus !== "confirmed") {
    return { status: "waiting", candlesRemaining: 3, summary: "Entry alanı ve kapanış onayı bekleniyor." };
  }
  const candles = executionCandles(context);
  const latestIndex = candles.length - 1;
  const elapsed = typeof outcome.entryCandleIndex === "number" ? Math.max(0, latestIndex - outcome.entryCandleIndex) : 0;
  const candlesRemaining = Math.max(0, 3 - elapsed);
  const validUntil = typeof outcome.entryCandleIndex === "number" ? candles[outcome.entryCandleIndex + 3]?.time : undefined;
  return {
    status: candlesRemaining > 0 ? "valid" : "expired",
    candlesRemaining,
    validUntil,
    summary: candlesRemaining > 0
      ? `Action window açık: ${candlesRemaining} mum içinde kovalamadan yönet.`
      : "Action window bitti; yeni retest/setup bekle."
  };
}
