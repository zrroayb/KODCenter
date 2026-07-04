import { formatR } from "../ict/format";
import type { TradingSignal } from "../ict/types";
import { buildGeminiTradeCommentaryPayload, type GeminiTradeCommentaryPayload } from "../gemini/tradeCommentary";

const SENT_READY_ALERTS_KEY = "tradebot.telegram.sentReadyIds";
const pendingReadyAlerts = new Set<string>();

export type TelegramReadyAlertPayload = {
  id: string;
  symbol: string;
  direction: string;
  grade: string;
  score: number;
  stage: "ready";
  createdAt: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  grossRR: number;
  reasons: string[];
  aiCommentary?: string;
  tradeContext?: GeminiTradeCommentaryPayload;
};

type TelegramAlertResponse = {
  status?: "sent" | "disabled" | "error";
  error?: string;
};

function storage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function loadSentIds(): string[] {
  const raw = storage()?.getItem(SENT_READY_ALERTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSentIds(ids: string[]) {
  storage()?.setItem(SENT_READY_ALERTS_KEY, JSON.stringify(ids.slice(-160)));
}

export function wasReadyTelegramAlertSent(signalId: string): boolean {
  return loadSentIds().includes(signalId);
}

function markReadyTelegramAlertSent(signalId: string) {
  saveSentIds(Array.from(new Set([...loadSentIds(), signalId])));
}

function priceBucket(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "na";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

export function readyTelegramDedupeKey(signal: TradingSignal): string {
  const anchors = ["sweep", "mss", "fvg", "liquidity-objective"].map((id) => {
    const evidence = signal.evidence.find((item) => item.id === id);
    return `${id}:${evidence?.time ?? evidence?.candleIndex ?? "na"}:${priceBucket(evidence?.price)}`;
  });
  return [
    "ready-alert-text-v3",
    signal.strategyId,
    signal.symbol,
    signal.direction,
    ...anchors,
    `sl:${priceBucket(signal.plan.stopLoss)}`,
    `tp1:${priceBucket(signal.plan.targets[0])}`
  ].join("|");
}

function readyReasons(signal: TradingSignal): string[] {
  const passed = new Set(signal.decisionSummary.checklist.filter((item) => item.status === "pass").map((item) => item.label));
  const reasons = [
    signal.plan.entryStatus === "confirmed" ? "Entry modeli onaylı" : null,
    passed.has("Liquidity Sweep") ? "Liquidity sweep + reclaim var" : null,
    signal.plan.entryModel.cisdConfirmed || passed.has("MSS") || passed.has("BOS / CHOCH") ? "BOS/CHOCH · MSS / CISD kapanışı var" : null,
    passed.has("FVG") ? "FVG / iFVG planı map edildi" : null,
    passed.has("SMT") ? "SMT pair teyidi var" : null,
    `Net RR ${formatR(signal.plan.rr)}`
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(reasons)).slice(0, 5);
}

export function buildTelegramReadyAlertPayload(signal: TradingSignal): TelegramReadyAlertPayload {
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    grade: signal.grade,
    score: signal.score,
    stage: "ready",
    createdAt: signal.createdAt,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    targets: signal.plan.targets.slice(0, 2),
    rr: signal.plan.rr,
    grossRR: signal.plan.grossRR,
    reasons: readyReasons(signal),
    tradeContext: buildGeminiTradeCommentaryPayload(signal)
  };
}

export async function notifyReadySignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  if (signal.stage !== "ready") return { status: "disabled" };
  const dedupeKey = readyTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTelegramReadyAlertPayload(signal))
    });
    const result = await response.json().catch(() => ({})) as TelegramAlertResponse;
    if (response.ok && result.status === "sent") {
      markReadyTelegramAlertSent(dedupeKey);
    }
    return result;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    pendingReadyAlerts.delete(dedupeKey);
  }
}
