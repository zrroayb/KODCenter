import { formatR } from "../ict/format";
import type { TradingSignal } from "../ict/types";
import { buildGeminiTradeCommentaryPayload, type GeminiTradeCommentaryPayload } from "../gemini/tradeCommentary";
import { GRADE_RISK_FACTOR } from "../risk/positionSizing";
import { defaultAccountModel } from "../risk/accountModel";

const SENT_READY_ALERTS_KEY = "tradebot.telegram.sentReadyIds";
const pendingReadyAlerts = new Set<string>();

export type TelegramReadyAlertPayload = {
  id: string;
  symbol: string;
  direction: string;
  grade: string;
  score: number;
  stage: "ready" | "watch";
  alertKind?: "ready" | "raid" | "context";
  createdAt: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  grossRR: number;
  reasons: string[];
  riskPct?: number;
  priority?: "high" | "normal" | "low";
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
  const anchors = ["crt-range", "manipulation", "choch", "entry", "dol-target"].map((id) => {
    const evidence = signal.evidence.find((item) => item.id === id);
    return `${id}:${evidence?.time ?? evidence?.candleIndex ?? "na"}:${priceBucket(evidence?.price)}`;
  });
  return [
    "ready-alert-text-v4",
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
  const rangeLabel = signal.decisionSummary.checklist.find((item) => item.label.endsWith(" Range"))?.label;
  const reasons = [
    rangeLabel && passed.has(rangeLabel) ? `${rangeLabel} hazır` : "CRT range hazır",
    passed.has("Manipulation") ? "Manipulation: CRT high/low alındı" : null,
    passed.has("ChoCH / Just") ? "ChoCH/Just mum kapanışı var" : null,
    passed.has("Entry") ? "Giriş aktif" : null,
    passed.has("RR to DOL") ? "Karşı CRT kenarı hedef" : null,
    `Net RR ${formatR(signal.plan.rr)}`
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(reasons)).slice(0, 6);
}

export function buildTelegramReadyAlertPayload(signal: TradingSignal): TelegramReadyAlertPayload {
  // Grade drives the suggested size: an A+ full risk, a C a token size. Carry the concrete
  // percentage into the alert so a low-grade READY is never mistaken for a full-size trade.
  const riskPct = Number((defaultAccountModel.riskPerTradePct * (GRADE_RISK_FACTOR[signal.grade] ?? 1)).toFixed(2));
  const priority: "high" | "normal" | "low" = signal.grade === "A+" || signal.grade === "A"
    ? "high"
    : signal.grade === "B" ? "normal" : "low";
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
    riskPct,
    priority,
    tradeContext: buildGeminiTradeCommentaryPayload(signal)
  };
}

// Early heads-up: the HTF wick took the reference extreme. The raid candle may remain open;
// the only remaining core step is the confirmation-timeframe character-shift close.
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

export function crtContextTelegramDedupeKey(signal: TradingSignal): string {
  const anchor = signal.crtAnchor;
  const bias = signal.evidence.find((item) => item.id === "crt-bias");
  return [
    "crt-context-alert-v1",
    signal.strategyId,
    signal.symbol,
    signal.direction,
    anchor?.rangeTf ?? "?",
    priceBucket(anchor?.rangeHigh),
    priceBucket(anchor?.rangeLow),
    priceBucket(bias?.price),
    bias?.time ?? bias?.candleIndex ?? "na"
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
        `${anchor.rangeTf.toUpperCase()} CRT ${signal.direction === "short" ? "high" : "low"} alındı; ${anchor.rangeTf.toUpperCase()} mum kapanışı beklenmiyor`,
        `${anchor.confirmTf} ChoCH/Just kapanışı bekleniyor`,
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

export async function notifyCrtContextSignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  const anchor = signal.crtAnchor;
  const bias = signal.evidence.find((item) => item.id === "crt-bias");
  const highTimeframe = anchor?.rangeTf === "1d" || anchor?.rangeTf === "1w";
  const fvgOriginContext = anchor?.origin === "fvg-origin";
  if (!anchor || signal.stage !== "watch" || anchor.raidActive || (!highTimeframe && !fvgOriginContext) || signal.score < 50 || (!fvgOriginContext && bias?.status !== "pass")) {
    return { status: "disabled" };
  }
  const contextLine = fvgOriginContext
    ? `${anchor.originLabel ?? "4H FVG origin CRT"} aktif: FVG taplendi, origin candle CRT range olarak izleniyor.`
    : `${anchor.rangeTf.toUpperCase()} CRT yön verdi: ${bias?.detail ?? "HTF bias aktif."}`;
  const dedupeKey = crtContextTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const payload: TelegramReadyAlertPayload = {
      ...buildTelegramReadyAlertPayload(signal),
      stage: "watch",
      alertKind: "context",
      rangeTf: anchor.rangeTf,
      confirmTf: anchor.confirmTf,
      rangeHigh: anchor.rangeHigh,
      rangeLow: anchor.rangeLow,
      reasons: [
        contextLine,
        `Bu entry değil; önce range kenarı sweep, sonra ${anchor.confirmTf} ChoCH/Just kapanışı gerekir.`,
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
    return { status: "error", error: error instanceof Error ? error.message : "Telegram context alert failed" };
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
