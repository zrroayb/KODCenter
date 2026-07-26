import { describe, expect, it } from "vitest";
import { __crtInternals } from "../lib/strategies/crt/crt.strategy";
import type { MarketContext } from "../lib/ict/types";

// Owner kuralı (2026-07-26): güçlü HTF trend + fiyat swept HTF range kenarının ötesinde KABUL
// görmüşse (reclaim yok), karşı-trend CRT reversal bastırılır — continuation'a devredilir.
const { continuationAcceptanceSuppresses } = __crtInternals;

function ctx(bias: "bullish" | "bearish" | "neutral", confidence: "strong" | "moderate" | "weak"): MarketContext {
  return { biasDetail: { daily: { bias, confidence, pattern: "uptrend", reasons: [] } } } as unknown as MarketContext;
}
function anchor(rangeTf: string, high: number, low: number, lastClose: number) {
  return { spec: { rangeTf }, range: { high, low }, confirmCandles: [{ close: lastClose }] } as never;
}
function setup(direction: "long" | "short", reclaimed = false) {
  return { direction, manipulation: { reclaimed } } as never;
}

describe("CRT acceptance suppression (don't auto-hunt reversal into an accepted breakout)", () => {
  it("suppresses a counter-trend 1W short when strong daily uptrend + price accepted above the range high", () => {
    // USDCHF vakası: daily strong uptrend, 1W range high 0.80960, fiyat 0.81770 (üstünde kabul).
    expect(continuationAcceptanceSuppresses(ctx("bullish", "strong"), anchor("1w", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(true);
  });

  it("suppresses a counter-trend 1D long when strong daily downtrend + price accepted below the range low", () => {
    expect(continuationAcceptanceSuppresses(ctx("bearish", "strong"), anchor("1d", 1.11, 1.10, 1.095), setup("long"))).toBe(true);
  });

  it("does NOT suppress a 4h/1h tactical raid (only 1d/1w HTF anchors are scoped)", () => {
    expect(continuationAcceptanceSuppresses(ctx("bullish", "strong"), anchor("4h", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(false);
    expect(continuationAcceptanceSuppresses(ctx("bullish", "strong"), anchor("1h", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(false);
  });

  it("does NOT suppress a valid reversal: price reclaimed back inside the range (no acceptance)", () => {
    // Fiyat range high'ın ALTINDA kapandı → reclaim/dönüş, kabul yok → CRT short korunur.
    expect(continuationAcceptanceSuppresses(ctx("bullish", "strong"), anchor("1w", 0.80960, 0.79090, 0.80500), setup("short"))).toBe(false);
  });

  it("does NOT suppress a WITH-trend reversal (short in a downtrend)", () => {
    expect(continuationAcceptanceSuppresses(ctx("bearish", "strong"), anchor("1w", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(false);
  });

  it("does NOT suppress when the daily trend is not strong (weak/moderate never auto-suppresses)", () => {
    expect(continuationAcceptanceSuppresses(ctx("bullish", "moderate"), anchor("1w", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(false);
    expect(continuationAcceptanceSuppresses(ctx("neutral", "strong"), anchor("1w", 0.80960, 0.79090, 0.81770), setup("short"))).toBe(false);
  });
});
