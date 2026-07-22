import type { Candle, LiquidityObjective, SwingPoint } from "../ict/types";
import { detectSwingPoints } from "./structureEngine";

// Eşit tepe/dipler (EQH/EQL) — ICT'nin birincil likidite havuzu (Master §3'te açıkça listeli).
// PDH/PWH gibi "önceki periyodun ucu" seviyelerinin aksine, eşit seviyeler perakende stop'larının
// FİİLEN kümelendiği yerdir: iki+ swing aynı fiyatta durduysa oranın üstü/altı likidite deposudur.
//
// Kuvvet dokunuş sayısıyla: 2 dokunuş moderate, 3+ dokunuş strong (daha fazla stop birikmiştir).
// Yalnız HENÜZ SÜPÜRÜLMEMİŞ havuzlar draw sayılır — süpürülen havuz artık hedef değil, yakıttır.

// Fiyata göre normalize tolerans: "eşit" demek için seviyeler birbirine bu kadar yakın olmalı.
const DEFAULT_TOLERANCE_PCT = 0.0006; // %0.06

export type EqualLevel = {
  side: "buy-side" | "sell-side";
  level: number;
  touches: number;
  swept: boolean;
  strength: LiquidityObjective["strength"];
};

function groupEqual(points: SwingPoint[], tolerancePct: number): Array<{ level: number; touches: number; lastIndex: number }> {
  const groups: Array<{ level: number; touches: number; lastIndex: number }> = [];
  const used = new Set<number>();
  points.forEach((point, index) => {
    if (used.has(index)) return;
    used.add(index);
    let sum = point.level;
    let touches = 1;
    let lastIndex = point.candleIndex;
    for (let other = index + 1; other < points.length; other += 1) {
      if (used.has(other)) continue;
      const tolerance = Math.abs(point.level) * tolerancePct;
      if (Math.abs(points[other].level - point.level) <= tolerance) {
        used.add(other);
        sum += points[other].level;
        touches += 1;
        lastIndex = Math.max(lastIndex, points[other].candleIndex);
      }
    }
    if (touches >= 2) groups.push({ level: sum / touches, touches, lastIndex });
  });
  return groups;
}

export function detectEqualLevels(candles: Candle[], tolerancePct = DEFAULT_TOLERANCE_PCT): EqualLevel[] {
  const closed = candles.filter((candle) => candle.closed !== false);
  if (closed.length < 10) return [];
  const swings = detectSwingPoints(closed, 2);
  const highs = swings.filter((point) => point.side === "high");
  const lows = swings.filter((point) => point.side === "low");

  const levels: EqualLevel[] = [];
  for (const group of groupEqual(highs, tolerancePct)) {
    // Havuz, oluştuktan sonra bir mum onun ÜSTÜNE çıktıysa süpürülmüştür.
    const swept = closed.slice(group.lastIndex + 1).some((candle) => candle.high > group.level);
    levels.push({
      side: "buy-side",
      level: group.level,
      touches: group.touches,
      swept,
      strength: group.touches >= 3 ? "strong" : "moderate"
    });
  }
  for (const group of groupEqual(lows, tolerancePct)) {
    const swept = closed.slice(group.lastIndex + 1).some((candle) => candle.low < group.level);
    levels.push({
      side: "sell-side",
      level: group.level,
      touches: group.touches,
      swept,
      strength: group.touches >= 3 ? "strong" : "moderate"
    });
  }
  return levels;
}

// Süpürülmemiş eşit seviyeleri bias motorunun external-draw girdisine (25p, en ağır bileşen)
// besleyecek likidite hedeflerine çevirir.
export function equalLevelObjectives(candles: Candle[], timeframe: LiquidityObjective["timeframe"]): LiquidityObjective[] {
  return detectEqualLevels(candles)
    .filter((level) => !level.swept)
    .map((level) => ({
      id: `${level.side === "buy-side" ? "EQH" : "EQL"}-${timeframe}-${level.level.toFixed(5)}`,
      kind: level.side === "buy-side" ? "EQH" : "EQL",
      side: level.side,
      level: level.level,
      label: `${level.side === "buy-side" ? "EQH" : "EQL"} (${level.touches} dokunuş) ${level.side === "buy-side" ? "buy-side" : "sell-side"} liquidity`,
      timeframe,
      source: `Equal ${level.side === "buy-side" ? "highs" : "lows"} — ${level.touches} onaylı swing aynı seviyede`,
      strength: level.strength
    }));
}
