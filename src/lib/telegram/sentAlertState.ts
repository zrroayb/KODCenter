// Scanner-side dedupe memory (2026-10-02). Render's free plan has no persistent disk and sleeps
// after 15 idle minutes, so the server's alert log is wiped between sparse cron runs and a
// still-READY setup was alerted again. The GitHub Actions scanner keeps its own record of sent
// dedupe keys in a file restored/saved through actions/cache. The server dedupe stays as the
// second line of defence.
export type SentAlertState = Record<string, number>;

export const SENT_ALERT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function parseSentAlertState(raw: string | undefined, now = Date.now()): SentAlertState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && now - entry[1] <= SENT_ALERT_RETENTION_MS)
    );
  } catch {
    return {};
  }
}

// Server answers that mean "Telegram has this alert": record it so the next run never re-posts.
export function alertWasDelivered(status: string | undefined): boolean {
  return status === "sent" || status === "duplicate";
}
