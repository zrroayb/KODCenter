import { describe, expect, it } from "vitest";
import type { SessionSetup } from "../lib/session/types";
import { buildSessionGeminiPayload, localSessionAnalysis, validateSessionAnalysis } from "../lib/session/sessionAnalysis";

const setup = {
  id: "EURUSD:fixture",
  setupFamily: "CRT_SESSION",
  setupModel: "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT",
  referenceSession: "ASIA",
  triggerSession: "LONDON",
  confirmationSession: "LONDON",
  direction: "long",
  lifecycleStatus: "WAITING_FOR_LTF_CONFIRMATION",
  grade: "B",
  score: 70,
  symbol: "EURUSD",
  timeframe: "15m",
  confirmationTimeframe: "15m",
  tradingDayId: "eurusd:2026-07-16",
  sessionProfileId: "eurusd_default_v1",
  sessionProfileVersion: "1.0.0",
  detectorVersion: "test",
  promptVersion: "test",
  createdAt: Date.UTC(2026, 6, 16, 6),
  updatedAt: Date.UTC(2026, 6, 16, 7),
  referenceRangeId: "asia",
  referenceRange: { high: 1.1, low: 1.09, midpoint: 1.095, quality: "normal", startsAt: 1, endsAt: 2 },
  currentPrice: 1.096,
  sweptSide: "LOW",
  htfAlignment: "strong",
  scoreBreakdown: {
    htfAlignment: 15,
    rangeQuality: 10,
    liquidityLevel: 10,
    sweepQuality: 15,
    reclaimQuality: 10,
    displacementQuality: 15,
    crtQuality: 5,
    ltfConfirmation: 0,
    targetQuality: 5,
    timingQuality: 5,
    penalties: 0
  },
  events: [{ id: "event:sweep", kind: "sweep", status: "pass", label: "Sweep", detail: "Asia low swept" }],
  warnings: [],
  blockers: ["LTF confirmation missing"],
  summary: "LTF confirmation missing"
} as SessionSetup;

describe("session Gemini contract", () => {
  it("sends only deterministic session evidence", () => {
    const payload = buildSessionGeminiPayload(setup);
    expect(payload.setup_family).toBe("CRT_SESSION");
    expect(payload.session_narrative.reference_session).toBe("ASIA");
    expect(payload.deterministic_events[0].id).toBe("event:sweep");
  });

  it("rejects invented event ids", () => {
    const payload = buildSessionGeminiPayload(setup);
    const result = validateSessionAnalysis({
      verdict: "developing",
      session_alignment: "strong",
      summary: "ok",
      sequence: [],
      missing_evidence: [],
      risks: [],
      supporting_event_ids: ["invented"]
    }, payload);
    expect(result.ok).toBe(false);
  });

  it("keeps the UI useful with a deterministic local fallback", () => {
    const result = localSessionAnalysis(setup);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.model).toContain("fallback");
      expect(result.analysis.missingEvidence).toContain("LTF confirmation missing");
    }
  });
});
