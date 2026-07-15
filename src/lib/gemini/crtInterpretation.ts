import type { TradingSignal } from "../ict/types";

// Gemini CRT interpretation contract — Master §9/§10/§13/§14/§15. The deterministic bot supplies
// FACTS as evidence events with unique ids; Gemini may only interpret them and may only reference
// ids that were provided. It must not invent candles, levels, sweeps or targets.

export type CrtEvidenceEvent = {
  id: string;              // unique per (signal, evidence) — Gemini may only reference these
  kind: string;            // the evidence category (manipulation, choch, reference-candle, ...)
  label: string;
  status: string;
  detail: string;
  timeframe?: string;
  price?: number;
  time?: number;
};

export type CrtGeminiPayload = {
  symbol: string;
  signal_id: string;
  analysis_timestamp: string;
  direction: string;
  stage: string;
  grade: string;
  score: number;
  crt: {
    reference_timeframe?: string;
    confirmation_timeframe?: string;
    reference_high?: number;
    reference_low?: number;
    equilibrium?: number;
    state: string;
    swept_side: "high" | "low" | "none";
    direction: string;
    entry?: number;
    stop?: number;
    targets: number[];
  };
  events: CrtEvidenceEvent[];
};

export function buildCrtGeminiPayload(signal: TradingSignal): CrtGeminiPayload {
  const anchor = signal.crtAnchor;
  const events: CrtEvidenceEvent[] = signal.evidence.map((item) => ({
    id: `${signal.id}:${item.id}`,
    kind: item.id,
    label: item.label,
    status: item.status,
    detail: item.detail,
    timeframe: item.timeframe,
    price: item.price,
    time: item.time
  }));
  const sweptSide: "high" | "low" | "none" = anchor?.raidActive
    ? (signal.direction === "short" ? "high" : "low")
    : "none";
  return {
    symbol: signal.symbol,
    signal_id: signal.id,
    analysis_timestamp: new Date(signal.createdAt).toISOString(),
    direction: signal.direction,
    stage: signal.stage,
    grade: signal.grade,
    score: signal.score,
    crt: {
      reference_timeframe: anchor?.rangeTf,
      confirmation_timeframe: anchor?.confirmTf,
      reference_high: anchor?.rangeHigh,
      reference_low: anchor?.rangeLow,
      equilibrium: anchor ? (anchor.rangeHigh + anchor.rangeLow) / 2 : undefined,
      state: anchor?.crtState ?? signal.stage,
      swept_side: sweptSide,
      direction: signal.direction,
      entry: signal.plan.entry,
      stop: signal.plan.stopLoss,
      targets: signal.plan.targets ?? []
    },
    events
  };
}

// Master §14 system instruction for the CRT interpretation layer.
export const CRT_GEMINI_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic Candle Range Theory trading system.
You do NOT independently detect market events. All candles, ranges, structure breaks, liquidity sweeps, displacement events, targets and invalidation levels come only from the supplied deterministic evidence events.
Tasks: (1) explain the HTF directional bias, (2) explain the likely external draw on liquidity, (3) evaluate whether the CRT reference candle is meaningful, (4) explain which side of the CRT range was swept, (5) whether price returned and accepted inside, (6) evaluate displacement and LTF confirmation, (7) identify contradictions and missing evidence, (8) explain targets and invalidation, (9) reject weak, late or context-free setups.
Reasoning order: external liquidity draw -> HTF structure -> dealing-range location -> liquidity sweep -> return inside -> displacement -> LTF confirmation -> target -> invalidation.
Rules: Do not force a directional conclusion. Do not invent missing evidence. Do not assume every large candle is a valid CRT reference candle. Do not assume every wick outside a range is a valid sweep. Sweeping the low does not automatically create a long; sweeping the high does not automatically create a short. You may only reference event ids that appear in the provided events array. If the evidence is insufficient, set status to "insufficient_evidence". Return ONLY valid JSON matching the provided schema.`;

// Master §15 response schema (for Gemini structured output / generationConfig.responseSchema).
export const CRT_GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    directional_analysis: {
      type: "object",
      properties: {
        bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        confidence: { type: "number" },
        external_draw: { type: "string" },
        reasoning: { type: "string" },
        supporting_event_ids: { type: "array", items: { type: "string" } },
        contradicting_event_ids: { type: "array", items: { type: "string" } }
      },
      required: ["bias", "reasoning"]
    },
    crt_analysis: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["candidate", "developing", "confirmed", "late", "invalid", "insufficient_evidence"] },
        direction: { type: "string", enum: ["bullish", "bearish", "none"] },
        reference_candle_quality: { type: "string", enum: ["high", "medium", "low", "invalid"] },
        reference_candle_reasoning: { type: "string" },
        sweep_reasoning: { type: "string" },
        confirmation_reasoning: { type: "string" },
        target_reasoning: { type: "string" },
        invalidation_reasoning: { type: "string" }
      },
      required: ["status", "direction"]
    },
    important_evidence: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    plain_language_summary: { type: "string" }
  },
  required: ["directional_analysis", "crt_analysis", "plain_language_summary"]
} as const;

export type CrtInterpretationValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

// Master §15: reject a response that is not valid, references unknown event ids, or omits the
// required interpretation fields. The caller then retries or falls back.
export function validateCrtInterpretation(raw: unknown, payload: CrtGeminiPayload): CrtInterpretationValidation {
  let value: Record<string, unknown>;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw) as Record<string, unknown>; }
    catch { return { ok: false, error: "Yanıt geçerli JSON değil." }; }
  } else if (raw && typeof raw === "object") {
    value = raw as Record<string, unknown>;
  } else {
    return { ok: false, error: "Yanıt boş." };
  }

  const da = value.directional_analysis as Record<string, unknown> | undefined;
  const ca = value.crt_analysis as Record<string, unknown> | undefined;
  if (!da || typeof da.bias !== "string") return { ok: false, error: "directional_analysis.bias eksik." };
  if (!ca || typeof ca.status !== "string") return { ok: false, error: "crt_analysis.status eksik." };
  if (typeof value.plain_language_summary !== "string") return { ok: false, error: "plain_language_summary eksik." };

  const known = new Set(payload.events.map((event) => event.id));
  const referenced = [
    ...(Array.isArray(da.supporting_event_ids) ? da.supporting_event_ids : []),
    ...(Array.isArray(da.contradicting_event_ids) ? da.contradicting_event_ids : [])
  ].filter((id): id is string => typeof id === "string");
  const unknownId = referenced.find((id) => !known.has(id));
  if (unknownId) return { ok: false, error: `Bilinmeyen event id: ${unknownId}` };

  return { ok: true, value };
}
