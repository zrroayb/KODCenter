import { formatPrice } from "../../ict/format";
import type { Candle, SmtDivergence, TradeDirection } from "../../ict/types";

// CRT Secrets §4: on the way to the target, an OPPOSING SMT plus an opposing structure break
// (True MSS / Model #1 against the trade) cancels the target. This only WARNS — KODCenter never
// closes a position; the owner decides.
export type CrtTargetInvalidation = {
  level: number;
  breakIndex: number;
  partner: string;
  message: string;
};

// candles = CLOSED confirmation-TF candles; entryIndex = the retest (fill) candle.
export function crtTargetInvalidation(input: {
  candles: Candle[];
  direction: TradeDirection;
  entryIndex: number;
  smtDivergences: SmtDivergence[];
}): CrtTargetInvalidation | undefined {
  const { candles, direction, entryIndex } = input;
  const entryTime = candles[entryIndex]?.time;
  if (typeof entryTime !== "number") return undefined;
  // Opposing SMT formed after the fill (a long is threatened by a bearish SMT, and vice versa).
  const smt = input.smtDivergences
    .filter((item) => item.direction !== direction && item.time >= entryTime)
    .sort((a, b) => b.time - a.time)[0];
  if (!smt) return undefined;

  // Opposing structure after the fill: the latest 1-wing pivot against the trade (a swing LOW for
  // a long), then a later candle BODY-closing through it.
  for (let pivot = candles.length - 2; pivot > entryIndex; pivot -= 1) {
    const prev = candles[pivot - 1];
    const here = candles[pivot];
    const next = candles[pivot + 1];
    const isPivot = direction === "long"
      ? here.low < prev.low && here.low < next.low
      : here.high > prev.high && here.high > next.high;
    if (!isPivot) continue;
    const level = direction === "long" ? here.low : here.high;
    for (let index = pivot + 2; index < candles.length; index += 1) {
      const close = candles[index].close;
      if (direction === "long" ? close < level : close > level) {
        return {
          level,
          breakIndex: index,
          partner: smt.partner,
          message: `Hedef iptal riski: ters SMT (${smt.partner}) + ${formatPrice(level)} ${direction === "long" ? "swing low altında" : "swing high üstünde"} kapanış (ters MSS). Kaynak kuralı: DOL hedefi iptal — çıkışı/korumayı değerlendir.`
        };
      }
    }
    // Only the latest opposing pivot counts; an older one already held.
    return undefined;
  }
  return undefined;
}
