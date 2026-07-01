import type { TradingSignal } from "../ict/types";
import { journalEntryFromSignal } from "./journalEntry";
import type { JournalEntry } from "./types";

const JOURNAL_STORAGE_KEY = "tradebot.localJournal.v1";

function storage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function loadJournalEntries(): JournalEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(JOURNAL_STORAGE_KEY) ?? "[]") as JournalEntry[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveJournalEntries(entries: JournalEntry[]): void {
  const store = storage();
  if (!store) return;
  store.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(entries));
}

export function upsertJournalEntry(
  entries: JournalEntry[],
  signal: TradingSignal,
  patch: Partial<JournalEntry>
): JournalEntry[] {
  const now = Date.now();
  const existing = entries.find((entry) => entry.tradeId === signal.id);
  const next: JournalEntry = {
    ...(existing ?? journalEntryFromSignal(signal)),
    ...patch,
    tradeId: signal.id,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    ruleViolations: patch.ruleViolations ?? existing?.ruleViolations ?? []
  };
  return [next, ...entries.filter((entry) => entry.tradeId !== signal.id)].sort((a, b) => b.updatedAt - a.updatedAt);
}

