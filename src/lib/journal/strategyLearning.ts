import type { TradingSignal } from "../ict/types";
import type { JournalEntry, JournalInsight } from "./types";

function average(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function bySymbol(entries: JournalEntry[], symbol: string): JournalEntry[] {
  return entries.filter((entry) => entry.symbol === symbol);
}

function countBy(values: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function closedR(entries: JournalEntry[]): JournalEntry[] {
  return entries.filter((entry) => typeof entry.rMultiple === "number" && Number.isFinite(entry.rMultiple));
}

function averageR(entries: JournalEntry[]): number | undefined {
  return average(closedR(entries).map((entry) => entry.rMultiple ?? 0));
}

function snapshotBucketInsights(entries: JournalEntry[]): JournalInsight[] {
  const dimensions: Array<{ label: string; value: (entry: JournalEntry) => string | undefined }> = [
    { label: "Range TF", value: (entry) => entry.latestSignalSnapshot?.rangeTf },
    { label: "Session", value: (entry) => entry.latestSignalSnapshot?.session },
    { label: "PD bölgesi", value: (entry) => entry.latestSignalSnapshot?.premiumDiscount },
    { label: "Rejim", value: (entry) => entry.latestSignalSnapshot?.regime },
    { label: "Grade", value: (entry) => entry.latestSignalSnapshot?.grade },
    { label: "Origin", value: (entry) => entry.latestSignalSnapshot?.origin }
  ];
  const insights: JournalInsight[] = [];
  for (const dimension of dimensions) {
    const values = Array.from(new Set(entries.map(dimension.value).filter((value): value is string => Boolean(value))));
    const buckets = values
      .map((value) => {
        const matches = entries.filter((entry) => dimension.value(entry) === value);
        return { value, count: matches.length, avgR: averageR(matches) };
      })
      .filter((bucket) => bucket.count >= 2 && typeof bucket.avgR === "number")
      .sort((a, b) => (a.avgR ?? 0) - (b.avgR ?? 0));
    const worst = buckets[0];
    if (worst && typeof worst.avgR === "number" && worst.avgR < 0) {
      insights.push({
        label: `${dimension.label} zayıf bucket`,
        value: `${worst.value} · ${worst.avgR.toFixed(2)}R`,
        detail: `${worst.count} alınmış/kapanmış işlem. Kuralı değiştirmeden önce örneklemi büyüt; tekrar ederse READY kalitesini düşür.`
      });
    }
  }
  return insights;
}

export function journalLearningInsights(entries: JournalEntry[], signals: TradingSignal[]): JournalInsight[] {
  const closed = closedR(entries);
  const taken = entries.filter((entry) => entry.tradeAction === "taken" || Boolean(entry.takenAt));
  const insights: JournalInsight[] = [];

  const takenAvg = averageR(taken);
  if (typeof takenAvg === "number") {
    insights.push({
      label: "Alınan işlemler",
      value: `${takenAvg.toFixed(2)}R`,
      detail: takenAvg < 0
        ? "Gerçek alınan trade ortalaması negatif. READY bile olsa risk küçült, C grade alma ve entry onayı sertleşsin."
        : "Aldığın trade ortalaması pozitif. Aynı kuralları bozma; özellikle stop/entry notlarını standart tut."
    });
  }

  const qualityStats = countBy(closed.map((entry) => entry.executionQuality ?? "beklemede"));
  const weakQuality = qualityStats
    .map((item) => ({ ...item, avgR: averageR(closed.filter((entry) => (entry.executionQuality ?? "beklemede") === item.key)) }))
    .find((item) => item.key !== "temiz" && item.key !== "beklemede" && typeof item.avgR === "number" && item.avgR < 0);
  if (weakQuality && typeof weakQuality.avgR === "number") {
    insights.push({
      label: `Execution filtresi: ${weakQuality.key}`,
      value: `${weakQuality.avgR.toFixed(2)}R`,
      detail: `${weakQuality.count} kayıtta negatif. Bu etiketle gelen setup'larda bot READY'i pratikte WATCH gibi ele almalı.`
    });
  }

  const topMistake = countBy(entries.map((entry) => entry.mistake ?? ""))[0];
  if (topMistake && topMistake.count >= 2) {
    insights.push({
      label: "Tekrar eden hata",
      value: `${topMistake.count}x`,
      detail: `"${topMistake.key}" sık yazılmış. Aynı uyarı aktif sinyalde varsa pas geçme nedeni olarak öne çıkarılmalı.`
    });
  }

  const missed = entries.filter((entry) => entry.tradeAction === "missed").length;
  if (taken.length && missed > taken.length) {
    insights.push({
      label: "Kaçan setup",
      value: `${missed}/${taken.length}`,
      detail: "Kaçırılan setup alınandan fazla. READY bildirimini kilitle, entry kutusu ve kapanış seviyesi daha erken görünmeli."
    });
  }

  const topRuleViolation = countBy(entries.flatMap((entry) => entry.ruleViolations ?? []))[0];
  if (topRuleViolation && topRuleViolation.count >= 2) {
    insights.push({
      label: "Kural ihlali",
      value: `${topRuleViolation.count}x`,
      detail: `${topRuleViolation.key} tekrar ediyor. Bu rule fail ise aktif sinyal otomatik düşük öncelik olmalı.`
    });
  }

  const takenClosed = taken.filter((entry) => typeof entry.rMultiple === "number" && entry.result !== "open");
  insights.push(...snapshotBucketInsights(takenClosed));

  const losingBlockers = countBy(
    takenClosed
      .filter((entry) => (entry.rMultiple ?? 0) < 0)
      .flatMap((entry) => entry.latestSignalSnapshot?.blockers ?? [])
  )[0];
  if (losingBlockers && losingBlockers.count >= 2) {
    insights.push({
      label: "Kayıpta tekrar eden blocker",
      value: `${losingBlockers.count}x`,
      detail: losingBlockers.key
    });
  }

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
          ? "Bu sembolde kapanmış journal ortalaması negatif; risk düşür, HTF/PD uyumu gelmeden alma."
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
  return insights.slice(0, 8);
}
