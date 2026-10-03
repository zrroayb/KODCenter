import type { RuntimeReplayTrade } from "../analytics/performance";
import { safeSetJson } from "../storage/safeStorage";

// Replay trade archive (2026-10-02). Yahoo serves 15m candles for 60 days only, so every replay
// sees just the last ~1-2 months and the exit-model gate (30 trades) never grows past one market
// regime. Each replay's RESOLVED trades are merged here (in the browser) so the sample keeps
// growing across months. Slim records only — the exit comparison needs nothing else.
//
// Bump REPLAY_ARCHIVE_VERSION whenever a CRT rule changes: trades from a different engine must not
// be mixed into one sample.
export const REPLAY_ARCHIVE_VERSION = "crt-2026-10-03-c3only";
export const REPLAY_ARCHIVE_CAP = 1500;

export type ArchivedReplayTrade = Pick<RuntimeReplayTrade, "symbol" | "direction" | "signalTime" | "entry" | "stopLoss" | "status" | "rMultiple" | "managementVariants">;

export type ReplayArchive = { version: string; trades: ArchivedReplayTrade[] };

// The same setup gets a different replay id when the 60-day window shifts; its plan does not.
export function archiveKey(trade: Pick<RuntimeReplayTrade, "symbol" | "direction" | "entry" | "stopLoss">): string {
  return `${trade.symbol}|${trade.direction}|${trade.entry.toPrecision(8)}|${trade.stopLoss.toPrecision(8)}`;
}

function resolved(trade: Pick<RuntimeReplayTrade, "status">): boolean {
  return trade.status !== "not-triggered" && trade.status !== "open";
}

// Newest first (safeSetJson trims the tail when the quota is tight).
export function mergeReplayArchive(archive: ReplayArchive | undefined, fresh: RuntimeReplayTrade[], cap = REPLAY_ARCHIVE_CAP): ReplayArchive {
  const base = archive?.version === REPLAY_ARCHIVE_VERSION ? archive.trades : [];
  const byKey = new Map(base.map((trade) => [archiveKey(trade), trade]));
  for (const trade of fresh.filter(resolved)) {
    byKey.set(archiveKey(trade), {
      symbol: trade.symbol,
      direction: trade.direction,
      signalTime: trade.signalTime,
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      status: trade.status,
      rMultiple: trade.rMultiple,
      managementVariants: trade.managementVariants
    });
  }
  const trades = [...byKey.values()].sort((a, b) => b.signalTime - a.signalTime).slice(0, cap);
  return { version: REPLAY_ARCHIVE_VERSION, trades };
}

const STORAGE_KEY = "tradebot.replayArchive.v1";

// Browser only (the worker gets the archive passed in). Never throws.
export function loadReplayArchive(): ReplayArchive | undefined {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) as ReplayArchive : undefined;
    return parsed && typeof parsed.version === "string" && Array.isArray(parsed.trades) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveReplayArchive(archive: ReplayArchive): void {
  // Trim the trade list (oldest last) rather than the wrapper object when the quota is tight.
  if (!safeSetJson(STORAGE_KEY, archive)) {
    safeSetJson(STORAGE_KEY, { ...archive, trades: archive.trades.slice(0, Math.floor(archive.trades.length / 2)) });
  }
}
