import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/ict/types";
import { detectDriftBias } from "../lib/intelligence/biasEngine";
import { detectEqualLevels, equalLevelObjectives } from "../lib/intelligence/equalLevels";
import { detectStructuralBias } from "../lib/intelligence/structuralBias";

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

  it("returns an honest neutral on a broadening range (HH + LL) instead of guessing", () => {
    // Bu, drift motorunun sessizce taraf seçtiği durum: yapı çelişkili, yön yok.
    const candles = series([100, 95, 110, 90, 120, 114]);
    const structural = detectStructuralBias(candles);
    expect(structural.pattern).toBe("expanding");
    expect(structural.bias).toBe("neutral");
    // Eski motor aynı seride yön uyduruyordu — regresyonun kanıtı.
    expect(detectDriftBias(candles)).not.toBe("neutral");
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
