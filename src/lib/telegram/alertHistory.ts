import type { TradingSignal } from "../ict/types";
import {
  readyTelegramDedupeKey,
  telegramAlertRecordFromSignal,
  type TelegramAlertRecord
} from "./alertPayload";
import { signalSetupIdentity } from "../signals/setupIdentity";

export const TELEGRAM_ALERT_HISTORY_KEY = "tradebot.telegram.alertHistory.v1";
export const SENT_READY_ALERTS_KEY = "tradebot.telegram.sentReadyIds";
export const TELEGRAM_ALERT_RETENTION_MS = 24 * 60 * 60 * 1000;

function browserStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function isAlertRecord(value: unknown): value is TelegramAlertRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TelegramAlertRecord>;
  return typeof record.dedupeKey === "string"
    && typeof record.signalId === "string"
    && typeof record.symbol === "string"
    && typeof record.sentAt === "number";
}

function prune(records: TelegramAlertRecord[], now: number): TelegramAlertRecord[] {
  return records
    .filter((record) => now - record.sentAt <= TELEGRAM_ALERT_RETENTION_MS)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, 30);
}

export function loadSentReadyAlertKeys(): string[] {
  const raw = browserStorage()?.getItem(SENT_READY_ALERTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function loadTelegramAlertHistory(now = Date.now()): TelegramAlertRecord[] {
  const raw = browserStorage()?.getItem(TELEGRAM_ALERT_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return prune(Array.isArray(parsed) ? parsed.filter(isAlertRecord) : [], now);
  } catch {
    return [];
  }
}

export function saveTelegramAlertHistory(records: TelegramAlertRecord[], now = Date.now()): TelegramAlertRecord[] {
  const next = prune(records, now);
  browserStorage()?.setItem(TELEGRAM_ALERT_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function mergeTelegramAlertHistories(
  ...histories: TelegramAlertRecord[][]
): TelegramAlertRecord[] {
  const byKey = new Map<string, TelegramAlertRecord>();
  for (const record of histories.flat()) {
    const previous = byKey.get(record.dedupeKey);
    if (!previous || record.sentAt >= previous.sentAt) byKey.set(record.dedupeKey, record);
  }
  return [...byKey.values()].sort((a, b) => b.sentAt - a.sentAt);
}

export function upsertTelegramAlertRecord(
  records: TelegramAlertRecord[],
  record: TelegramAlertRecord,
  now = Date.now()
): TelegramAlertRecord[] {
  return prune(mergeTelegramAlertHistories(records, [record]), now);
}

export function matchingSignalForAlert(
  record: TelegramAlertRecord,
  signals: TradingSignal[]
): TradingSignal | undefined {
  return signals.find((signal) => signal.id === record.signalId)
    ?? (record.setupKey ? signals.find((signal) => signalSetupIdentity(signal) === record.setupKey) : undefined)
    ?? signals.find((signal) => readyTelegramDedupeKey(signal) === record.dedupeKey);
}

export function reconcileTelegramAlertHistory(
  records: TelegramAlertRecord[],
  signals: TradingSignal[],
  now = Date.now(),
  sentKeys = loadSentReadyAlertKeys()
): TelegramAlertRecord[] {
  const sent = new Set(sentKeys);
  const recovered = sent.size
    ? signals
      .filter((signal) => sent.has(readyTelegramDedupeKey(signal)))
      .map((signal) => telegramAlertRecordFromSignal(signal, signal.createdAt || now))
    : [];
  const merged = mergeTelegramAlertHistories(records, recovered);
  const updated = merged.map((record) => {
    const signal = matchingSignalForAlert(record, signals);
    return signal ? {
      ...record,
      currentStage: signal.stage,
      lastSeenAt: now
    } : record;
  });
  return prune(updated, now);
}

export async function fetchCloudTelegramAlertHistory(): Promise<TelegramAlertRecord[]> {
  try {
    const response = await fetch("/api/live-alerts", { headers: { accept: "application/json" } });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return [];
    const body = await response.json() as { alerts?: unknown[] };
    return Array.isArray(body.alerts) ? body.alerts.filter(isAlertRecord) : [];
  } catch {
    return [];
  }
}
