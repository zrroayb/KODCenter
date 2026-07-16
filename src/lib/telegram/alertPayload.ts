import { formatR } from "../ict/format";
import type { TradingSignal } from "../ict/types";
import { buildGeminiTradeCommentaryPayload, type GeminiTradeCommentaryPayload } from "../gemini/tradeCommentary";
import { defaultAccountModel } from "../risk/accountModel";
import { GRADE_RISK_FACTOR } from "../risk/positionSizing";

export type TelegramReadyAlertPayload = {
  id: string;
  dedupeKey?: string;
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
  charts?: Array<{ label?: string; dataUrl?: string }>;
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

function readyReasons(signal: TradingSignal): string[] {
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
    `Net RR ${formatR(signal.plan.rr)}`
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(reasons)).slice(0, 6);
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
