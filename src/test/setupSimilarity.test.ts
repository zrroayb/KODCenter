import { describe, expect, it } from "vitest";
import type { RuntimeReplayTrade } from "../lib/analytics/performance";
import {
  buildSetupSimilarityIndex,
  findSimilarSetups,
  setupDistance,
  similarSetupOutcome
} from "../lib/analytics/setupSimilarity";

const base: RuntimeReplayTrade = {
  id: "x",
  symbol: "EURUSD",
  direction: "long",
  signalTime: 0,
  origin: "live-ready",
  grade: "B",
  score: 70,
  entry: 1,
  stopLoss: 0.99,
  target: 1.02,
  rr: 2,
  eqRR: 1.2,
  entrySource: "retest",
  entryStatus: "filled",
  stopSource: "swing",
  targetSource: "dol",
  session: "London",
  premiumDiscount: "discount",
  dailyBias: "bullish",
  h4Bias: "bullish",
  h1Bias: "bullish",
  regime: "trend",
  eventRisk: "none",
  governance: "allow",
  actionWindow: "valid",
  dataConfidence: 1,
  status: "tp2",
  rMultiple: 2,
  maxFavorableR: 2,
  maxAdverseR: -0.3,
  candlesHeld: 10,
  outcomeReason: "clean-model",
  setupWarnings: [],
  waitReasons: [],
  tags: [],
  note: ""
};

function mk(overrides: Partial<RuntimeReplayTrade>): RuntimeReplayTrade {
  return { ...base, ...overrides };
}

// A kümesi: long / discount / trend, hepsi kazanan (+2R). B kümesi: short / premium / range, hepsi
// kaybeden (-1R). İki küme yön + premium/discount + rejimde ayrışıyor.
const clusterA = Array.from({ length: 6 }, (_, i) =>
  mk({ id: `a${i}`, direction: "long", premiumDiscount: "discount", regime: "trend", dailyBias: "bullish", h4Bias: "bullish", h1Bias: "bullish", status: "tp2", rMultiple: 2 })
);
const clusterB = Array.from({ length: 6 }, (_, i) =>
  mk({ id: `b${i}`, symbol: "GBPUSD", direction: "short", premiumDiscount: "premium", regime: "range", dailyBias: "bearish", h4Bias: "bearish", h1Bias: "bearish", status: "stopped", rMultiple: -1, outcomeReason: "no-follow-through" })
);
const corpus = [...clusterA, ...clusterB];

describe("setup similarity (Gower mixed-type, dependency-free)", () => {
  it("distance to self is zero and similarity 1", () => {
    const index = buildSetupSimilarityIndex(corpus);
    expect(setupDistance(clusterA[0], clusterA[0], index)).toBe(0);
    const out = findSimilarSetups(index, corpus, clusterA[0], 1);
    expect(out.neighbors[0].distance).toBe(0);
    expect(out.neighbors[0].similarity).toBe(1);
  });

  it("a long/discount query retrieves the winning cluster and reports its real outcome", () => {
    const index = buildSetupSimilarityIndex(corpus);
    const out = findSimilarSetups(index, corpus, clusterA[0], 5);
    // En yakın 5 komşunun hepsi A kümesinden olmalı.
    expect(out.neighbors.every((n) => n.trade.id.startsWith("a"))).toBe(true);
    expect(out.resolved).toBe(5);
    expect(out.winRatePct).toBe(100);
    expect(out.avgR).toBeCloseTo(2, 5);
    expect(out.totalR).toBeCloseTo(10, 5);
  });

  it("a short/premium query retrieves the losing cluster", () => {
    const out = similarSetupOutcome(corpus, clusterB[0], 5);
    expect(out.neighbors.every((n) => n.trade.id.startsWith("b"))).toBe(true);
    expect(out.winRatePct).toBe(0);
    expect(out.avgR).toBeCloseTo(-1, 5);
  });

  it("cross-cluster distance is larger than within-cluster distance", () => {
    const index = buildSetupSimilarityIndex(corpus);
    const within = setupDistance(clusterA[0], clusterA[1], index);
    const across = setupDistance(clusterA[0], clusterB[0], index);
    expect(across).toBeGreaterThan(within);
  });

  it("excludes not-triggered/open neighbors from outcome stats", () => {
    const withOpen = [
      ...clusterA,
      mk({ id: "open1", status: "open", rMultiple: 0 }),
      mk({ id: "nt1", status: "not-triggered", rMultiple: 0 })
    ];
    const out = similarSetupOutcome(withOpen, clusterA[0], 8);
    // open/not-triggered komşular sonuç istatistiğine girmez.
    expect(out.resolved).toBe(6);
    expect(out.wins).toBe(6);
  });
});
