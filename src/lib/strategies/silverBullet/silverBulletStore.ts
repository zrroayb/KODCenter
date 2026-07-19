import { silverBulletTransitionLog } from "./silverBulletEngine";
import type { SbLifecycle, SilverBulletLog, SilverBulletSetup } from "./types";

// Separate SILVER_BULLET_SETUP persistence — never mixed into CRT/session stores (Master §27).
const SETUP_KEY = "tradebot.silverBulletSetups.v1";
const LOG_KEY = "tradebot.silverBulletLogs.v1";
const MAX_SETUPS = 200;
const MAX_LOGS = 1_000;

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

export function loadSilverBulletSetups(): SilverBulletSetup[] {
  return readArray<SilverBulletSetup>(SETUP_KEY);
}

export function loadSilverBulletLogs(): SilverBulletLog[] {
  return readArray<SilverBulletLog>(LOG_KEY);
}

// Giriş dolmadan pencereyi kaçırmış her durum; ENTRY_FILLED ve sonrası pencereden bağımsız
// yaşar (katı 11:00 kuralı girişe uygulanır, çıkışa değil) ve terminal durumlara dokunulmaz.
const PRE_ENTRY_STATUSES: SbLifecycle[] = [
  "PRE_REFERENCE", "REFERENCE_BUILDING", "REFERENCE_LOCKED", "WINDOW_OPEN",
  "WAITING_FOR_SWEEP", "HIGH_SWEPT", "LOW_SWEPT", "WAITING_FOR_RECLAIM",
  "RECLAIM_CONFIRMED", "WAITING_FOR_DISPLACEMENT", "WAITING_FOR_STRUCTURE_SHIFT",
  "WAITING_FOR_ENTRY_ARRAY", "ORDER_PENDING"
];
const WINDOW_CLOSE_GRACE_MS = 5 * 60 * 1000;

// Idempotent reconcile: the same deterministic setup never duplicates across scanner cycles,
// and lifecycle logs are emitted once per (setup, status).
export function reconcileSilverBulletStore(
  current: SilverBulletSetup[],
  incoming: SilverBulletSetup[],
  currentLogs: SilverBulletLog[],
  now: number = Date.now()
): { setups: SilverBulletSetup[]; logs: SilverBulletLog[] } {
  const byId = new Map(current.map((setup) => [setup.setupId, setup]));
  const logs = [...currentLogs];
  for (const next of incoming) {
    const previous = byId.get(next.setupId);
    const transition = silverBulletTransitionLog(previous, next);
    byId.set(next.setupId, { ...previous, ...next, createdAtUtc: previous?.createdAtUtc ?? next.createdAtUtc });
    if (transition && !logs.some((log) => log.id === transition.id)) logs.unshift(transition);
  }
  // Motor 11:00'ı ancak yeniden tarama olursa uygular; uygulama pencere kapanırken açık
  // değilse store'da ORDER_PENDING/WAITING_* donar ve ertesi gün canlı gibi listelenir.
  // Pencere + tolerans geçtiyse giriş-öncesi her durum burada EXPIRED'a kapatılır.
  for (const [id, setup] of byId) {
    if (!PRE_ENTRY_STATUSES.includes(setup.lifecycleStatus)) continue;
    if (now <= setup.windowEndUtc + WINDOW_CLOSE_GRACE_MS) continue;
    const expired: SilverBulletSetup = {
      ...setup,
      lifecycleStatus: "EXPIRED",
      updatedAtUtc: now,
      summary: "Pencere 11:00 NY'de kapandı; giriş dolmadı."
    };
    const transition = silverBulletTransitionLog(setup, expired);
    byId.set(id, expired);
    if (transition && !logs.some((log) => log.id === transition.id)) logs.unshift(transition);
  }
  const setups = [...byId.values()].sort((a, b) => b.updatedAtUtc - a.updatedAtUtc).slice(0, MAX_SETUPS);
  const nextLogs = logs.sort((a, b) => b.eventTimestampUtc - a.eventTimestampUtc).slice(0, MAX_LOGS);
  writeArray(SETUP_KEY, setups);
  writeArray(LOG_KEY, nextLogs);
  return { setups, logs: nextLogs };
}
