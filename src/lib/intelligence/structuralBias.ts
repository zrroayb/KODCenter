import type { Candle, ICTBias, SwingPoint, TradeDirection } from "../ict/types";
import { detectSwingPoints } from "./structureEngine";

// Yapı temelli HTF bias (Master §3/§8). Eski `detectDriftBias` iki kapanışın farkına bakıyordu;
// bu motor gerçek market structure okur: swing'ler → HH/HL/LH/LL → korunan seviye → BOS/CHoCH.
//
// En kritik davranış farkı: bu motor GERÇEKTEN "neutral" döndürebilir. Master §8 yapı çeliştiğinde
// (genişleyen/daralan range) veya yeterli swing yokken yön uydurmayı yasaklıyor; drift fonksiyonu
// ise matematiksel olarak neredeyse hiç neutral dönemiyordu (yalnız iki kapanış birebir eşitse).
//
// Repaint yok: `detectSwingPoints` swing'i sağ kanatla onaylar, ve kırılım taraması yalnızca
// swing'in bilinebilir olduğu mumdan (candleIndex + wing) SONRAsına bakar.

export type StructuralPattern = "uptrend" | "downtrend" | "expanding" | "contracting" | "unclear";
export type StructuralConfidence = "strong" | "moderate" | "weak";

export type StructuralBias = {
  bias: ICTBias;
  pattern: StructuralPattern;
  confidence: StructuralConfidence;
  // Korunan seviyeler (Master §3 "protected high/low"): kırılırsa karakter değişir.
  protectedHigh?: number;
  protectedLow?: number;
  lastEvent?: { kind: "bos" | "choch"; direction: TradeDirection; level: number; candleIndex: number };
  reasons: string[];
};

const MIN_SWINGS_PER_SIDE = 2;

function neutral(reason: string, extra: Partial<StructuralBias> = {}): StructuralBias {
  return { bias: "neutral", pattern: "unclear", confidence: "weak", reasons: [reason], ...extra };
}

// Az mumlu üst zaman dilimlerinde (aylık) geniş kanat hiç swing bulamaz; kanadı daraltarak
// yapıyı yine de okumaya çalışırız — bulamazsak dürüstçe neutral döneriz.
function swingsWithAdaptiveWing(candles: Candle[]): { swings: SwingPoint[]; wing: number } {
  for (const wing of [3, 2, 1]) {
    if (candles.length < wing * 2 + 1) continue;
    const swings = detectSwingPoints(candles, wing);
    const highs = swings.filter((point) => point.side === "high").length;
    const lows = swings.filter((point) => point.side === "low").length;
    if (highs >= MIN_SWINGS_PER_SIDE && lows >= MIN_SWINGS_PER_SIDE) return { swings, wing };
  }
  return { swings: [], wing: 3 };
}

// Pivotsuz seri = onaylı swing yok, ama bu her zaman "belirsiz" demek DEĞİL: geri çekilmesiz
// güçlü bir impulse bacağı da yapıdır (en temiz trend hali). Ayrımı dürüst yapmak için son
// kapanışın pencere aralığındaki konumuna bakarız — uçta ise trend, ortada ise gerçekten belirsiz.
const IMPULSE_EDGE = 0.15;

function impulseFallback(closed: Candle[]): StructuralBias {
  const highest = Math.max(...closed.map((candle) => candle.high));
  const lowest = Math.min(...closed.map((candle) => candle.low));
  const span = highest - lowest;
  if (!Number.isFinite(span) || span <= 0) {
    return neutral("Yeterli onaylı swing yok ve aralık ölçülemiyor; yön uydurulmaz (Master §8).");
  }
  const position = (closed[closed.length - 1].close - lowest) / span;
  if (position >= 1 - IMPULSE_EDGE) {
    return {
      bias: "bullish",
      pattern: "uptrend",
      confidence: "weak",
      protectedLow: lowest,
      reasons: [`Onaylı swing yok fakat kapanış pencerenin tepesinde (%${Math.round(position * 100)}); geri çekilmesiz bullish impulse.`]
    };
  }
  if (position <= IMPULSE_EDGE) {
    return {
      bias: "bearish",
      pattern: "downtrend",
      confidence: "weak",
      protectedHigh: highest,
      reasons: [`Onaylı swing yok fakat kapanış pencerenin dibinde (%${Math.round(position * 100)}); geri çekilmesiz bearish impulse.`]
    };
  }
  return neutral(`Onaylı swing yok ve kapanış aralığın ortasında (%${Math.round(position * 100)}); yön uydurulmaz (Master §8).`);
}

