// Server-side gate for Telegram alerts (Render / `vite preview`). One alert engine:
// GitHub Actions `scripts/cloud-scan.ts` scans with the current engine and POSTs READY
// payloads here with `Authorization: Bearer $SCAN_TOKEN`. The browser never sends alerts.
// Dedupe lives here (not in each browser's localStorage), in a small JSON file.
import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function isAuthorizedScan(authorization: string | undefined, token: string | undefined): boolean {
  if (!token) return false;
  const supplied = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

type StoredAlert = { dedupeKey: string; status: "pending" | "sent"; at: number; record?: unknown };

// Keys are kept long enough to cover a setup's whole READY life; history is served for 24h.
const DEDUPE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
// A pending claim whose send never finished (crash) frees up after this.
const PENDING_TIMEOUT_MS = 2 * 60 * 1000;

export type AlertStore = {
  claim(dedupeKey: string, now?: number): boolean;
  markSent(dedupeKey: string, record: unknown, now?: number): void;
  release(dedupeKey: string): void;
  recent(now?: number): unknown[];
};

// Render's disk is ephemeral: the file survives restarts of the same instance but not a
// redeploy, so a still-READY setup can re-alert once after a deploy. Accepted for simplicity.
export function createAlertStore(path: string): AlertStore {
  let entries = new Map<string, StoredAlert>();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredAlert[];
    if (Array.isArray(parsed)) entries = new Map(parsed.filter((item) => typeof item?.dedupeKey === "string").map((item) => [item.dedupeKey, item]));
  } catch {
    // Missing or corrupt file: start empty.
  }
  const persist = (now: number) => {
    for (const [key, item] of entries) if (now - item.at > DEDUPE_RETENTION_MS) entries.delete(key);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify([...entries.values()]));
    } catch {
      // Disk write failure keeps the in-memory dedupe working.
    }
  };
  return {
    claim(dedupeKey, now = Date.now()) {
      const existing = entries.get(dedupeKey);
      if (existing && (existing.status === "sent" || now - existing.at < PENDING_TIMEOUT_MS)) return false;
      entries.set(dedupeKey, { dedupeKey, status: "pending", at: now });
      return true;
    },
    markSent(dedupeKey, record, now = Date.now()) {
      entries.set(dedupeKey, { dedupeKey, status: "sent", at: now, record });
      persist(now);
    },
    release(dedupeKey) {
      entries.delete(dedupeKey);
    },
    recent(now = Date.now()) {
      return [...entries.values()]
        .filter((item) => item.status === "sent" && item.record && now - item.at <= HISTORY_WINDOW_MS)
        .sort((a, b) => b.at - a.at)
        .slice(0, 30)
        .map((item) => item.record);
    }
  };
}
