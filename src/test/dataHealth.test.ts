import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { buildDataHealthReport } from "../lib/data/dataHealth";

describe("data health report", () => {
  it("summarizes source, counts and stale/fallback issues", () => {
    const now = Date.UTC(2026, 5, 30, 8, 45);
    const markets = createDemoMarkets(now);

    const clean = buildDataHealthReport(markets, { source: "yahoo-live", feedMode: "synthetic-bid-ask", loadedAt: now, errors: [] }, now);
    const fallback = buildDataHealthReport(markets, { source: "mixed", feedMode: "synthetic-bid-ask", loadedAt: now, errors: ["EURUSD: provider timeout"] }, now);

    expect(clean.rows).toHaveLength(5);
    expect(clean.rows[0].counts.m15).toBeGreaterThan(20);
    expect(clean.rows[0].executionLagMinutes).toBeLessThanOrEqual(clean.rows[0].maxIntradayLagMinutes);
    expect(clean.rows[0].htfAgeMinutes).toBeLessThanOrEqual(clean.rows[0].maxIntradayLagMinutes);
    expect(clean.rows[0].maxIntradayLagMinutes).toBeLessThanOrEqual(clean.rows[0].maxLagMinutes);
    expect(clean.rows[0].dailyAgeMinutes).toBeGreaterThanOrEqual(0);
    expect(fallback.status).toBe("warning");
    expect(fallback.rows.find((row) => row.symbol === "EURUSD")?.source).toBe("demo");
  });
});