// Swing bilinebilir olduktan SONRA gelen ilk kapanışlı kırılım (lookahead yok).
function firstCloseBreak(
  candles: Candle[],
  swing: SwingPoint,
  wing: number,
  direction: TradeDirection
): { level: number; candleIndex: number } | undefined {
  const from = swing.candleIndex + wing + 1;
  for (let index = from; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.closed === false) continue;
    const broken = direction === "long" ? candle.close > swing.level : candle.close < swing.level;
    if (broken) return { level: swing.level, candleIndex: index };
  }
  return undefined;
}

export function detectStructuralBias(candles: Candle[]): StructuralBias {
  const closed = candles.filter((candle) => candle.closed !== false);
  if (closed.length < 5) return neutral("Yapı okumak için yeterli kapalı mum yok.");

  const { swings, wing } = swingsWithAdaptiveWing(closed);
  const highs = swings.filter((point) => point.side === "high");
  const lows = swings.filter((point) => point.side === "low");
  if (highs.length < MIN_SWINGS_PER_SIDE || lows.length < MIN_SWINGS_PER_SIDE) {
    return impulseFallback(closed);
  }

  const [prevHigh, lastHigh] = highs.slice(-2);
  const [prevLow, lastLow] = lows.slice(-2);
  const higherHigh = lastHigh.level > prevHigh.level;
  const higherLow = lastLow.level > prevLow.level;

  const pattern: StructuralPattern = higherHigh && higherLow
    ? "uptrend"
    : !higherHigh && !higherLow
      ? "downtrend"
      : higherHigh && !higherLow
        ? "expanding"   // HH + LL: genişleyen/broadening range — yön yok
        : "contracting"; // LH + HL: daralan üçgen — yön yok

  const reasons = [
    `Swing yapısı: ${higherHigh ? "HH" : "LH"} + ${higherLow ? "HL" : "LL"} (${pattern}).`
  ];

  // En güncel korunan seviyeler: bunlar kırılırsa karakter değişir.
  const protectedHigh = lastHigh.level;
  const protectedLow = lastLow.level;

  // Korunan seviyelerin kapanışla kırılması. Hangisi daha sonra olduysa güncel olay odur.
  const upBreak = firstCloseBreak(closed, lastHigh, wing, "long");
  const downBreak = firstCloseBreak(closed, lastLow, wing, "short");
  const latestBreak = upBreak && downBreak
    ? (upBreak.candleIndex >= downBreak.candleIndex ? { ...upBreak, direction: "long" as TradeDirection } : { ...downBreak, direction: "short" as TradeDirection })
    : upBreak
      ? { ...upBreak, direction: "long" as TradeDirection }
      : downBreak
        ? { ...downBreak, direction: "short" as TradeDirection }
        : undefined;

  if (!latestBreak) {
    // Kırılım yok: yalnız swing deseni konuşur. Çelişkili desen = dürüst neutral.
    if (pattern === "uptrend") {
      reasons.push("Korunan seviyeler kırılmadı; trend yapısı geçerli.");
      return { bias: "bullish", pattern, confidence: "moderate", protectedHigh, protectedLow, reasons };
    }
    if (pattern === "downtrend") {
      reasons.push("Korunan seviyeler kırılmadı; trend yapısı geçerli.");
      return { bias: "bearish", pattern, confidence: "moderate", protectedHigh, protectedLow, reasons };
    }
    reasons.push("Yapı çelişkili (range) ve kırılım yok; yön belirsiz.");
    return { bias: "neutral", pattern, confidence: "weak", protectedHigh, protectedLow, reasons };
  }

  // Trend yönüyle aynı kırılım BOS (devam), ters kırılım CHoCH (karakter değişimi).
  const trendDirection: TradeDirection | undefined = pattern === "uptrend" ? "long" : pattern === "downtrend" ? "short" : undefined;
  const kind: "bos" | "choch" = trendDirection && latestBreak.direction !== trendDirection ? "choch" : "bos";
  const lastEvent = { kind, direction: latestBreak.direction, level: latestBreak.level, candleIndex: latestBreak.candleIndex };

  if (kind === "choch") {
    reasons.push(`CHoCH: korunan ${latestBreak.direction === "short" ? "low" : "high"} ${latestBreak.level} kapanışla kırıldı; trend okuması geçersiz.`);
    return {
      bias: latestBreak.direction === "long" ? "bullish" : "bearish",
      pattern,
      confidence: "moderate",
      protectedHigh,
      protectedLow,
      lastEvent,
      reasons
    };
  }

  reasons.push(`BOS: ${latestBreak.direction === "long" ? "yüksek" : "düşük"} ${latestBreak.level} kapanışla kırıldı; yapı teyitli.`);
  // Range içindeki tek yönlü kırılım trend kadar güçlü değildir.
  const confidence: StructuralConfidence = trendDirection ? "strong" : "weak";
  return {
    bias: latestBreak.direction === "long" ? "bullish" : "bearish",
    pattern,
    confidence,
    protectedHigh,
    protectedLow,
    lastEvent,
    reasons
  };
}
