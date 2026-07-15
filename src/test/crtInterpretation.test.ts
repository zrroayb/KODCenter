import { describe, expect, it } from "vitest";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { buildCrtGeminiPayload, validateCrtInterpretation } from "../lib/gemini/crtInterpretation";
import { createDemoMarkets } from "../data/demoData";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";

function crtSignal() {
  const usdJpy = attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)))
    .find((context) => context.symbol === "USDJPY");
  if (!usdJpy) throw new Error("USDJPY fixture missing");
  const signal = crtStrategy.scan({ context: usdJpy, settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5 } }).signals[0];
  if (!signal) throw new Error("no signal");
  return signal;
}

describe("CRT Gemini interpretation contract", () => {
  it("builds a payload where every evidence event has a unique id", () => {
    const payload = buildCrtGeminiPayload(crtSignal());
    const ids = payload.events.map((event) => event.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(payload.events.every((event) => event.id.startsWith(payload.signal_id))).toBe(true);
    expect(payload.crt.reference_timeframe).toBeDefined();
  });

  it("carries the structured directional_bias block and retrieved knowledge (Master §9/§16)", () => {
    const payload = buildCrtGeminiPayload(crtSignal());
    expect(payload.directional_bias).toBeDefined();
    expect(typeof payload.directional_bias.bullish_score === "number" || payload.directional_bias.bullish_score === undefined).toBe(true);
    expect(payload.knowledge.length).toBeGreaterThanOrEqual(3);
    expect(payload.knowledge.length).toBeLessThanOrEqual(8);
    expect(payload.crt).toHaveProperty("reference_candle_score");
  });

  it("accepts a well-formed response that references only known event ids", () => {
    const payload = buildCrtGeminiPayload(crtSignal());
    const known = payload.events[0].id;
    const result = validateCrtInterpretation({
      directional_analysis: { bias: "bearish", reasoning: "x", supporting_event_ids: [known] },
      crt_analysis: { status: "developing", direction: "none" },
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(true);
  });

  it("rejects a response that invents an unknown event id", () => {
    const payload = buildCrtGeminiPayload(crtSignal());
    const result = validateCrtInterpretation({
      directional_analysis: { bias: "bullish", reasoning: "x", supporting_event_ids: ["made-up-id"] },
      crt_analysis: { status: "confirmed", direction: "bullish" },
      plain_language_summary: "ok"
    }, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Bilinmeyen event id");
  });

  it("rejects invalid JSON and missing required fields", () => {
    const payload = buildCrtGeminiPayload(crtSignal());
    expect(validateCrtInterpretation("{not json", payload).ok).toBe(false);
    expect(validateCrtInterpretation({ crt_analysis: { status: "x" } }, payload).ok).toBe(false);
    expect(validateCrtInterpretation({ directional_analysis: { bias: "neutral", reasoning: "x" }, crt_analysis: { status: "x", direction: "none" } }, payload).ok).toBe(false);
  });
});
