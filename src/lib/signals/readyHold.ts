import type { TradingSignal } from "../ict/types";
import { signalSetupIdentity } from "./setupIdentity";

export const READY_HOLD_MS = 30 * 60 * 1000;

export type ReadyHoldRecord = {
  signature: string;
  signal: TradingSignal;
  expiresAt: number;
};

export function readyHoldSignature(signal: TradingSignal): string {
  return signalSetupIdentity(signal);
}

// The hold only smooths a READY that flickers to WATCH between scans. When the engine names a
// concrete structural reason the setup is gone, the hold must let go at once — it used to keep
// showing "ALINABİLİR" for 30 minutes after e.g. the HTF turned against the trade.
const RELEASING_BLOCKERS = [
  "HTF yönü ters",
  "Key level yok",
  "Candle 2",
  "Candle 3",
  "%50/EQ",
  "kovalanmaz",
  "Veri eski",
  "Manipulation yok",
  "reclaim yok",
  "Stop entry'nin yanlış tarafında",
  "Gerçek distribution/DOL hedefi yok",
  "CRT range P/D yanlış"
];

export function holdMustRelease(signal: TradingSignal): boolean {
  return signal.governance.blockers.some((blocker) => RELEASING_BLOCKERS.some((part) => blocker.includes(part)));
}

function heldReadySignal(record: ReadyHoldRecord, current: TradingSignal): TradingSignal {
  const holdWarning = "READY sinyal kilidi aktif: motor bu taramada READY demedi ama somut bir bozulma da yok; kilit en fazla 30 dk sürer.";
  return {
    ...record.signal,
    context: current.context,
    decisionSummary: {
      ...record.signal.decisionSummary,
      warnings: Array.from(new Set([holdWarning, ...record.signal.decisionSummary.warnings]))
    },
    riskWarnings: Array.from(new Set([holdWarning, ...record.signal.riskWarnings])),
    readyHoldExpiresAt: record.expiresAt
  };
}

export function mergeReadyHoldSignals(
  currentSignals: TradingSignal[],
  records: Record<string, ReadyHoldRecord>,
  now: number,
  holdMs = READY_HOLD_MS
): { signals: TradingSignal[]; records: Record<string, ReadyHoldRecord> } {
  const nextRecords: Record<string, ReadyHoldRecord> = Object.fromEntries(
    Object.entries(records).filter(([, record]) => record.expiresAt > now)
  );

  const signals = currentSignals.map((signal) => {
    const signature = readyHoldSignature(signal);
    if (signal.stage === "invalidated" || signal.stage === "missed" || holdMustRelease(signal)) {
      delete nextRecords[signature];
      return signal;
    }
    if (signal.stage === "ready") {
      nextRecords[signature] = { signature, signal, expiresAt: now + holdMs };
      return signal;
    }
    const held = nextRecords[signature];
    return held ? heldReadySignal(held, signal) : signal;
  });

  return { signals, records: nextRecords };
}
