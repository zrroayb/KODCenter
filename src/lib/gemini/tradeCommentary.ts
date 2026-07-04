import type { TradingSignal } from "../ict/types";
import { formatPrice, formatR } from "../ict/format";
import { selectedSignalAnnotations } from "../charts/selectedSignal";
import { buildStructureAudit } from "../signals/structureAudit";
import { closeConfirmationRequirement } from "../signals/waitingGuidance";

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
    monthlyBias: string;
    weeklyBias: string;
    dailyBias: string;
    h4Bias: string;
    h1Bias: string;
    crtBias: string;
    dol: number;
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
  structureAudit: {
    verdict: string;
    headline: string;
    decision: string;
    items: Array<{
      label: string;
      status: string;
      detail: string;
    }>;
    simpleFacts: string[];
  };
  chart: {
    timeframe: "15m" | "5m";
    lastPrice: number;
    decisionLine: string;
    waitingFor: string[];
    keyLevels: Array<{
      label: string;
      price?: number;
      zone?: [number, number];
      reason: string;
    }>;
    annotations: {
      sweep?: {
        side: string;
        level: number;
        candleIndex: number;
        reclaimed: boolean;
      };
      mss?: {
        direction: string;
        level: number;
        candleIndex: number;
      };
      displacement?: {
        direction: string;
        candleIndex: number;
        bodyRatio: number;
        rangeAtr: number;
      };
      fairValueGap?: {
        source: string;
        direction: string;
        low: number;
        high: number;
        midpoint: number;
        mitigated: boolean;
        candleIndex: number;
      };
      smt?: {
        partner: string;
        side: string;
        note: string;
      };
    };
    recentCandles: Array<{
      index: number;
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      role?: string;
    }>;
  };
};

export type GeminiTradeCommentaryResponse = {
  status: "ready" | "fallback" | "disabled" | "error";
  commentary?: string;
  model?: string;
  reason?: string;
  error?: string;
};

function localTradeCommentary(signal: TradingSignal, reason?: string): GeminiTradeCommentaryResponse {
  const audit = buildStructureAudit(signal);
  const firstIssue = audit.items.find((item) => item.status !== "pass");
  const commentary = [
    `Karar: ${audit.headline}`,
    `Neden: ${audit.decision}`,
    `Beklenen: ${firstIssue?.detail ?? "CRT sırası tamam; retest disiplinini koru, displacement kovalanmaz."}`,
    `Risk: ${formatR(signal.plan.rr)} · SL ${formatPrice(signal.plan.stopLoss)} · EQ ${formatPrice(signal.plan.targets[0])} · DOL ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}.`
  ].join("\n");
  return {
    status: "fallback",
    commentary,
    model: "local-fallback",
    reason
  };
}

function executionCandles(signal: TradingSignal) {
  return signal.context.timeframes.m15.length ? signal.context.timeframes.m15 : signal.context.timeframes.m5;
}

function candleRole(signal: TradingSignal, index: number): string | undefined {
  const annotations = selectedSignalAnnotations(signal);
  const roles = [
    annotations.sweep?.candleIndex === index ? "liquidity sweep / reclaim referansı" : undefined,
    annotations.displacement?.candleIndex === index ? "displacement candle" : undefined,
    annotations.marketStructureShift?.candleIndex === index ? "ChoCH/Just referansı" : undefined,
    annotations.fairValueGap?.candleIndex === index ? "planlı POI/FVG candle" : undefined,
    annotations.smtDivergence?.candleIndex === index ? "SMT divergence candle" : undefined
  ].filter((item): item is string => Boolean(item));
  return roles.length ? roles.join(", ") : undefined;
}

function buildDecisionLine(signal: TradingSignal): string {
  const closeRequirement = closeConfirmationRequirement(signal);
  if (signal.stage === "invalidated") return "Bu setup artık işlem adayı değil; stop/invalidation görülmüş.";
  if (signal.stage === "missed") return "Trade kovalanmaz; entry/hedef kaçmış, yeni model beklenir.";
  if (signal.governance.status === "block") return signal.governance.blockers[0] ?? "Governance blok var.";
  if (closeRequirement) {
    return `${closeRequirement.timeframe} mum ${formatPrice(closeRequirement.level)} ${closeRequirement.side === "above" ? "üstünde" : "altında"} kapanmalı; referans ${closeRequirement.reference}.`;
  }
  if (!signal.plan.entryModel.retested || signal.plan.entryStatus === "pending") {
    const gap = signal.plan.entryModel.fairValueGap;
    return gap
      ? `Fiyat ${formatPrice(gap.low)}-${formatPrice(gap.high)} entry kutusuna dönüp kapanışla onay vermeli.`
      : `Fiyat ${formatPrice(signal.plan.entry)} entry seviyesine gelip kapanışla onay vermeli.`;
  }
  if (signal.stage === "ready") {
    return `READY plan: entry ${formatPrice(signal.plan.entry)}, stop ${formatPrice(signal.plan.stopLoss)}, EQ ${formatPrice(signal.plan.targets[0] ?? signal.plan.entry)}, DOL ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0] ?? signal.plan.entry)}.`;
  }
  return signal.plan.planWarnings[0] ?? "Setup izleniyor; READY olmadan işlem yok.";
}

