import { describe, expect, it } from "vitest";
import { monteCarloAnalysis, walkForwardAnalysis } from "../lib/analytics/robustness";

describe("walk-forward (period stability)", () => {
  it("flags insufficient sample", () => {
    const out = walkForwardAnalysis([1, -1, 1], { folds: 5 });
    expect(out.verdict).toBe("insufficient");
    expect(out.folds).toHaveLength(0);
  });

  it("calls an edge that holds across every fold robust", () => {
    const rs = Array.from({ length: 30 }, () => 1); // her dönem pozitif
    const out = walkForwardAnalysis(rs, { folds: 5 });
    expect(out.positiveFolds).toBe(5);
    expect(out.verdict).toBe("robust");
    expect(out.expectancyStdev).toBe(0);
  });

  it("calls an edge concentrated in one stretch fragile", () => {
    // İlk 6 işlem +5R, kalan 24 işlem -1R: toplam pozitif ama edge tek döneme sıkışmış.
    const rs = [...Array.from({ length: 6 }, () => 5), ...Array.from({ length: 24 }, () => -1)];
    const out = walkForwardAnalysis(rs, { folds: 5 });
    expect(out.positiveFolds).toBeLessThanOrEqual(2);
    expect(out.verdict).toBe("fragile");
  });
});

describe("monte-carlo (bootstrap)", () => {
  it("all-win series → certain profit, positive p5", () => {
    const out = monteCarloAnalysis(Array.from({ length: 20 }, () => 1), { runs: 1000, seed: 7 });
    expect(out.probProfit).toBe(1);
    expect(out.finalR.p5).toBeGreaterThan(0);
    expect(out.finalR.p50).toBeCloseTo(20, 0);
  });

  it("all-loss series → zero profit and full ruin below threshold", () => {
    const out = monteCarloAnalysis(Array.from({ length: 20 }, () => -1), { runs: 1000, seed: 7, ruinThresholdR: -5 });
    expect(out.probProfit).toBe(0);
    expect(out.finalR.p95).toBeLessThan(0);
    expect(out.maxDrawdownR.worst).toBeCloseTo(20, 5);
    expect(out.probOfRuin).toBe(1);
  });

  it("is deterministic for a fixed seed", () => {
    const rs = [2, -1, 1, -1, 3, -1, -1, 2, 1, -1, -1, 1];
    const a = monteCarloAnalysis(rs, { runs: 500, seed: 42 });
    const b = monteCarloAnalysis(rs, { runs: 500, seed: 42 });
    expect(a).toEqual(b);
  });

  it("mixed series median tracks expectancy", () => {
    // beklenti = ort(R) ; n işlemde medyan final ≈ n * beklenti
    const rs = [2, -1, 2, -1, 2, -1, 2, -1]; // beklenti +0.5R, n=8 → ~+4R
    const out = monteCarloAnalysis(rs, { runs: 4000, seed: 3 });
    expect(out.finalR.p50).toBeGreaterThan(2);
    expect(out.finalR.p50).toBeLessThan(6);
    expect(out.probProfit).toBeGreaterThan(0.5);
  });

  it("handles empty input", () => {
    const out = monteCarloAnalysis([], { runs: 100 });
    expect(out.runs).toBe(0);
    expect(out.probProfit).toBe(0);
  });
});
