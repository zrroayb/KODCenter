import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { detectDriftBias } from "../lib/intelligence/biasEngine";
import { detectEqualLevels, equalLevelObjectives } from "../lib/intelligence/equalLevels";
import { detectStructuralBias } from "../lib/intelligence/structuralBias";
import { createDemoMarkets } from "../data/demoData";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";

// Dönüş noktalarından zigzag seri üretir; her bacak `perLeg` mum sürer, böylece dönüşler
// wing onaylı gerçek swing olur.
function series(turns: number[], perLeg = 5, wick = 0.2): Candle[] {
  const candles: Candle[] = [];
  let index = 0;
  for (let leg = 0; leg < turns.length - 1; leg += 1) {
    const from = turns[leg];
    const to = turns[leg + 1];
    for (let step = 1; step <= perLeg; step += 1) {
      const price = from + ((to - from) * step) / perLeg;
      candles.push({
        time: index * 3_600_000,
        open: price,
        high: price + wick,
        low: price - wick,
        close: price,
        volume: 1,
        closed: true
      });
      index += 1;
    }
  }
  return candles;
}

describe("structural HTF bias (Master §3/§8)", () => {
  // Not: son dönüş noktası sağ kanatla onaylanana kadar swing sayılmaz (repaint koruması),
  // bu yüzden fixture'ların sonunda teyit bacağı var.
  it("reads HH + HL as an uptrend", () => {
    const bias = detectStructuralBias(series([100, 95, 110, 100, 120, 114]));
    expect(bias.bias).toBe("bullish");
    expect(bias.pattern).toBe("uptrend");
    expect(bias.protectedLow).toBeDefined();
  });

  it("reads LH + LL as a downtrend", () => {
    const bias = detectStructuralBias(series([100, 105, 90, 100, 85, 92]));
    expect(bias.bias).toBe("bearish");
    expect(bias.pattern).toBe("downtrend");
  });

  it("reads a broadening range via its internal (LTF) MSB instead of a blind neutral", () => {
    // Major yapı belirsiz (HH+LL broadening) AMA fiyat prior high 110'u kapanışla kırıp üstünde
    // tutunuyor → iç-yapı MSB yukarı (weak). Bu drift motorunun uydurması DEĞİL: gerçek break-and-hold.
    // Owner 2026-07-27: "msb'yi motor görmeli, genelde uygula."
    const candles = series([100, 95, 110, 90, 120, 114]);
    const structural = detectStructuralBias(candles);
    expect(structural.pattern).toBe("expanding");
    expect(structural.bias).toBe("bullish");
    expect(structural.confidence).toBe("weak");            // major belirsiz → weak
    expect(structural.lastEvent?.kind).toBe("choch");       // iç-MSB karakter değişimi
    expect(detectDriftBias(candles)).not.toBe("neutral");
  });

  it("still returns an honest neutral when there is no holding internal break (contracting, mid-range)", () => {
    // İç-MSB fazla hevesli değil: kırılım tutmuyorsa yine dürüst neutral. Motorun temkini korunur.
    const structural = detectStructuralBias(series([100, 120, 105, 115, 108, 112]));
    expect(structural.pattern).toBe("contracting");
    expect(structural.bias).toBe("neutral");
    expect(structural.lastEvent).toBeUndefined();
  });

  it("flips to CHoCH when the protected low breaks after an uptrend", () => {
    const bias = detectStructuralBias(series([100, 95, 110, 100, 120, 96]));
    expect(bias.lastEvent?.kind).toBe("choch");
    expect(bias.bias).toBe("bearish");
  });

  it("still reads a pullback-free impulse leg as a trend, not as unclear", () => {
    // Pivotsuz monoton düşüş: onaylı swing yoktur ama bu en temiz düşüş trendidir.
    const bias = detectStructuralBias(series([100, 80], 30));
    expect(bias.bias).toBe("bearish");
    expect(bias.confidence).toBe("weak");
  });

  it("stays neutral when there is no structure and price sits mid-range", () => {
    const flat: Candle[] = Array.from({ length: 30 }, (_, index) => ({
      time: index * 3_600_000,
      open: 100,
      high: 100 + (index % 2 === 0 ? 1 : 0),
      low: 100 - (index % 2 === 0 ? 1 : 0),
      close: 100,
      volume: 1,
      closed: true
    }));
    expect(detectStructuralBias(flat).bias).toBe("neutral");
  });

  it("ignores unclosed candles (no repaint from a forming bar)", () => {
    const base = series([100, 95, 110, 100, 120]);
    const withForming = [...base, { ...base[base.length - 1], time: 9_999_999_999, low: 10, close: 12, closed: false }];
    expect(detectStructuralBias(withForming).bias).toBe(detectStructuralBias(base).bias);
  });
});

describe("equal highs/lows liquidity (Master §3)", () => {
  it("groups equal swing highs into a buy-side pool and grades strength by touches", () => {
    const levels = detectEqualLevels(series([100, 95, 110, 100, 110.04, 96]));
    const eqh = levels.find((level) => level.side === "buy-side");
    expect(eqh).toBeDefined();
    expect(eqh!.touches).toBeGreaterThanOrEqual(2);
    expect(eqh!.strength).toBe("moderate");
  });

  it("marks a pool swept once price trades through it, and swept pools are not exported as draws", () => {
    // İki eşit tepe kurulur, sonra fiyat üstüne çıkar: havuz süpürülmüştür, artık draw değildir.
    const candles = series([100, 95, 110, 100, 110.04, 100, 125]);
    const swept = detectEqualLevels(candles).filter((level) => level.side === "buy-side" && level.swept);
    expect(swept.length).toBeGreaterThan(0);
    const objectives = equalLevelObjectives(candles, "1d");
    expect(objectives.every((objective) => objective.kind !== "EQH")).toBe(true);
  });

  it("exports unswept equal levels as EQH/EQL liquidity objectives", () => {
    const objectives = equalLevelObjectives(series([100, 95, 110, 100, 110.04, 104]), "1d");
    expect(objectives.length).toBeGreaterThan(0);
    expect(objectives.every((objective) => objective.kind === "EQH" || objective.kind === "EQL")).toBe(true);
    expect(objectives[0].source).toContain("Equal");
  });
});

describe("Master §6 lifecycle chain", () => {
  it("exposes the full 10-state chain on the anchor, not just a 4-state phase", () => {
    const contexts = attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)));
    const valid = new Set([
      "CANDIDATE", "ACTIVE_RANGE", "SIDE_SWEPT", "RETURNED_INSIDE", "CONFIRMATION_PENDING",
      "CONFIRMED", "TARGETING_MIDPOINT", "TARGETING_OPPOSITE_EXTREME", "INVALIDATED", "COMPLETED"
    ]);
    const seen = new Set<string>();
    for (const context of contexts) {
      for (const signal of crtStrategy.scan({ context, settings: { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false } }).signals) {
        const state = signal.crtAnchor?.lifecycleState;
        expect(state).toBeDefined();
        expect(valid.has(String(state))).toBe(true);
        seen.add(String(state));
        // Zincir tutarlılığı: invalidated stage her zaman INVALIDATED lifecycle demektir.
        if (signal.stage === "invalidated") expect(state).toBe("INVALIDATED");
        // Lifecycle kanıt olarak da sunulur (Master §9).
        expect(signal.evidence.some((item) => item.id === "crt-lifecycle")).toBe(true);
      }
    }
    // Tek bir duruma çakılıp kalmamalı — zincir gerçekten ayrışmalı.
    expect(seen.size).toBeGreaterThan(1);
  });
});
