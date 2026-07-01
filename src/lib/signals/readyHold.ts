import type { TradingSignal } from "../ict/types";

export const READY_HOLD_MS = 30 * 60 * 1000;

export type ReadyHoldRecord = {
  signature: string;
  signal: TradingSignal;
  expiresAt: number;
};

function priceBucket(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "na";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

export function readyHoldSignature(signal: TradingSignal): string {
  const anchors = ["sweep", "mss", "fvg"].map((id) => {
    const evidence = signal.evidence.find((item) => item.id === id);
    return `${id}:${evidence?.time ?? evidence?.candleIndex ?? "na"}:${priceBucket(evidence?.price)}`;
  });
  return [signal.strategyId, signal.symbol, signal.direction, ...anchors].join("|");
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
