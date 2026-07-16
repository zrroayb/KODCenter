import { describe, expect, it } from "vitest";
import { buildSilverBulletGeminiPayload, validateSilverBulletInterpretation } from "../lib/gemini/silverBulletInterpretation";
import type { SilverBulletSetup } from "../lib/strategies/silverBullet/types";

function fixtureSetup(overrides: Partial<SilverBulletSetup> = {}): SilverBulletSetup {
  const windowStart = Date.UTC(2026, 6, 15, 14, 0);
  const windowEnd = Date.UTC(2026, 6, 15, 15, 0);
  return {
    setupId: "NAS100:2026-07-15:0900NY:short",
    idempotencyKey: "k",
    setupFamily: "ICT_SILVER_BULLET",
    strategyProfile: "NY_AM_09_HOURLY_RANGE_REVERSAL_V1",
    strategyVersion: "1.0.0",
    detectorVersion: "sb-1.0.0",
    symbol: "NAS100",
    tradingDayId: "2026-07-15",
    createdAtUtc: windowStart,
    updatedAtUtc: windowStart + 30 * 60 * 1000,
    referenceRange: {
      referenceRangeId: "NAS100:2026-07-15:0900NY",
      strategyProfile: "NY_AM_09_HOURLY_RANGE_REVERSAL_V1",
      symbol: "NAS100",
      tradingDayId: "2026-07-15",
      timezone: "America/New_York",
      startUtc: windowStart - 60 * 60 * 1000,
      endUtc: windowStart,
      open: 100, high: 101, low: 99, close: 100.2,
      midpoint: 100, rangeSize: 2, atr: 1, rangeAtrRatio: 2,
      highTimestamp: windowStart - 40 * 60 * 1000,
      lowTimestamp: windowStart - 20 * 60 * 1000,
      highFirst: true, quality: "normal", isComplete: true, dataQuality: "valid", barCount: 12
    },
    windowStartUtc: windowStart,
    windowEndUtc: windowEnd,
    direction: "short",
    setupModel: "NY_AM_09_RANGE_HIGH_SWEEP_BEARISH_SB",
    triggerType: "SB_MSS_FVG",
    bothSides: false,
    plan: { entry: 100.3, stopLoss: 101.8, rawSweepExtreme: 101.6, stopBuffer: 0.2, targets: [100, 99], plannedRR: 0.9, entryFilledUtc: windowStart + 25 * 60 * 1000, remainingSecondsAtEntry: 2100 },
    lifecycleStatus: "ENTRY_FILLED",
    score: 78,
    grade: "A",
    scoreBreakdown: { rangeQuality: 10, sweepQuality: 11, reclaimQuality: 10, displacementQuality: 10, structureQuality: 12, entryArrayQuality: 10, htfAlignment: 5, targetQuality: 5, riskReward: 5, timingQuality: 5, penalties: 0 },
    htfAlignment: "neutral",
    events: [
      { id: "e1", kind: "sweep", status: "pass", label: "High Sweep", detail: "x" },
      { id: "e2", kind: "entry", status: "pass", label: "Entry", detail: "y" }
    ],
    warnings: [],
    noTradeReasons: [],
    invalidationReasons: [],
    summary: "test",
    ...overrides
  };
}

describe("Silver Bullet Gemini contract", () => {
  it("builds a payload carrying allowed event ids, plan and deadline context", () => {
    const payload = buildSilverBulletGeminiPayload(fixtureSetup());
    expect(payload.allowed_event_ids).toEqual(["e1", "e2"]);
    expect(payload.strategy_profile).toBe("NY_AM_09_HOURLY_RANGE_REVERSAL_V1");
    expect(payload.trade_plan?.entryFilledUtc).toBeDefined();
    expect(Date.parse(payload.time_context.window_end_utc)).toBeGreaterThan(0);
  });

  it("accepts a valid interpretation that references only known event ids", () => {
    const payload = buildSilverBulletGeminiPayload(fixtureSetup());
    const result = validateSilverBulletInterpretation({
      strategy_analysis: { status: "confirmed", direction: "bearish" },
      supporting_event_ids: ["e1"],
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(true);
  });

  it("rejects an invented event id", () => {
    const payload = buildSilverBulletGeminiPayload(fixtureSetup());
    const result = validateSilverBulletInterpretation({
      strategy_analysis: { status: "developing", direction: "bearish" },
      supporting_event_ids: ["made-up"],
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Bilinmeyen event id");
  });

  it("rejects approval of an entry that never filled before 11:00 (strict deadline)", () => {
    const payload = buildSilverBulletGeminiPayload(fixtureSetup({
      plan: { entry: 100.3, stopLoss: 101.8, rawSweepExtreme: 101.6, stopBuffer: 0.2, targets: [100, 99], plannedRR: 0.9, entryFilledUtc: undefined, remainingSecondsAtEntry: undefined },
      lifecycleStatus: "ORDER_PENDING"
    }));
    const result = validateSilverBulletInterpretation({
      strategy_analysis: { status: "confirmed", direction: "bearish" },
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("11:00");
  });

  it("rejects an unsupported strategy profile", () => {
    const payload = buildSilverBulletGeminiPayload(fixtureSetup());
    const result = validateSilverBulletInterpretation({
      strategy_analysis: { status: "developing", direction: "bearish", strategy_profile: "LONDON_SB_V9" },
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(false);
  });
});
