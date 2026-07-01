import type { TradingSignal } from "../ict/types";
import { formatPrice, formatR } from "../ict/format";

export type GeminiTradeCommentaryPayload = {
  id: string;
  symbol: string;
  direction: string;
  stage: string;
  grade: string;
  score: number;
  entry: number;
  stopLoss: number;
  targets: number[];
  rr: number;
  grossRR: number;
  entryModel: {
    source: string;
    status: string;
    retested: boolean;
    cisdConfirmed: boolean;
    fairValueGap?: {
      source: string;
      direction: string;
      low: number;
      high: number;
      midpoint: number;
      mitigated: boolean;
    };
  };
  context: {
    dailyBias: string;
    h4Bias: string;
    h1Bias: string;
    premiumDiscount: string;
    session: string;
    dataFeed: string;
  };
  checklist: Array<{
    label: string;
    status: string;
    explanation: string;
  }>;
  warnings: string[];
  invalidation: string[];
  evidence: Array<{
    label: string;
    status: string;
    detail: string;
  }>;
};

export type GeminiTradeCommentaryResponse = {
  status: "ready" | "fallback" | "disabled" | "error";
  commentary?: string;
  model?: string;
  reason?: string;
  error?: string;
};

function localTradeCommentary(signal: TradingSignal, reason?: string): GeminiTradeCommentaryResponse {
  const warning = [...signal.decisionSummary.warnings, ...signal.plan.planWarnings, ...signal.riskWarnings][0];
  const wait = signal.stage === "ready"
    ? "Plan hazır; entry, stop ve TP seviyeleri belli."
    : signal.stage === "missed"
      ? "Entry kaçmış veya hedefe gitmiş; kovalamadan yeni setup bekle."
      : signal.stage === "invalidated"
        ? "Setup bozulmuş; yeni model bekle."
        : signal.plan.entryStatus === "confirmed"
          ? "Entry modeli var ama kalite/RR/filtreler için bekle."
          : "Retest ve MSS/CISD kapanış onayı bekle.";
  const commentary = [
    `Yerel özet: ${signal.symbol} ${signal.direction.toUpperCase()} ${signal.stage.toUpperCase()} · ${signal.grade} · ${formatR(signal.plan.rr)}.`,
    `Dikkat: ${warning ?? `${signal.context.premiumDiscount.zone} bölgesi, HTF ${signal.context.bias.daily}/${signal.context.bias.h4}/${signal.context.bias.h1}.`}`,
    `Bekle/Plan: ${wait}`,
    `Invalidation: ${signal.direction === "short" ? "Stop üstü" : "Stop altı"} ${formatPrice(signal.plan.stopLoss)}.`
  ].join("\n");
  return {
    status: "fallback",
    commentary,
    model: "local-fallback",
    reason
  };
}

export function buildGeminiTradeCommentaryPayload(signal: TradingSignal): GeminiTradeCommentaryPayload {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const planGap = (signal.plan.entrySource === "fvg-retest" || signal.plan.entrySource === "ifvg-retest") ? signal.plan.entryModel.fairValueGap : undefined;
  return {
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    stage: signal.stage,
    grade: signal.grade,
    score: signal.score,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    targets: signal.plan.targets.slice(0, 2),
    rr: signal.plan.rr,
    grossRR: signal.plan.grossRR,
    entryModel: {
      source: signal.plan.entrySource,
      status: signal.plan.entryStatus,
      retested: signal.plan.entryModel.retested,
      cisdConfirmed: signal.plan.entryModel.cisdConfirmed,
      fairValueGap: planGap
        ? {
            source: signal.plan.entrySource,
            direction: planGap.direction,
            low: planGap.low,
            high: planGap.high,
            midpoint: planGap.midpoint,
            mitigated: planGap.mitigated
          }
        : undefined
    },
    context: {
      dailyBias: signal.context.bias.daily,
      h4Bias: signal.context.bias.h4,
      h1Bias: signal.context.bias.h1,
      premiumDiscount: signal.context.premiumDiscount.zone,
      session: activeSession,
      dataFeed: signal.context.dataFeed.source
    },
    checklist: signal.decisionSummary.checklist.slice(0, 10).map((item) => ({
      label: item.label,
      status: item.status,
      explanation: item.explanation
    })),
    warnings: Array.from(new Set([
      ...signal.decisionSummary.warnings,
      ...signal.plan.planWarnings,
      ...signal.riskWarnings
    ])).slice(0, 8),
    invalidation: signal.decisionSummary.invalidation.slice(0, 3),
    evidence: signal.evidence.slice(0, 10).map((item) => ({
      label: item.label,
      status: item.status,
      detail: item.detail
    }))
  };
}

export async function fetchGeminiTradeCommentary(signal: TradingSignal): Promise<GeminiTradeCommentaryResponse> {
  try {
    const payload = buildGeminiTradeCommentaryPayload(signal);
    const response = await fetch("/api/gemini/trade-commentary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({
      status: "error",
      error: "Gemini yorumu okunamadı."
    })) as GeminiTradeCommentaryResponse;
    if (result.status === "error") {
      return localTradeCommentary(signal, result.error ?? result.reason);
    }
    return result;
  } catch (error) {
    return localTradeCommentary(signal, error instanceof Error ? error.message : String(error));
  }
}
