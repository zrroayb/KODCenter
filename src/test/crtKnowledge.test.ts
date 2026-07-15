import { describe, expect, it } from "vitest";
import { CRT_KNOWLEDGE, retrieveCrtKnowledge } from "../lib/gemini/crtKnowledge";

describe("CRT knowledge retrieval (Master §16)", () => {
  it("returns 3-8 relevant records, never the whole base", () => {
    const records = retrieveCrtKnowledge({ direction: "long" });
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(records.length).toBeLessThanOrEqual(8);
    expect(records.length).toBeLessThan(CRT_KNOWLEDGE.length);
  });

  it("includes the bullish-specific records for a long and never the bearish ones", () => {
    const records = retrieveCrtKnowledge({ direction: "long" });
    const ids = records.map((record) => record.id);
    expect(ids).toContain("sellside-sweep-bullish");
    expect(ids).toContain("discount-long");
    expect(ids).not.toContain("buyside-sweep-bearish");
    expect(ids).not.toContain("premium-short");
    expect(records.every((record) => record.applies !== "bearish")).toBe(true);
  });

  it("mirrors for a short", () => {
    const ids = retrieveCrtKnowledge({ direction: "short" }).map((record) => record.id);
    expect(ids).toContain("buyside-sweep-bearish");
    expect(ids).toContain("premium-short");
    expect(ids).not.toContain("sellside-sweep-bullish");
  });

  it("adds the turtle-soup record only when present, keeping the cap", () => {
    const withTs = retrieveCrtKnowledge({ direction: "long", hasTurtleSoup: true });
    const withoutTs = retrieveCrtKnowledge({ direction: "long", hasTurtleSoup: false });
    expect(withTs.map((r) => r.id)).toContain("turtle-soup");
    expect(withoutTs.map((r) => r.id)).not.toContain("turtle-soup");
    expect(withTs.length).toBeLessThanOrEqual(8);
  });

  it("returns unique records", () => {
    const ids = retrieveCrtKnowledge({ direction: "long", hasTurtleSoup: true }).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
