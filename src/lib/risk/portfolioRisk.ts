import type { TradingSignal } from "../ict/types";
import { clusterExposure } from "../ict/symbols";
import type { JournalEntry } from "../journal/types";

// Portfolio-level risk (item 7, 2026-09-26). Warnings only — never a READY veto (CLAUDE.md:
// gates vs quality). Two READY signals on the same macro bet (e.g. EURUSD long + GBPUSD long
// = both "usd-short") are ONE position's worth of risk, not two.
export const CORRELATION_NOTE_PREFIX = "Korelasyon:";
export const DAILY_R_BRAKE = -2;

export function applyCorrelationWarnings(signals: TradingSignal[]): void {
  const ready = signals.filter((signal) => signal.stage === "ready");
  const groups = new Map<string, TradingSignal[]>();
  for (const signal of ready) {
    const { exposure } = clusterExposure(signal.symbol, signal.direction);
    groups.set(exposure, [...(groups.get(exposure) ?? []), signal]);
  }
  for (const [exposure, group] of groups) {
    const symbols = Array.from(new Set(group.map((signal) => signal.symbol)));
    if (symbols.length < 2) continue;
    const note = `${CORRELATION_NOTE_PREFIX} ${symbols.length} READY aynı ${exposure} yönünde (${symbols.join(", ")}); tek pozisyon say, toplam riski böl (her biri ~1/${symbols.length}).`;
    for (const signal of group) {
      signal.governance.warnings = Array.from(new Set([note, ...signal.governance.warnings]));
      signal.decisionSummary.warnings = Array.from(new Set([note, ...signal.decisionSummary.warnings])).slice(0, 8);
    }
  }
}

export function correlationNote(signal: TradingSignal): string | undefined {
  return signal.governance.warnings.find((warning) => warning.startsWith(CORRELATION_NOTE_PREFIX));
}

function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

// Realized R today from the journal (trades marked taken and closed with an R multiple).
export function todayRealizedR(entries: JournalEntry[], now = Date.now()): { r: number; trades: number } {
  const today = utcDay(now);
  const closed = entries.filter((entry) =>
    entry.tradeAction === "taken"
    && entry.result && entry.result !== "open"
    && typeof entry.rMultiple === "number" && Number.isFinite(entry.rMultiple)
    && utcDay(entry.closedAt ?? entry.updatedAt) === today);
  return { r: Number(closed.reduce((sum, entry) => sum + (entry.rMultiple ?? 0), 0).toFixed(2)), trades: closed.length };
}

export function dailyBrakeMessage(entries: JournalEntry[], now = Date.now()): string | undefined {
  const { r, trades } = todayRealizedR(entries, now);
  return r <= DAILY_R_BRAKE
    ? `Günlük fren: bugün ${trades} işlemde ${r}R. ${DAILY_R_BRAKE}R sınırına gelindi — yeni işlem açma, yarını bekle (uyarı, veto değil).`
    : undefined;
}
