import { describe, expect, it } from "vitest";
import { gradeFromScore, scoreCrtSetup } from "../lib/strategies/crt/crt.strategy";
import { GRADE_RISK_FACTOR } from "../lib/risk/positionSizing";

const coreOnly = {
  manipulation: true,
  choch: true,
  rr: 2,
  minimumRR: 1.5,
  managementRR: 1.2,
  htfAlignment: { aligned: false, fullyAligned: false },
  smtAligned: false,
  sessionTimedRaid: false,
  inSession: false,
  locationTier: "none" as const,
  referenceCandleScore: 0,
  displacementStrength: "none" as const,
  shiftFvgOrRetest: false,
  rangeRespect: false,
  pdAligned: true
};

describe("CRT score / grade split", () => {
  it("a complete core with zero quality evidence is B, not A+", () => {
    const score = scoreCrtSetup(coreOnly);
    expect(score).toBe(70);
    expect(gradeFromScore(score)).toBe("B");
    // Grade-based sizing is alive again: a B setup risks less than a full-size A+.
    expect(GRADE_RISK_FACTOR[gradeFromScore(score)]).toBeLessThan(GRADE_RISK_FACTOR["A+"]);
  });

  it("only a setup carrying the quality evidence reaches A+", () => {
    const score = scoreCrtSetup({
      ...coreOnly,
      htfAlignment: { aligned: true, fullyAligned: true },
      smtAligned: true,
      sessionTimedRaid: true,
      inSession: true,
      locationTier: "weekly",
      referenceCandleScore: 90,
      displacementStrength: "strong",
      shiftFvgOrRetest: true,
      rangeRespect: true
    });
    expect(gradeFromScore(score)).toBe("A+");
  });

  it("partial quality lands between B and A+", () => {
    const score = scoreCrtSetup({ ...coreOnly, htfAlignment: { aligned: true, fullyAligned: true }, inSession: true, locationTier: "daily", shiftFvgOrRetest: true });
    expect(score).toBe(85);
    expect(gradeFromScore(score)).toBe("A");
  });

  it("wrong-half entry and missing ChoCH cost score", () => {
    expect(scoreCrtSetup({ ...coreOnly, pdAligned: false })).toBe(62);
    expect(scoreCrtSetup({ ...coreOnly, choch: false })).toBe(52);
  });
});

describe("CRT exit model (DOL target + BE at EQ) speaks one RR everywhere", () => {
  it("plan.rr is the DOL exit net RR; EQ is the BE milestone; READY gates on the DOL RR", async () => {
    const { createDemoMarkets } = await import("../data/demoData");
    const { buildMarketContext } = await import("../lib/intelligence/marketContext");
    const { crtStrategy } = await import("../lib/strategies/crt/crt.strategy");
    const markets = createDemoMarkets();
    const signals = markets.flatMap((market) => crtStrategy.scan({
      context: buildMarketContext(market.symbol, market.timeframes),
      settings: { ...crtStrategy.defaultSettings }
    }).signals);
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      // Exit = DOL, so the headline rr is the DOL net RR — at least the EQ (BE milestone) RR.
      expect(signal.plan.rr).toBeGreaterThanOrEqual((signal.plan.managementRR ?? 0) - 1e-9);
      expect(signal.plan.minimumRR).toBe(1);
      // extensionRR now carries the EQ (BE) net RR reference.
      expect(signal.plan.extensionRR ?? 0).toBe(signal.plan.managementRR ?? 0);
      // READY gates on the DOL exit RR.
      if (signal.stage === "ready") expect(signal.plan.rr).toBeGreaterThanOrEqual(1);
    }
  });
});
