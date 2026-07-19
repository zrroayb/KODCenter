import type { SessionSetup, SessionSetupLifecycle, SessionSetupLog } from "./types";

const SETUP_STORAGE_KEY = "tradebot.crtSessionSetups.v1";
const LOG_STORAGE_KEY = "tradebot.crtSessionSetupLogs.v1";
const MAX_SETUP_HISTORY = 400;
const MAX_LOG_HISTORY = 1_500;

function storageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readArray<T>(key: string): T[] {
  if (!storageAvailable()) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]) {
  if (!storageAvailable()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadSessionSetups(): SessionSetup[] {
  return readArray<SessionSetup>(SETUP_STORAGE_KEY);
}

export function loadSessionSetupLogs(): SessionSetupLog[] {
  return readArray<SessionSetupLog>(LOG_STORAGE_KEY);
}

function transitionLog(previous: SessionSetup | undefined, next: SessionSetup): SessionSetupLog | undefined {
  if (previous?.lifecycleStatus === next.lifecycleStatus) return undefined;
  const eventType = previous ? "STATE_CHANGED" : "CREATED";
  return {
    id: `${next.id}:${next.lifecycleStatus}`,
    setupId: next.id,
    setupFamily: "CRT_SESSION",
    setupModel: next.setupModel,
    symbol: next.symbol,
    referenceSession: next.referenceSession,
    triggerSession: next.triggerSession,
    lifecycleStatus: next.lifecycleStatus,
    eventTimestampUtc: next.updatedAt,
    eventType,
    detail: previous
      ? `${previous.lifecycleStatus} → ${next.lifecycleStatus}`
      : `${next.setupModel} oluşturuldu.`,
    sessionProfileVersion: next.sessionProfileVersion
  };
}

const TERMINAL_STATUSES: SessionSetupLifecycle[] = ["INVALIDATED", "LATE", "EXPIRED", "COMPLETED"];

// tradingDayId = `${profileId}:${YYYY-MM-DD}` (sessionRangeEngine); tarih kısmı sözlüksel karşılaştırılabilir.
function tradingDayParts(id: string): { profile: string; date: string } | undefined {
  const splitAt = id.lastIndexOf(":");
  return splitAt > 0 ? { profile: id.slice(0, splitAt), date: id.slice(splitAt + 1) } : undefined;
}

export function reconcileSessionSetupStore(
  current: SessionSetup[],
  incoming: SessionSetup[],
  currentLogs: SessionSetupLog[],
  now: number = Date.now()
): { setups: SessionSetup[]; logs: SessionSetupLog[] } {
  const byId = new Map(current.map((setup) => [setup.id, setup]));
  const logs = [...currentLogs];
  for (const next of incoming) {
    const previous = byId.get(next.id);
    const transition = transitionLog(previous, next);
    byId.set(next.id, {
      ...previous,
      ...next,
      createdAt: previous?.createdAt ?? next.createdAt
    });
    if (transition && !logs.some((log) => log.id === transition.id)) logs.unshift(transition);
  }
  // Gün dönünce motor eski günün pair'lerini emit etmeyi bırakır; store'da donan WAITING_*
  // kayıtları burada kapatılmazsa "Canlı" sekmesinde süresiz kalır. Aynı profilin daha yeni
  // bir trading günü görüldüğü an eski günün terminal olmayan setup'ları EXPIRED olur.
  const newestDayByProfile = new Map<string, string>();
  for (const next of incoming) {
    const parts = tradingDayParts(next.tradingDayId);
    if (!parts) continue;
    const known = newestDayByProfile.get(parts.profile);
    if (!known || parts.date > known) newestDayByProfile.set(parts.profile, parts.date);
  }
  for (const [id, setup] of byId) {
    if (TERMINAL_STATUSES.includes(setup.lifecycleStatus)) continue;
    const parts = tradingDayParts(setup.tradingDayId);
    const newest = parts ? newestDayByProfile.get(parts.profile) : undefined;
    if (!newest || !parts || parts.date >= newest) continue;
    const expired: SessionSetup = {
      ...setup,
      lifecycleStatus: "EXPIRED",
      updatedAt: now,
      summary: "Trigger session bitti; temiz sequence oluşmadı."
    };
    const transition = transitionLog(setup, expired);
    byId.set(id, expired);
    if (transition && !logs.some((log) => log.id === transition.id)) logs.unshift(transition);
  }
  const setups = [...byId.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SETUP_HISTORY);
  const nextLogs = logs
    .sort((left, right) => right.eventTimestampUtc - left.eventTimestampUtc)
    .slice(0, MAX_LOG_HISTORY);
  writeArray(SETUP_STORAGE_KEY, setups);
  writeArray(LOG_STORAGE_KEY, nextLogs);
  return { setups, logs: nextLogs };
}

export function saveSessionSetupStore(setups: SessionSetup[], logs: SessionSetupLog[]) {
  writeArray(SETUP_STORAGE_KEY, setups.slice(0, MAX_SETUP_HISTORY));
  writeArray(LOG_STORAGE_KEY, logs.slice(0, MAX_LOG_HISTORY));
}
