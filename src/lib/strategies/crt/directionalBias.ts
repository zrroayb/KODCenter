import type { Displacement, LiquidityObjective, MarketStructureShift, Sweep, TradeDirection } from "../../ict/types";

// Two-sided directional-bias engine — Master §8/§11. CRT must NOT create direction; direction is
// established first, from separate bullish/bearish scores in the order:
//   external liquidity draw -> HTF structure -> dealing-range location -> liquidity sweep
//   -> displacement -> LTF confirmation -> session/timing.
// This produces the structured bias evidence (Master §9/§12). It does not override the per-anchor
// mechanic; it grades the market's two-sided lean and confidence so Gemini can interpret it.

export type BiasDirection = "bullish" | "bearish" | "neutral";
type TfBias = "bullish" | "bearish" | "neutral";

export type DirectionalBiasWeights = {
  externalDraw: number;
  htfStructure: number;
  pdLocation: number;
  sweep: number;
  displacement: number;
  ltfConfirmation: number;
  session: number;
};

export const DIRECTIONAL_BIAS_WEIGHTS: DirectionalBiasWeights = {
  externalDraw: 25,
  htfStructure: 25,
  pdLocation: 15,
  sweep: 15,
  displacement: 10,
  ltfConfirmation: 5,
  session: 5
};

// Master §11 decision rule (configurable starting values, not "universally profitable").
export const DIRECTIONAL_BIAS_THRESHOLD = 65;
export const DIRECTIONAL_BIAS_MARGIN = 15;

export type DirectionalBiasComponents = {
  externalDraw: { bullish: number; bearish: number };
  htfStructure: { bullish: number; bearish: number };
  pdLocation: { bullish: number; bearish: number };
  sweep: { bullish: number; bearish: number };
  displacement: { bullish: number; bearish: number };
  ltfConfirmation: { bullish: number; bearish: number };
  session: { bullish: number; bearish: number };
};

export type DirectionalBias = {
  direction: BiasDirection;
  bullishScore: number;
  bearishScore: number;
  confidence: number;
  externalDraw?: { side: "buy-side" | "sell-side"; level: number; label: string };
  components: DirectionalBiasComponents;
  bullishReasons: string[];
  bearishReasons: string[];
  summary: string;
};

const strengthWeight = (strength: LiquidityObjective["strength"], max: number) =>
  strength === "strong" ? max : strength === "moderate" ? Math.round(max * 0.68) : Math.round(max * 0.4);

