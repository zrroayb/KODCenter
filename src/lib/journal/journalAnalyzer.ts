import type { JournalEntry, JournalInsight } from "./types";

export function journalAnalyzer(entries: JournalEntry[]): { total: number; mistakes: number; ruleViolations: number } {
  return {
    total: entries.length,
    mistakes: entries.filter((entry) => Boolean(entry.mistake)).length,
    ruleViolations: entries.reduce((sum, entry) => sum + entry.ruleViolations.length, 0)
  };
}

function countBy(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function journalInsights(entries: JournalEntry[]): JournalInsight[] {
  if (!entries.length) {
    return [{ label: "Not yok", value: "0", detail: "Sinyal notu kaydedince strateji analizi burada oluşacak." }];
  }

  const taken = entries.filter((entry) => entry.tradeAction === "taken" || Boolean(entry.takenAt));
  const skipped = entries.filter((entry) => entry.tradeAction === "skipped").length;
  const missed = entries.filter((entry) => entry.tradeAction === "missed").length;
  const mistakes = countBy(entries.map((entry) => entry.mistake ?? ""));
  const qualities = countBy(entries.map((entry) => entry.executionQuality ?? ""));
  const symbols = countBy(entries.map((entry) => entry.symbol));
  const violations = countBy(entries.flatMap((entry) => entry.ruleViolations));
  const wins = taken.filter((entry) => entry.result === "win").length;
  const losses = taken.filter((entry) => entry.result === "loss").length;
  const rEntries = taken.filter((entry) => typeof entry.rMultiple === "number" && Number.isFinite(entry.rMultiple));
  const averageR = rEntries.length
    ? rEntries.reduce((sum, entry) => sum + (entry.rMultiple ?? 0), 0) / rEntries.length
    : undefined;

  return [
    {
      label: "Kaydedilen not",
      value: String(entries.length),
      detail: `${taken.length} alınan işlem · ${skipped} pas · ${missed} kaçan setup.`
    },
    {
      label: "Alınan işlem",
      value: String(taken.length),
      detail: `${wins} win · ${losses} loss · ${taken.filter((entry) => entry.result === "breakeven").length} BE · ${taken.filter((entry) => entry.result === "open").length} açık.`
    },
    {
      label: "Ortalama R",
      value: typeof averageR === "number" ? `${averageR.toFixed(2)}R` : "yok",
      detail: rEntries.length ? `${rEntries.length} kapanmış trade R datası üzerinden.` : "Actual entry/exit girilince otomatik hesaplanır."
    },
    {
      label: "En sık hata",
      value: mistakes[0]?.[0] ?? "yok",
      detail: mistakes[0] ? `${mistakes[0][1]} kayıtta tekrar etmiş.` : "Hata etiketi girilmemiş."
    },
    {
      label: "Execution kalitesi",
      value: qualities[0]?.[0] ?? "belirsiz",
      detail: qualities[0] ? `${qualities[0][1]} kayıtta baskın kalite etiketi.` : "Taken/skip notlarında kalite seç."
    },
    {
      label: "En çok notlanan",
      value: symbols[0]?.[0] ?? "yok",
      detail: symbols[0] ? `${symbols[0][1]} kayıt ile en çok izlenen market.` : "Henüz market dağılımı yok."
    },
    {
      label: "Kural ihlali",
      value: violations[0]?.[0] ?? "yok",
      detail: violations[0] ? `${violations[0][1]} kez işaretlenmiş.` : "Kural ihlali seçilmemiş."
    }
  ];
}
