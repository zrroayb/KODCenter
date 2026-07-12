import type { TradingSignal } from "../ict/types";
import { journalEntryFromSignal, journalSetupKey, journalSignalSnapshot } from "./journalEntry";
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
  const setupKey = journalSetupKey(signal);
  const existing = entries.find((entry) => entry.tradeId === signal.id)
    ?? entries.find((entry) => entry.setupKey === setupKey && (entry.result ?? "open") === "open");
  const action = patch.tradeAction ?? existing?.tradeAction ?? "watch";
  const result = patch.result ?? existing?.result ?? "open";
  const snapshot = journalSignalSnapshot(signal);
  const previousEvent = existing?.history?.at(-1);
  const actionChanged = !previousEvent || previousEvent.action !== action || previousEvent.result !== result;
  const history = actionChanged
    ? [...(existing?.history ?? []), { at: now, action, result, stage: signal.stage, score: signal.score }].slice(-40)
    : existing?.history ?? [];
  const next: JournalEntry = {
    ...(existing ?? journalEntryFromSignal(signal)),
    ...patch,
    tradeId: existing?.tradeId ?? signal.id,
    setupKey,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
    ruleViolations: patch.ruleViolations ?? existing?.ruleViolations ?? [],
    signalSnapshot: existing?.signalSnapshot ?? snapshot,
    latestSignalSnapshot: snapshot,
    history
  };
  return [next, ...entries.filter((entry) => entry.tradeId !== next.tradeId)].sort((a, b) => b.updatedAt - a.updatedAt);
}