export function evaluateDirectionalBias(input: {
  price: number;
  htfBias: { monthly: TfBias; weekly: TfBias; daily: TfBias; h4: TfBias };
  pdZone: "premium" | "discount" | "equilibrium" | "unknown";
  liquidityObjectives: LiquidityObjective[];
  sweeps: Sweep[];
  displacements: Displacement[];
  marketStructureShifts: MarketStructureShift[];
  inKillzone: boolean;
  weights?: Partial<DirectionalBiasWeights>;
}): DirectionalBias {
  const w = { ...DIRECTIONAL_BIAS_WEIGHTS, ...input.weights };
  const bullishReasons: string[] = [];
  const bearishReasons: string[] = [];

  // 1) External liquidity draw — the strongest UNSWEPT external liquidity above (bullish draw) or
  // below (bearish draw) the current price. The nearest level is not automatically the draw;
  // strength decides the weight (Master §8.2).
  const buyDraws = input.liquidityObjectives.filter((o) => o.side === "buy-side" && o.level > input.price);
  const sellDraws = input.liquidityObjectives.filter((o) => o.side === "sell-side" && o.level < input.price);
  const bestBuy = buyDraws.sort((a, b) => strengthWeight(b.strength, 100) - strengthWeight(a.strength, 100))[0];
  const bestSell = sellDraws.sort((a, b) => strengthWeight(b.strength, 100) - strengthWeight(a.strength, 100))[0];
  const externalDraw = {
    bullish: bestBuy ? strengthWeight(bestBuy.strength, w.externalDraw) : 0,
    bearish: bestSell ? strengthWeight(bestSell.strength, w.externalDraw) : 0
  };
  if (bestBuy) bullishReasons.push(`Üstte alınmamış buy-side likidite: ${bestBuy.label} (${bestBuy.strength}).`);
  if (bestSell) bearishReasons.push(`Altta alınmamış sell-side likidite: ${bestSell.label} (${bestSell.strength}).`);

  // 2) HTF structure — M/W/D/4H votes.
  const votes = [input.htfBias.monthly, input.htfBias.weekly, input.htfBias.daily, input.htfBias.h4];
  const bull = votes.filter((v) => v === "bullish").length;
  const bear = votes.filter((v) => v === "bearish").length;
  const htfStructure = {
    bullish: Math.round((bull / votes.length) * w.htfStructure),
    bearish: Math.round((bear / votes.length) * w.htfStructure)
  };
  if (bull > 0) bullishReasons.push(`HTF yapı: ${bull}/4 zaman dilimi bullish.`);
  if (bear > 0) bearishReasons.push(`HTF yapı: ${bear}/4 zaman dilimi bearish.`);

  // 3) Dealing-range location — discount favours longs, premium favours shorts.
  const pdLocation = {
    bullish: input.pdZone === "discount" ? w.pdLocation : 0,
    bearish: input.pdZone === "premium" ? w.pdLocation : 0
  };
  if (input.pdZone === "discount") bullishReasons.push("Fiyat range discount'ında (long lehine).");
  if (input.pdZone === "premium") bearishReasons.push("Fiyat range premium'unda (short lehine).");

  // 4) Liquidity sweep — the most recent RECLAIMED sweep. A reclaimed sell-side sweep is bullish
  // (sells taken, reversing up); a reclaimed buy-side sweep is bearish.
  const latestSweep = [...input.sweeps].filter((s) => s.reclaimed).sort((a, b) => b.candleIndex - a.candleIndex)[0];
  const sweep = {
    bullish: latestSweep?.side === "sell-side" ? w.sweep : 0,
    bearish: latestSweep?.side === "buy-side" ? w.sweep : 0
  };
  if (latestSweep?.side === "sell-side") bullishReasons.push("Sell-side likidite süpürüldü ve reclaim edildi.");
  if (latestSweep?.side === "buy-side") bearishReasons.push("Buy-side likidite süpürüldü ve reclaim edildi.");

  // 5) Displacement — the most recent displacement direction, scaled by its body/ATR quality.
  const latestDisp = [...input.displacements].sort((a, b) => b.candleIndex - a.candleIndex)[0];
  const dispScale = latestDisp ? Math.max(0.4, Math.min(1, (latestDisp.bodyRatio + Math.min(latestDisp.rangeAtr, 2) / 2) / 2)) : 0;
  const displacement = {
    bullish: latestDisp?.direction === "long" ? Math.round(w.displacement * dispScale) : 0,
    bearish: latestDisp?.direction === "short" ? Math.round(w.displacement * dispScale) : 0
  };
  if (latestDisp?.direction === "long") bullishReasons.push("Son displacement yukarı yönlü.");
  if (latestDisp?.direction === "short") bearishReasons.push("Son displacement aşağı yönlü.");

  // 6) LTF confirmation — the most recent MSS/BOS direction.
  const latestMss = [...input.marketStructureShifts].sort((a, b) => b.candleIndex - a.candleIndex)[0];
  const ltfConfirmation = {
    bullish: latestMss?.direction === "long" ? w.ltfConfirmation : 0,
    bearish: latestMss?.direction === "short" ? w.ltfConfirmation : 0
  };
  if (latestMss?.direction === "long") bullishReasons.push(`LTF ${latestMss.kind ?? "mss"} yukarı.`);
  if (latestMss?.direction === "short") bearishReasons.push(`LTF ${latestMss.kind ?? "mss"} aşağı.`);

  // 7) Session/timing — a killzone gives the side that already leads a small timing confluence.
  const leadBeforeSession = (externalDraw.bullish + htfStructure.bullish + pdLocation.bullish + sweep.bullish + displacement.bullish + ltfConfirmation.bullish)
    - (externalDraw.bearish + htfStructure.bearish + pdLocation.bearish + sweep.bearish + displacement.bearish + ltfConfirmation.bearish);
  const session = {
    bullish: input.inKillzone && leadBeforeSession > 0 ? w.session : 0,
    bearish: input.inKillzone && leadBeforeSession < 0 ? w.session : 0
  };

  const components: DirectionalBiasComponents = { externalDraw, htfStructure, pdLocation, sweep, displacement, ltfConfirmation, session };
  const sumSide = (side: "bullish" | "bearish") => Object.values(components).reduce((total, c) => total + c[side], 0);
  const bullishScore = Math.max(0, Math.min(100, sumSide("bullish")));
  const bearishScore = Math.max(0, Math.min(100, sumSide("bearish")));

  let direction: BiasDirection = "neutral";
  if (bullishScore >= DIRECTIONAL_BIAS_THRESHOLD && bullishScore - bearishScore >= DIRECTIONAL_BIAS_MARGIN) direction = "bullish";
  else if (bearishScore >= DIRECTIONAL_BIAS_THRESHOLD && bearishScore - bullishScore >= DIRECTIONAL_BIAS_MARGIN) direction = "bearish";
  const confidence = direction === "neutral" ? 0 : Math.min(100, Math.abs(bullishScore - bearishScore) + Math.max(bullishScore, bearishScore) - DIRECTIONAL_BIAS_THRESHOLD);

  const draw = direction === "bullish" ? bestBuy : direction === "bearish" ? bestSell : (externalDraw.bullish >= externalDraw.bearish ? bestBuy : bestSell);
  const summary = direction === "neutral"
    ? `Yön belirsiz: bullish ${bullishScore} / bearish ${bearishScore} (eşik ${DIRECTIONAL_BIAS_THRESHOLD}, marj ${DIRECTIONAL_BIAS_MARGIN}).`
    : `${direction === "bullish" ? "BULLISH" : "BEARISH"} bias (bullish ${bullishScore} / bearish ${bearishScore}); hedef draw ${draw?.label ?? "belirsiz"}.`;

  return {
    direction,
    bullishScore,
    bearishScore,
    confidence,
    externalDraw: draw ? { side: draw.side, level: draw.level, label: draw.label } : undefined,
    components,
    bullishReasons,
    bearishReasons,
    summary
  };
}
