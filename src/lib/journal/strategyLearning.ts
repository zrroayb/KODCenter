import type { TradingSignal } from "../ict/types";
import type { JournalEntry, JournalInsight } from "./types";

function average(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function bySymbol(entries: JournalEntry[], symbol: string): JournalEntry[] {
  return entries.filter((entry) => entry.symbol === symbol);
}

export function journalLearningInsights(entries: JournalEntry[], signals: TradingSignal[]): JournalInsight[] {
  const closed = entries.filter((entry) => typeof entry.rMultiple === "number" && Number.isFinite(entry.rMultiple));
  const insights: JournalInsight[] = [];

  for (const signal of signals.slice(0, 5)) {
    const symbolEntries = bySymbol(closed, signal.symbol);
    const avgR = average(symbolEntries.map((entry) => entry.rMultiple ?? 0));
    const sameMistakes = entries.filter((entry) =>
      entry.symbol === signal.symbol &&
      entry.mistake &&
      signal.plan.planWarnings.some((warning) => warning.toLowerCase().includes(String(entry.mistake).toLowerCase().slice(0, 8)))
    );
    if (typeof avgR === "number") {
      insights.push({
        label: `${signal.symbol} journal edge`,
        value: `${avgR.toFixed(2)}R`,
        detail: avgR < 0
          ? "Bu sembolde kapanmış journal ortalaması negatif; risk düşür veya ekstra filtre bekle."
          : "Bu sembolde journal ortalaması pozitif; yine de setup governance temiz olmalı."
      });
    }
    if (sameMistakes.length) {
      insights.push({
        label: `${signal.symbol} tekrar eden hata`,
        value: String(sameMistakes.length),
        detail: "Mevcut uyarılar geçmiş notlardaki hata etiketiyle benzeşiyor; pas geçme sebebi olabilir."
      });
    }
  }

  if (!insights.length) {
    return [{
      label: "Journal learning",
      value: "bekliyor",
      detail: "İşlemi aldım/pas geçtim ve sonuç R bilgileri arttıkça bot sembol ve setup bazlı filtre önerecek."
    }];
  }
  return insights.slice(0, 6);
}
