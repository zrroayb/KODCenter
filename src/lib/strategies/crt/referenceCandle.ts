import type { Candle } from "../../ict/types";

// reference_candle_score — Master §5. A CRT range candle earns quality only with a meaningful
// reason; it is NOT selected just for being large or latest. This grades every candidate so the
// system can rank a proper imbalance candle above an arbitrary doji WITHOUT hard-filtering (Master
// §3.3: wick/body/range thresholds stay configurable and backtested). Grounding:
//   - ict-knowledge-library/21-crt: reference candle with a clearly defined high/low.
//   - XAU-60/crt_tbs.py: body/range rejection ratio (~0.3), ATR band 0.8x-2.5x, range expansion.
//   - crt-turtlesoup-ea: body-dominant candle, wick filters.

export type ReferenceCandleComponents = {
  imbalance: number;   // 0-30  body dominates range (VasilyTrader "large body, small wicks")
  rangeVsAtr: number;  // 0-25  0.8x-2.5x of ATR = meaningful, not noise and not exhausted
  expansion: number;   // 0-15  range vs recent median range (an expansion candle)
  location: number;    // 0-20  swept extreme sits at meaningful HTF liquidity / PD array
  session: number;     // 0-10  formed at a key open / killzone
};

export type ReferenceCandleGrade = "A" | "B" | "C" | "D";

export type ReferenceCandleScore = {
  score: number;                     // 0-100
  grade: ReferenceCandleGrade;
  bodyRatio: number;                 // |close-open| / (high-low)
  rangeAtrMultiple: number;          // (high-low) / ATR(recent)
  exhausted: boolean;                // oversized, likely already delivered
  components: ReferenceCandleComponents;
  reasons: string[];                 // Master §5: explain every component
};

export const REFERENCE_CANDLE_DEFAULTS = {
  // Below this body/range the candle is a rejection/indecision candle, not an imbalance candle.
  rejectionBodyRatio: 0.3,
  strongBodyRatio: 0.7,
  atrIdealMin: 0.8,
  atrIdealMax: 2.5,
  exhaustedAtrMultiple: 3.5,
  expansionMultiple: 1.3
};

function atrOf(candles: Candle[]): number {
  const window = candles.slice(-14);
  if (window.length === 0) return 0;
  const ranges = window.map((candle) => candle.high - candle.low).filter((value) => value > 0);
  if (ranges.length === 0) return 0;
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function medianRange(candles: Candle[]): number {
  const ranges = candles.slice(-20).map((candle) => candle.high - candle.low).filter((value) => value > 0).sort((a, b) => a - b);
  if (ranges.length === 0) return 0;
  return ranges[Math.floor(ranges.length / 2)];
}

function gradeFor(score: number): ReferenceCandleGrade {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "D";
}

// recentCandles = the closed candles BEFORE the reference candle on the same (range) timeframe.
export function evaluateReferenceCandle(input: {
  candle: Candle;
  recentCandles: Candle[];
  atMeaningfulLocation?: boolean;
  keyTime?: boolean;
  config?: Partial<typeof REFERENCE_CANDLE_DEFAULTS>;
}): ReferenceCandleScore {
  const cfg = { ...REFERENCE_CANDLE_DEFAULTS, ...input.config };
  const { candle } = input;
  const range = Math.max(candle.high - candle.low, 1e-9);
  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / range;
  const atr = atrOf(input.recentCandles);
  const rangeAtrMultiple = atr > 0 ? range / atr : 0;
  const median = medianRange(input.recentCandles);
  const expansionMultiple = median > 0 ? range / median : 0;
  const reasons: string[] = [];

  // 1) Imbalance — the heart of "meaningful": a body-dominant candle, not a wick/indecision one.
  let imbalance: number;
  if (bodyRatio >= cfg.strongBodyRatio) { imbalance = 30; reasons.push(`Güçlü imbalance mumu (gövde/menzil ${bodyRatio.toFixed(2)} ≥ ${cfg.strongBodyRatio}).`); }
  else if (bodyRatio >= 0.5) { imbalance = 22; reasons.push(`Gövde baskın (${bodyRatio.toFixed(2)}); makul imbalance.`); }
  else if (bodyRatio >= cfg.rejectionBodyRatio) { imbalance = 12; reasons.push(`Orta gövde (${bodyRatio.toFixed(2)}); zayıf imbalance.`); }
  else { imbalance = 4; reasons.push(`Rejection/indecision mumu (gövde/menzil ${bodyRatio.toFixed(2)} < ${cfg.rejectionBodyRatio}); imbalance yok.`); }

  // 2) Range vs ATR — meaningful size, not noise, not exhausted.
  let rangeVsAtr: number;
  const exhausted = rangeAtrMultiple > cfg.exhaustedAtrMultiple;
  if (atr <= 0) { rangeVsAtr = 8; reasons.push("ATR referansı yok; menzil-boyutu nötr sayıldı."); }
  else if (rangeAtrMultiple >= cfg.atrIdealMin && rangeAtrMultiple <= cfg.atrIdealMax) { rangeVsAtr = 25; reasons.push(`Menzil ATR'ın ${rangeAtrMultiple.toFixed(2)}×'i; ideal bantta (${cfg.atrIdealMin}-${cfg.atrIdealMax}).`); }
  else if (exhausted) { rangeVsAtr = 3; reasons.push(`Menzil ATR'ın ${rangeAtrMultiple.toFixed(2)}×'i; aşırı büyük, muhtemelen tükenmiş.`); }
  else if (rangeAtrMultiple < cfg.atrIdealMin) { rangeVsAtr = 6; reasons.push(`Menzil ATR'ın ${rangeAtrMultiple.toFixed(2)}×'i; küçük, gürültü riski.`); }
  else { rangeVsAtr = 12; reasons.push(`Menzil ATR'ın ${rangeAtrMultiple.toFixed(2)}×'i; ideal bandın biraz üstünde.`); }

  // 3) Expansion — an expansion candle (above recent median) carries intent.
  let expansion: number;
  if (median <= 0) { expansion = 6; }
  else if (expansionMultiple >= cfg.expansionMultiple) { expansion = 15; reasons.push(`Expansion mumu (son medyanın ${expansionMultiple.toFixed(2)}×'i).`); }
  else if (expansionMultiple >= 0.9) { expansion = 9; }
  else { expansion = 3; reasons.push(`Menzil son medyanın altında (${expansionMultiple.toFixed(2)}×); sıkışma mumu.`); }

  // 4) Location — the swept extreme should sit at meaningful HTF liquidity / a PD array.
  const location = input.atMeaningfulLocation ? 20 : 0;
  if (input.atMeaningfulLocation) reasons.push("Mum, anlamlı HTF likidite / PD array üzerinde.");
  else reasons.push("Anlamlı HTF key level / PD array yakınında değil (konum artısı yok).");

  // 5) Session — a key open / killzone candle carries the session narrative.
  const session = input.keyTime ? 10 : 0;
  if (input.keyTime) reasons.push("Key open / killzone mumu.");

  const components: ReferenceCandleComponents = { imbalance, rangeVsAtr, expansion, location, session };
  const score = Math.max(0, Math.min(100, imbalance + rangeVsAtr + expansion + location + session));

  return { score, grade: gradeFor(score), bodyRatio, rangeAtrMultiple, exhausted, components, reasons };
}
