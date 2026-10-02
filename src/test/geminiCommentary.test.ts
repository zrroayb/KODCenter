import { describe, expect, it, vi } from "vitest";
import { buildGeminiTradeCommentaryPayload, fetchGeminiTradeCommentary } from "../lib/gemini/tradeCommentary";
import { tradeCommentaryViolation } from "../lib/gemini/commentaryGuard";
import { kodStrategy } from "./fixtures/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

function signalFixture() {
  const context = createStructureContext({
    dealingRange: { high: 105, low: 97, midpoint: 101, source: "Gemini fixture" },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 97, label: "Sell-side", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
  });
  return kodStrategy.scan({
    context,
    settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals[0];
}

describe("Gemini trade commentary", () => {
  it("sends a chart mentor context with candles, levels and decision line", () => {
    const payload = buildGeminiTradeCommentaryPayload(signalFixture());

    expect(payload.chart.timeframe).toBe("15m");
    expect(payload.chart.decisionLine).toBeTruthy();
    expect(payload.chart.keyLevels.map((level) => level.label)).toEqual(expect.arrayContaining(["ENTRY", "STOP", "EQ / BE", "DOL / TP (çıkış)", "SWEEP", "ChoCH / Just", "FVG BOX"]));
    expect(payload.chart.recentCandles.length).toBeGreaterThan(0);
    expect(payload.chart.recentCandles.some((candle) => candle.role?.includes("liquidity sweep"))).toBe(true);
    expect(payload.chart.annotations.fairValueGap?.low).toBe(100.2);
    expect(payload.structureAudit.headline).toBeTruthy();
    expect(payload.structureAudit.items.map((item) => item.label)).toContain("Distribution");
  });

  it("does not invent a chart FVG when the selected plan has no gap", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: []
    });
    const signal = kodStrategy.scan({
      context,
      settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
    }).signals[0];
    const payload = buildGeminiTradeCommentaryPayload(signal);

    expect(payload.entryModel.fairValueGap).toBeUndefined();
    expect(payload.chart.annotations.fairValueGap).toBeUndefined();
    expect(payload.chart.keyLevels.map((level) => level.label)).not.toContain("FVG BOX");
    expect(payload.structureAudit.items.find((item) => item.label === "POI")?.detail).toContain("zone varmış gibi konuşma");
  });

  it("falls back to a local commentary when Gemini times out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", error: "Gemini upstream timeout" }), {
        status: 502,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await fetchGeminiTradeCommentary(signalFixture());

    expect(result.status).toBe("fallback");
    expect(result.reason).toContain("Gemini upstream timeout");
    expect(result.commentary).toContain("Karar:");
    fetchSpy.mockRestore();
  });

  it("falls back to a local commentary when the request itself fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await fetchGeminiTradeCommentary(signalFixture());

    expect(result.status).toBe("fallback");
    expect(result.reason).toContain("network down");
    expect(result.commentary).toContain("Risk:");
    fetchSpy.mockRestore();
  });

  it("rejects commentary that contradicts the stage or the EQ full exit", () => {
    const body = (karar: string, beklenen = "Beklenen: Entry 100; pozisyonun tamamı EQ 101'de kapanır.") =>
      [`Karar: ${karar}`, "Neden: x", beklenen, "Risk: 1.2R"].join("\n");
    expect(tradeCommentaryViolation(body("Plan hazır; disiplinle uygula."), "ready")).toBeUndefined();
    expect(tradeCommentaryViolation(body("Bekle; ChoCH yok."), "ready")).toContain("Plan hazır");
    expect(tradeCommentaryViolation(body("Plan hazır; gir."), "watch")).toContain("Bekle");
    expect(tradeCommentaryViolation(body("Bekle; retest gelsin."), "watch")).toBeUndefined();
    expect(tradeCommentaryViolation(body("Plan hazır.", "Beklenen: EQ'da kısmi al, kalanı DOL'a taşı."), "ready")).toContain("kısmi");
    expect(tradeCommentaryViolation("Serbest metin", "ready")).toContain("Karar");
    expect(tradeCommentaryViolation(body("Kovalama yok."), "missed")).toBeUndefined();
  });

  it("replaces a Gemini answer that breaks the contract with the local fallback", async () => {
    const signal = signalFixture();
    const wrongKarar = signal.stage === "ready" ? "Bekle; emin değilim." : "Plan hazır; gir.";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ready", model: "m", commentary: `Karar: ${wrongKarar}\nNeden: x\nBeklenen: y\nRisk: z` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await fetchGeminiTradeCommentary({ ...signal, id: `${signal.id}-contract` });

    expect(result.status).toBe("fallback");
    expect(result.commentary).not.toMatch(/kısmi/i);
    if (signal.stage === "watch") expect(result.commentary).toMatch(/^Karar: Bekle/);
    if (signal.stage === "ready") expect(result.commentary).toMatch(/^Karar: Plan hazır/);
    fetchSpy.mockRestore();
  });
});
