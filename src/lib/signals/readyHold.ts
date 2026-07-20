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

function heldReadySignal(record: ReadyHoldRecord, current: TradingSignal): TradingSignal {
  const holdWarning = "READY sinyal kilidi aktif: plan stop/TP görülene kadar WATCH'a düşürülmedi.";
  return {
    ...record.signal,
    context: current.context,
    decisionSummary: {
      ...record.signal.decisionSummary,
      warnings: Array.from(new Set([holdWarning, ...record.signal.decisionSummary.warnings]))
    },
    riskWarnings: Array.from(new Set([holdWarning, ...record.signal.riskWarnings]))
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
    if (signal.stage === "invalidated" || signal.stage === "missed") {
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
