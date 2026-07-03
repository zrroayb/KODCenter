import type { Candle, DataConfidenceContext, MarketContext } from "../ict/types";

function latestTime(candles: Candle[]): number | undefined {
  return candles[candles.length - 1]?.time;
}

function lagMinutes(time: number | undefined, now: number): number {
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((now - time) / 60_000));
}

function grade(score: number): DataConfidenceContext["grade"] {
  if (score >= 85) return "A";
  if (score >= 68) return "B";
  if (score >= 48) return "C";
  return "D";
}

export function buildDataConfidence(input: {
  timeframes: MarketContext["timeframes"];
  dataFeed: MarketContext["dataFeed"];
  now?: number;
}): DataConfidenceContext {
  const now = input.now ?? Date.now();
  const warnings: string[] = [];
  let score = 100;

  if (input.dataFeed.source === "demo") {
    score -= 30;
    warnings.push("Demo/fallback veri: canlı karar için düşük güven.");
  } else if (input.dataFeed.source === "mid-only") {
    score -= 18;
    warnings.push("Mid-only veri: bid/ask gerçek spread'i yok.");
  } else if (input.dataFeed.source === "synthetic-bid-ask") {
    score -= 10;
    warnings.push("Bid/ask sentetik modellendi; broker fill garantisi yok.");
  }

  const frameCounts = [
    ["5m", input.timeframes.m5.length],
    ["15m", input.timeframes.m15.length],
    ["1h", input.timeframes.h1.length],
    ["4h", input.timeframes.h4.length],
    ["1D", input.timeframes.daily.length]
  ] as const;
  for (const [label, count] of frameCounts) {
    if (count < 30) {
      score -= 12;
      warnings.push(`${label} candle sayısı düşük (${count}).`);
    }
  }

  const execLag = Math.min(lagMinutes(latestTime(input.timeframes.m5), now), lagMinutes(latestTime(input.timeframes.m15), now));
  const htfLag = Math.min(lagMinutes(latestTime(input.timeframes.h1), now), lagMinutes(latestTime(input.timeframes.h4), now));
  const stale = execLag > 60 || htfLag > 360;
  if (stale) {
    score -= 18;
    warnings.push(`Veri stale olabilir: exec ${execLag} dk, HTF ${htfLag} dk.`);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: clamped,
    grade: grade(clamped),
    stale,
    source: input.dataFeed.source,
    summary: `Veri güveni ${grade(clamped)} / ${clamped}`,
    warnings
  };
}
