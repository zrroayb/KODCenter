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
  stage: "ready" | "watch";
  alertKind?: "ready" | "raid";
  createdAt: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  grossRR: number;
  reasons: string[];
  rangeTf?: string;
  confirmTf?: string;
  rangeHigh?: number;
  rangeLow?: number;
  raidClosed?: boolean;
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
  const anchors = ["crt-bias", "crt-range", "poi", "manipulation", "choch", "dol-target"].map((id) => {
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
    `eq:${priceBucket(signal.plan.targets[0])}`,
    `dol:${priceBucket(signal.plan.targets[1])}`
  ].join("|");
}

function readyReasons(signal: TradingSignal): string[] {
  const passed = new Set(signal.decisionSummary.checklist.filter((item) => item.status === "pass").map((item) => item.label));
  const reasons = [
    passed.has("CRT Bias / DOL") ? "CRT bias ve DOL net" : null,
    passed.has("Premium / Discount") ? "Doğru premium/discount bölgesi" : null,
    passed.has("POI Touch") ? "POI teması var" : null,
    passed.has("Manipulation") ? "Manipulation sweep + reclaim var" : null,
    passed.has("ChoCH / Just") ? "ChoCH/Just mum kapanışı var" : null,
    passed.has("SMT") ? "SMT kalite teyidi var" : null,
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

// Early heads-up: the HTF raid formed and the reclaim holds — the trader should now watch
// the confirmation timeframe for ChoCH + retest. Fires once per raid (range-level keyed).
export function raidTelegramDedupeKey(signal: TradingSignal): string {
  const anchor = signal.crtAnchor;
  return [
    "raid-alert-v1",
    signal.strategyId,
    signal.symbol,
    signal.direction,
    anchor?.rangeTf ?? "?",
    priceBucket(anchor?.rangeHigh),
    priceBucket(anchor?.rangeLow)
  ].join("|");
}

export async function notifyRaidSignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  const anchor = signal.crtAnchor;
  if (!anchor?.raidActive || signal.stage !== "watch") return { status: "disabled" };
  const dedupeKey = raidTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const payload: TelegramReadyAlertPayload = {
      ...buildTelegramReadyAlertPayload(signal),
      stage: "watch",
      alertKind: "raid",
      rangeTf: anchor.rangeTf,
      confirmTf: anchor.confirmTf,
      rangeHigh: anchor.rangeHigh,
      rangeLow: anchor.rangeLow,
      raidClosed: anchor.raidClosed,
      reasons: [
        `${anchor.rangeTf.toUpperCase()} CRT range ${signal.direction === "short" ? "high" : "low"} raid edildi${anchor.raidClosed ? " ve mum içeri kapandı" : ""}`,
        `${anchor.confirmTf} ChoCH/Just kapanışı + retest bekleniyor`,
        ...(signal.governance.blockers.slice(0, 2))
      ],
      tradeContext: undefined
    };
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
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
