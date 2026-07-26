import { formatR } from "../ict/format";
import type { SignalStage, TradingSignal } from "../ict/types";
import { buildGeminiTradeCommentaryPayload, type GeminiTradeCommentaryPayload } from "../gemini/tradeCommentary";
import { defaultAccountModel } from "../risk/accountModel";
import { GRADE_RISK_FACTOR } from "../risk/positionSizing";
import { signalSetupIdentity } from "../signals/setupIdentity";
import { playbookLabel } from "../strategies/playbookLabels";

export type TelegramReadyAlertPayload = {
  id: string;
  dedupeKey?: string;
  setupKey?: string;
  symbol: string;
  direction: string;
  grade: string;
  score: number;
  stage: "ready" | "watch";
  alertKind?: "ready" | "raid" | "context";
  playbook?: string;
  strategyId?: string;
  createdAt: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  grossRR: number;
  managementRR?: number;
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
  charts?: Array<{ label?: string; dataUrl?: string }>;
};

export type TelegramAlertRecord = {
  dedupeKey: string;
  setupKey?: string;
  signalId: string;
  symbol: string;
  direction: string;
  grade: string;
  score: number;
  sentAt: number;
  createdAt: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  reasons: string[];
  alertKind: "ready" | "raid" | "context";
  rangeTf?: string;
  confirmTf?: string;
  currentStage?: SignalStage;
  lastSeenAt?: number;
};

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

function crtReadyReasons(signal: TradingSignal): string[] {
  const passed = new Set(
    signal.decisionSummary.checklist
      .filter((item) => item.status === "pass")
      .map((item) => item.label)
  );
  const rangeLabel = signal.decisionSummary.checklist.find((item) => item.label.endsWith(" Range"))?.label;
  const reasons = [
    rangeLabel && passed.has(rangeLabel) ? `${rangeLabel} hazır` : "CRT range hazır",
    passed.has("Manipulation") ? "Manipulation: CRT high/low alındı" : null,
    passed.has("ChoCH / Just") ? "ChoCH/Just mum kapanışı var" : null,
    passed.has("Entry") ? "Giriş aktif" : null,
    passed.has("RR to DOL") ? "Karşı CRT kenarı hedef" : null,
    `EQ net RR ${formatR(signal.plan.managementRR ?? 0)} · DOL net RR ${formatR(signal.plan.rr)}`
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(reasons)).slice(0, 6);
}

// Continuation, CRT'nin EQ/DOL/ChoCH şablonunu kullanamaz — kendi checklist'inden (HTF trend,
// kabullü breakout, pullback POI, retest, likidite hedefi) üretir.
function genericReadyReasons(signal: TradingSignal): string[] {
  const passed = signal.decisionSummary.checklist.filter((item) => item.status === "pass").map((item) => item.label);
  const reasons = [...passed, `net RR ${formatR(signal.plan.rr)}`];
  return Array.from(new Set(reasons)).slice(0, 6);
}

function readyReasons(signal: TradingSignal): string[] {
  return signal.strategyId === "crt" ? crtReadyReasons(signal) : genericReadyReasons(signal);
}

export function buildTelegramReadyAlertPayload(signal: TradingSignal): TelegramReadyAlertPayload {
  const riskPct = Number(
    (defaultAccountModel.riskPerTradePct * (GRADE_RISK_FACTOR[signal.grade] ?? 1)).toFixed(2)
  );
  const priority: "high" | "normal" | "low" = signal.grade === "A+" || signal.grade === "A"
    ? "high"
    : signal.grade === "B" ? "normal" : "low";

  return {
    id: signal.id,
    dedupeKey: readyTelegramDedupeKey(signal),
    setupKey: signalSetupIdentity(signal),
    symbol: signal.symbol,
    direction: signal.direction,
    grade: signal.grade,
    score: signal.score,
    stage: "ready",
    playbook: playbookLabel(signal.strategyId),
    strategyId: signal.strategyId,
    createdAt: signal.createdAt,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    targets: signal.plan.targets.slice(0, 2),
    rr: signal.plan.rr,
    grossRR: signal.plan.grossRR,
    managementRR: signal.plan.managementRR,
    reasons: readyReasons(signal),
    riskPct,
    priority,
    tradeContext: buildGeminiTradeCommentaryPayload(signal)
  };
}

export function telegramAlertRecordFromPayload(
  payload: TelegramReadyAlertPayload,
  sentAt = Date.now()
): TelegramAlertRecord {
  return {
    dedupeKey: payload.dedupeKey || `payload|${payload.id}`,
    setupKey: payload.setupKey,
    signalId: payload.id,
    symbol: payload.symbol,
    direction: payload.direction,
    grade: payload.grade,
    score: payload.score,
    sentAt,
    createdAt: payload.createdAt,
    entry: payload.entry,
    stopLoss: payload.stopLoss,
    targets: payload.targets.slice(0, 2),
    rr: payload.rr,
    reasons: payload.reasons.slice(0, 6),
    alertKind: payload.alertKind ?? "ready",
    rangeTf: payload.rangeTf,
    confirmTf: payload.confirmTf,
    currentStage: payload.stage,
    lastSeenAt: sentAt
  };
}

export function telegramAlertRecordFromSignal(
  signal: TradingSignal,
  sentAt = Date.now()
): TelegramAlertRecord {
  const payload = buildTelegramReadyAlertPayload(signal);
  return telegramAlertRecordFromPayload({
    ...payload,
    rangeTf: signal.crtAnchor?.rangeTf,
    confirmTf: signal.crtAnchor?.confirmTf
  }, sentAt);
}
