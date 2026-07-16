import { formatZonedIso } from "./timezone";
import type { SessionSetup } from "./types";

export type SessionGeminiPayload = {
  setup_id: string;
  setup_family: "CRT_SESSION";
  analysis_timestamp_utc: string;
  symbol: string;
  model: string;
  direction: string;
  lifecycle_status: string;
  score: number;
  grade: string;
  session_profile: {
    id: string;
    version: string;
  };
  session_narrative: {
    reference_session: string;
    trigger_session: string;
    confirmation_session: string;
    trading_day_id: string;
    reference_range: SessionSetup["referenceRange"];
    swept_side: string;
    htf_alignment: string;
  };
  timing: {
    created_at_utc: string;
    sweep_timestamp_utc?: string;
    reclaim_timestamp_utc?: string;
    trigger_local_time: string;
  };
  plan?: {
    entry: number;
    stop: number;
    targets: number[];
    rr: number;
  };
  deterministic_events: SessionSetup["events"];
  blockers: string[];
  warnings: string[];
};

export type SessionAnalysisResult = {
  verdict: "confirmed" | "developing" | "weak" | "invalid" | "insufficient_evidence";
  sessionAlignment: "strong" | "moderate" | "weak" | "conflicting";
  summary: string;
  sequence: string[];
  missingEvidence: string[];
  risks: string[];
  supportingEventIds: string[];
};

export type SessionAnalysisResponse =
  | { status: "ready"; model?: string; analysis: SessionAnalysisResult }
  | { status: "disabled"; reason?: string }
  | { status: "error"; error?: string };

export function buildSessionGeminiPayload(setup: SessionSetup): SessionGeminiPayload {
  return {
    setup_id: setup.id,
    setup_family: "CRT_SESSION",
    analysis_timestamp_utc: new Date(setup.updatedAt).toISOString(),
    symbol: setup.symbol,
    model: setup.setupModel,
    direction: setup.direction,
    lifecycle_status: setup.lifecycleStatus,
    score: setup.score,
    grade: setup.grade,
    session_profile: {
      id: setup.sessionProfileId,
      version: setup.sessionProfileVersion
    },
    session_narrative: {
      reference_session: setup.referenceSession,
      trigger_session: setup.triggerSession,
      confirmation_session: setup.confirmationSession,
      trading_day_id: setup.tradingDayId,
      reference_range: setup.referenceRange,
      swept_side: setup.sweptSide,
      htf_alignment: setup.htfAlignment
    },
    timing: {
      created_at_utc: new Date(setup.createdAt).toISOString(),
      sweep_timestamp_utc: setup.sweepTimestampUtc ? new Date(setup.sweepTimestampUtc).toISOString() : undefined,
      reclaim_timestamp_utc: setup.reclaimTimestampUtc ? new Date(setup.reclaimTimestampUtc).toISOString() : undefined,
      trigger_local_time: formatZonedIso(setup.createdAt, setup.triggerSession === "LONDON" ? "Europe/London" : "America/New_York")
    },
    plan: setup.plan ? {
      entry: setup.plan.entry,
      stop: setup.plan.stopLoss,
      targets: setup.plan.targets,
      rr: setup.plan.rr
    } : undefined,
    deterministic_events: setup.events,
    blockers: setup.blockers,
    warnings: setup.warnings
  };
}

export function validateSessionAnalysis(
  raw: unknown,
  payload: SessionGeminiPayload
): { ok: true; value: SessionAnalysisResult } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Yanıt boş veya JSON değil." };
  const value = raw as Record<string, unknown>;
  const verdicts = ["confirmed", "developing", "weak", "invalid", "insufficient_evidence"];
  const alignments = ["strong", "moderate", "weak", "conflicting"];
  if (!verdicts.includes(String(value.verdict))) return { ok: false, error: "Geçersiz verdict." };
  if (!alignments.includes(String(value.session_alignment))) return { ok: false, error: "Geçersiz session_alignment." };
  if (typeof value.summary !== "string") return { ok: false, error: "summary eksik." };
  const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const supporting = strings(value.supporting_event_ids);
  const known = new Set(payload.deterministic_events.map((event) => event.id));
  const unknown = supporting.find((id) => !known.has(id));
  if (unknown) return { ok: false, error: `Bilinmeyen session event id: ${unknown}` };
  return {
    ok: true,
    value: {
      verdict: value.verdict as SessionAnalysisResult["verdict"],
      sessionAlignment: value.session_alignment as SessionAnalysisResult["sessionAlignment"],
      summary: value.summary,
      sequence: strings(value.sequence),
      missingEvidence: strings(value.missing_evidence),
      risks: strings(value.risks),
      supportingEventIds: supporting
    }
  };
}

const cache = new Map<string, SessionAnalysisResponse>();

export function localSessionAnalysis(setup: SessionSetup): SessionAnalysisResponse {
  const confirmed = ["CONFIRMED", "ACTIVE", "TARGET_1_REACHED", "TARGET_2_REACHED", "COMPLETED"].includes(setup.lifecycleStatus);
  const invalid = ["INVALIDATED", "LATE", "EXPIRED"].includes(setup.lifecycleStatus);
  const passing = setup.events.filter((event) => event.status === "pass");
  const pending = setup.events.filter((event) => event.status === "pending");
  return {
    status: "ready",
    model: "local-deterministic-fallback",
    analysis: {
      verdict: invalid ? "invalid" : confirmed ? "confirmed" : setup.score < 50 ? "weak" : "developing",
      sessionAlignment: setup.htfAlignment,
      summary: setup.summary,
      sequence: passing.map((event) => `${event.label}: ${event.detail}`),
      missingEvidence: Array.from(new Set([...pending.map((event) => event.detail), ...setup.blockers])),
      risks: setup.warnings,
      supportingEventIds: passing.map((event) => event.id)
    }
  };
}

export async function fetchSessionAnalysis(setup: SessionSetup): Promise<SessionAnalysisResponse> {
  const key = `${setup.id}:${setup.lifecycleStatus}:${setup.score}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const payload = buildSessionGeminiPayload(setup);
    const response = await fetch("/api/gemini/session-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ status: "error", error: "Session analizi okunamadı." })) as {
      status?: string;
      model?: string;
      reason?: string;
      error?: string;
      analysis?: unknown;
    };
    if (result.status === "disabled") return { status: "disabled", reason: result.reason };
    if (result.status !== "ready") return localSessionAnalysis(setup);
    const validated = validateSessionAnalysis(result.analysis, payload);
    if (!validated.ok) return localSessionAnalysis(setup);
    const ready: SessionAnalysisResponse = { status: "ready", model: result.model, analysis: validated.value };
    cache.set(key, ready);
    return ready;
  } catch (error) {
    return localSessionAnalysis(setup);
  }
}

export const SESSION_GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["confirmed", "developing", "weak", "invalid", "insufficient_evidence"] },
    session_alignment: { type: "string", enum: ["strong", "moderate", "weak", "conflicting"] },
    summary: { type: "string" },
    sequence: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    supporting_event_ids: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "session_alignment", "summary", "sequence", "missing_evidence", "risks", "supporting_event_ids"]
} as const;