function buildWaitingFor(signal: TradingSignal): string[] {
  const closeRequirement = closeConfirmationRequirement(signal);
  const waits = [
    !signal.plan.entryModel.retested ? "Entry kutusu/retest seviyesine temas bekleniyor." : undefined,
    closeRequirement ? `${closeRequirement.label} kapanış onayı bekleniyor: ${closeRequirement.reason}` : undefined,
    signal.context.eventRisk.level !== "clear" ? `Event/saat riski: ${signal.context.eventRisk.summary}` : undefined,
    signal.governance.status !== "allow" ? signal.governance.summary : undefined,
    ...signal.plan.planWarnings.slice(0, 3)
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(waits)).slice(0, 6);
}

function buildChartMentorContext(signal: TradingSignal): GeminiTradeCommentaryPayload["chart"] {
  const candles = executionCandles(signal);
  const annotations = selectedSignalAnnotations(signal);
  const closeRequirement = closeConfirmationRequirement(signal);
  const recentStartIndex = Math.max(0, candles.length - 18);
  const recentCandles = candles.slice(-18).map((candle, offset) => {
    const index = recentStartIndex + offset;
    return {
      index,
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      role: candleRole(signal, index)
    };
  });
  const keyLevels: GeminiTradeCommentaryPayload["chart"]["keyLevels"] = [];
  keyLevels.push(
    { label: "ENTRY", price: signal.plan.entry, reason: `${signal.plan.entrySource}/${signal.plan.entryStatus}` },
    { label: "STOP", price: signal.plan.stopLoss, reason: `${signal.plan.stopSource} + buffer` },
    { label: "EQ / TP1", price: signal.plan.targets[0], reason: "CRT 0.5 management" },
    { label: "DOL / TP2", price: signal.plan.targets[1], reason: signal.plan.targetSource },
    { label: "CRT HIGH", price: signal.context.crt.activeRange.high, reason: signal.context.crt.activeRange.source },
    { label: "CRT MID", price: signal.context.crt.activeRange.midpoint, reason: "CRT range 0.5" },
    { label: "CRT LOW", price: signal.context.crt.activeRange.low, reason: signal.context.crt.activeRange.source },
    { label: "DOL", price: signal.context.crt.selectedBias.drawLevel, reason: signal.context.crt.selectedBias.summary }
  );
  if (annotations.sweep) {
    keyLevels.push({ label: "SWEEP", price: annotations.sweep.level, reason: `${annotations.sweep.side}, reclaimed=${annotations.sweep.reclaimed}` });
  }
  if (annotations.marketStructureShift) {
    keyLevels.push({ label: "ChoCH / Just", price: annotations.marketStructureShift.level, reason: `${annotations.marketStructureShift.direction} structure shift` });
  }
  if (closeRequirement) {
    keyLevels.push({ label: "KAPANIŞ ONAYI", price: closeRequirement.level, reason: closeRequirement.reason });
  }
  if (annotations.fairValueGap) {
    keyLevels.push({
      label: signal.plan.entrySource === "ifvg-retest" ? "iFVG BOX" : signal.plan.entrySource === "fvg-retest" ? "FVG BOX" : "POI BOX",
      zone: [annotations.fairValueGap.low, annotations.fairValueGap.high],
      reason: `planlı POI, mitigated=${annotations.fairValueGap.mitigated}`
    });
  }

  return {
    timeframe: signal.context.timeframes.m15.length ? "15m" : "5m",
    lastPrice: candles[candles.length - 1]?.close ?? signal.plan.entry,
    decisionLine: buildDecisionLine(signal),
    waitingFor: buildWaitingFor(signal),
    keyLevels,
    annotations: {
      sweep: annotations.sweep ? {
        side: annotations.sweep.side,
        level: annotations.sweep.level,
        candleIndex: annotations.sweep.candleIndex,
        reclaimed: annotations.sweep.reclaimed
      } : undefined,
      mss: annotations.marketStructureShift ? {
        direction: annotations.marketStructureShift.direction,
        level: annotations.marketStructureShift.level,
        candleIndex: annotations.marketStructureShift.candleIndex
      } : undefined,
      displacement: annotations.displacement ? {
        direction: annotations.displacement.direction,
        candleIndex: annotations.displacement.candleIndex,
        bodyRatio: annotations.displacement.bodyRatio,
        rangeAtr: annotations.displacement.rangeAtr
      } : undefined,
      fairValueGap: annotations.fairValueGap ? {
        source: signal.plan.entrySource,
        direction: annotations.fairValueGap.direction,
        low: annotations.fairValueGap.low,
        high: annotations.fairValueGap.high,
        midpoint: annotations.fairValueGap.midpoint,
        mitigated: annotations.fairValueGap.mitigated,
        candleIndex: annotations.fairValueGap.candleIndex
      } : undefined,
      smt: annotations.smtDivergence ? {
        partner: annotations.smtDivergence.partner,
        side: annotations.smtDivergence.side,
        note: annotations.smtDivergence.note
      } : undefined
    },
    recentCandles
  };
}

export function buildGeminiTradeCommentaryPayload(signal: TradingSignal): GeminiTradeCommentaryPayload {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const planGap = signal.plan.entryModel.fairValueGap;
  const structureAudit = buildStructureAudit(signal);
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
      monthlyBias: signal.context.bias.monthly,
      weeklyBias: signal.context.bias.weekly,
      dailyBias: signal.context.bias.daily,
      h4Bias: signal.context.bias.h4,
      h1Bias: signal.context.bias.h1,
      crtBias: signal.context.crt.selectedBias.kind,
      dol: signal.context.crt.selectedBias.drawLevel,
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
    })),
    structureAudit,
    chart: buildChartMentorContext(signal)
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
