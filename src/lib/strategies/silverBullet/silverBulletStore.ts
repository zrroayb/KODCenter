import { silverBulletTransitionLog } from "./silverBulletEngine";
import type { SilverBulletLog, SilverBulletSetup } from "./types";

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

// Idempotent reconcile: the same deterministic setup never duplicates across scanner cycles,
// and lifecycle logs are emitted once per (setup, status).
export function reconcileSilverBulletStore(
  current: SilverBulletSetup[],
  incoming: SilverBulletSetup[],
  currentLogs: SilverBulletLog[]
): { setups: SilverBulletSetup[]; logs: SilverBulletLog[] } {
  const byId = new Map(current.map((setup) => [setup.setupId, setup]));
  const logs = [...currentLogs];
  for (const next of incoming) {
    const previous = byId.get(next.setupId);
    const transition = silverBulletTransitionLog(previous, next);
    byId.set(next.setupId, { ...previous, ...next, createdAtUtc: previous?.createdAtUtc ?? next.createdAtUtc });
    if (transition && !logs.some((log) => log.id === transition.id)) logs.unshift(transition);
  }
  const setups = [...byId.values()].sort((a, b) => b.updatedAtUtc - a.updatedAtUtc).slice(0, MAX_SETUPS);
  const nextLogs = logs.sort((a, b) => b.eventTimestampUtc - a.eventTimestampUtc).slice(0, MAX_LOGS);
  writeArray(SETUP_KEY, setups);
  writeArray(LOG_KEY, nextLogs);
  return { setups, logs: nextLogs };
}
