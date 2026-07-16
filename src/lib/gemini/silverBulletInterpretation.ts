import type { SilverBulletSetup } from "../strategies/silverBullet/types";

// Gemini Silver Bullet interpretation contract — Master §32-§34. Deterministic facts in, strict
// validated JSON out. Gemini may only reference provided event ids and must never approve an
// entry that fills at/after 11:00 New York.

export type SbGeminiPayload = {
  strategy_profile: string;
  symbol: string;
  analysis_timestamp: string;
  time_context: {
    window_start_utc: string;
    window_end_utc: string;
    remaining_seconds: number | null;
  };
  reference_range: {
    high: number;
    low: number;
    midpoint: number;
    range_size: number;
    quality: string;
    data_quality: string;
  };
  directional_context: {
    htf_alignment: string;
    direction: string;
  };
  sweep?: SilverBulletSetup["sweep"];
  displacement?: SilverBulletSetup["displacement"];
  mss?: SilverBulletSetup["mss"];
  cisd?: SilverBulletSetup["cisd"];
  entry_array?: SilverBulletSetup["entryArray"];
  trade_plan?: SilverBulletSetup["plan"];
  lifecycle_status: string;
  deterministic_score: { score: number; grade: string; breakdown: SilverBulletSetup["scoreBreakdown"] };
  no_trade_reasons: string[];
  invalidation_reasons: string[];
  allowed_event_ids: string[];
  events: Array<{ id: string; kind: string; status: string; label: string; detail: string }>;
};

export function buildSilverBulletGeminiPayload(setup: SilverBulletSetup): SbGeminiPayload {
  return {
    strategy_profile: setup.strategyProfile,
    symbol: setup.symbol,
    analysis_timestamp: new Date(setup.updatedAtUtc).toISOString(),
    time_context: {
      window_start_utc: new Date(setup.windowStartUtc).toISOString(),
      window_end_utc: new Date(setup.windowEndUtc).toISOString(),
      remaining_seconds: setup.plan?.remainingSecondsAtEntry ?? null
    },
    reference_range: {
      high: setup.referenceRange.high,
      low: setup.referenceRange.low,
      midpoint: setup.referenceRange.midpoint,
      range_size: setup.referenceRange.rangeSize,
      quality: setup.referenceRange.quality,
      data_quality: setup.referenceRange.dataQuality
    },
    directional_context: { htf_alignment: setup.htfAlignment, direction: setup.direction },
    sweep: setup.sweep,
    displacement: setup.displacement,
    mss: setup.mss,
    cisd: setup.cisd,
    entry_array: setup.entryArray,
    trade_plan: setup.plan,
    lifecycle_status: setup.lifecycleStatus,
    deterministic_score: { score: setup.score, grade: String(setup.grade), breakdown: setup.scoreBreakdown },
    no_trade_reasons: setup.noTradeReasons,
    invalidation_reasons: setup.invalidationReasons,
    allowed_event_ids: setup.events.map((event) => event.id),
    events: setup.events.map((event) => ({ id: event.id, kind: event.kind, status: event.status, label: event.label, detail: event.detail }))
  };
}

export type SbInterpretationValidation = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

// Master §34: reject invalid JSON, unknown event ids, or an approval whose entry fill breaks the
// 11:00 deadline the deterministic engine reported.
export function validateSilverBulletInterpretation(raw: unknown, payload: SbGeminiPayload): SbInterpretationValidation {
  let value: Record<string, unknown>;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw) as Record<string, unknown>; }
    catch { return { ok: false, error: "Yanıt geçerli JSON değil." }; }
  } else if (raw && typeof raw === "object") {
    value = raw as Record<string, unknown>;
  } else {
    return { ok: false, error: "Yanıt boş." };
  }
  const analysis = value.strategy_analysis as Record<string, unknown> | undefined;
  if (!analysis || typeof analysis.status !== "string") return { ok: false, error: "strategy_analysis.status eksik." };
  if (typeof value.plain_language_summary !== "string") return { ok: false, error: "plain_language_summary eksik." };
  if (analysis.strategy_profile && analysis.strategy_profile !== payload.strategy_profile) {
    return { ok: false, error: "Desteklenmeyen strategy_profile." };
  }
  const approving = ["confirmed", "active"].includes(String(analysis.status));
  const filled = typeof payload.trade_plan?.entryFilledUtc === "number";
  const filledInWindow = filled && (payload.trade_plan?.entryFilledUtc ?? Infinity) < Date.parse(payload.time_context.window_end_utc);
  if (approving && !filledInWindow) {
    return { ok: false, error: "Gemini 11:00 NY'den önce dolmamış bir entry'yi onayladı — reddedildi." };
  }
  const known = new Set(payload.allowed_event_ids);
  const referenced = [
    ...(Array.isArray(value.supporting_event_ids) ? value.supporting_event_ids : []),
    ...(Array.isArray(value.contradicting_event_ids) ? value.contradicting_event_ids : [])
  ].filter((id): id is string => typeof id === "string");
  const unknownId = referenced.find((id) => !known.has(id));
  if (unknownId) return { ok: false, error: `Bilinmeyen event id: ${unknownId}` };
  return { ok: true, value };
}

export type SbAnalysisResponse =
  | { status: "ready"; model?: string; analysis: Record<string, unknown> }
  | { status: "disabled"; reason?: string }
  | { status: "error"; error?: string };

const sbAnalysisCache = new Map<string, SbAnalysisResponse>();

export async function fetchSilverBulletAnalysis(setup: SilverBulletSetup): Promise<SbAnalysisResponse> {
  const key = `${setup.setupId}:${setup.lifecycleStatus}:${setup.score}`;
  const cached = sbAnalysisCache.get(key);
  if (cached) return cached;
  try {
    const payload = buildSilverBulletGeminiPayload(setup);
    const response = await fetch("/api/gemini/silver-bullet-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ status: "error", error: "SB analizi okunamadı." })) as { status?: string; error?: string; reason?: string; model?: string; analysis?: Record<string, unknown> };
    if (result.status === "ready" && result.analysis) {
      const validated = validateSilverBulletInterpretation(result.analysis, payload);
      if (!validated.ok) return { status: "error", error: validated.error };
      const ready: SbAnalysisResponse = { status: "ready", model: result.model, analysis: validated.value };
      sbAnalysisCache.set(key, ready);
      return ready;
    }
    if (result.status === "disabled") return { status: "disabled", reason: result.reason };
    return { status: "error", error: result.error ?? "SB analizi alınamadı." };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
