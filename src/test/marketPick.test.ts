import { describe, expect, it } from "vitest";
import { localMarketPick, type GeminiMarketPickPayload } from "../lib/gemini/marketPick";

function candidate(overrides: Partial<GeminiMarketPickPayload["candidates"][number]> = {}) {
  return {
    id: "sig-1",
    symbol: "XAUUSD",
    direction: "short",
    stage: "watch",
    grade: "B",
    score: 62,
    rr: 2.1,
    entry: 2150,
    stopLoss: 2158,
    targets: [2141, 2120],
    summary: "XAUUSD SHORT CRT 4h watch",
    governance: "caution",
    blockers: ["15m ChoCH/Just mum kapanışı yok."],
    warnings: [],
    ...overrides
  };
}

describe("local market pick (masa görüşü)", () => {
  it("says take nothing when the board is empty", () => {
    const view = localMarketPick({ generatedAt: 0, dataSource: "yahoo-live", marketCount: 12, candidates: [] });
    expect(view.commentary).toContain("hiçbir şey alma");
  });

  it("names one pick, explains the runner-up, and states what flips the call", () => {
    const view = localMarketPick({
      generatedAt: 0,
      dataSource: "yahoo-live",
      marketCount: 12,
      candidates: [
        candidate({ id: "a", symbol: "EURUSD", direction: "long", score: 74 }),
        candidate({ id: "b", symbol: "BTCUSD", direction: "short", score: 58, blockers: ["HTF anlatı belirsiz."] })
      ]
    });
    expect(view.commentary).toContain("EURUSD LONG");
    expect(view.commentary).toContain("BTCUSD SHORT");
    expect(view.commentary).toContain("tercih etmezdim");
    expect(view.commentary).toContain("Kararı çevirecek şey");
  });

  it("recommends taking a clean READY outright and flags demo data", () => {
    const view = localMarketPick({
      generatedAt: 0,
      dataSource: "demo",
      marketCount: 12,
      candidates: [candidate({ stage: "ready", blockers: [], grade: "A", score: 84 })]
    });
    expect(view.commentary).toContain("Bence XAUUSD SHORT alınır");
    expect(view.commentary).toContain("demo fallback");
  });
});
