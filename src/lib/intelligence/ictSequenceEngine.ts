import type { Displacement, FairValueGap, MarketContext, MarketStructureShift, Sweep, TradeDirection, TradePlan } from "../ict/types";

export type IctSequenceStepId = "draw" | "sweep" | "displacement" | "mss" | "delivery" | "retest" | "entry";
export type IctSequenceStatus = "ready" | "forming" | "invalid";

export type IctSequenceStep = {
  id: IctSequenceStepId;
  label: string;
  status: "pass" | "pending" | "fail" | "warning";
  detail: string;
  candleIndex?: number;
  time?: number;
  price?: number;
};

export type IctSequence = {
  direction: TradeDirection;
  status: IctSequenceStatus;
  ready: boolean;
  orderValid: boolean;
  qualityScore: number;
  setupStartIndex: number;
  steps: IctSequenceStep[];
  sweep?: Sweep;
  displacement?: Displacement;
  mss?: MarketStructureShift;
  deliveryGap?: FairValueGap;
  hardBlockers: string[];
  warnings: string[];
  summary: string;
};

function executionCandles(context: MarketContext) {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function candleTime(context: MarketContext, index: number | undefined): number | undefined {
  const candles = executionCandles(context);
  return typeof index === "number" ? candles[index]?.time : undefined;
}

function latestByIndex<T extends { candleIndex: number }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function expectedSweepSide(direction: TradeDirection) {
  return direction === "short" ? "buy-side" : "sell-side";
}

function expectedProfitSide(direction: TradeDirection) {
  return direction === "short" ? "sell-side" : "buy-side";
}

function findDeliveryGap(context: MarketContext, direction: TradeDirection, plan?: TradePlan): FairValueGap | undefined {
  if (plan?.entryModel.fairValueGap) return plan.entryModel.fairValueGap;
  return latestByIndex(context.fairValueGaps.filter((gap) => gap.direction === direction));
}

function gapFitsSequence(gap: FairValueGap | undefined, sweep: Sweep | undefined, displacement: Displacement | undefined, mss: MarketStructureShift | undefined): boolean {
  if (!gap) return false;
  const sweepIndex = sweep?.candleIndex ?? 0;
  const displacementIndex = displacement?.candleIndex ?? sweepIndex;
  const mssIndex = mss?.candleIndex ?? displacementIndex;
  return gap.candleIndex >= sweepIndex - 2 && gap.candleIndex <= mssIndex + 6 && Math.abs(gap.candleIndex - displacementIndex) <= 8;
}

function step(input: IctSequenceStep): IctSequenceStep {
  return input;
}

export function buildIctSequence(context: MarketContext, direction: TradeDirection, plan?: TradePlan): IctSequence {
  const candles = executionCandles(context);
  const side = expectedSweepSide(direction);
  const profitSide = expectedProfitSide(direction);
  const expectedBias = direction === "short" ? "bearish" : "bullish";
  const sweep = latestByIndex(context.sweeps.filter((item) => item.side === side && item.reclaimed));
  const setupStartIndex = sweep?.candleIndex ?? Math.max(0, candles.length - 1);
  const displacement = latestByIndex(context.displacements.filter((item) => item.direction === direction && item.candleIndex >= setupStartIndex));
  const mss = latestByIndex(context.marketStructureShifts.filter((item) =>
    item.direction === direction && item.candleIndex >= (displacement?.candleIndex ?? setupStartIndex)
  ));
  const deliveryGap = findDeliveryGap(context, direction, plan);
  const deliveryFits = gapFitsSequence(deliveryGap, sweep, displacement, mss);
  const hasDraw = context.liquidityObjectives.some((objective) => objective.side === profitSide)
    || context.liquidityPools.some((pool) => pool.side === profitSide);
  const htfAligned = context.bias.daily === expectedBias || context.bias.h4 === expectedBias;
  const orderValid = Boolean(sweep) && Boolean(displacement) && Boolean(mss) && (!deliveryGap || deliveryFits);
  const entryConfirmed = plan ? plan.entryStatus === "confirmed" && plan.entryModel.retested && plan.entryModel.cisdConfirmed : false;
  const ready = orderValid && Boolean(deliveryGap) && deliveryFits && entryConfirmed;
  const warnings: string[] = [];
  const hardBlockers: string[] = [];

  if (!sweep) warnings.push(`${side} sweep + reclaim bekleniyor.`);
  if (sweep && !displacement) warnings.push("Sweep sonrası displacement bekleniyor.");
  if (displacement && !mss) warnings.push("Displacement sonrası MSS/CISD kapanışı bekleniyor.");
  if (mss?.kind === "choch") warnings.push("CHoCH reversal yapısı: retest gelmeden READY alma.");
  if (!deliveryGap) warnings.push("Sweep sonrası geçerli FVG/iFVG delivery yok.");
  if (deliveryGap && !deliveryFits) {
    hardBlockers.push("FVG/iFVG mevcut setup sırasına ait değil; eski/alakasız delivery kullanılmaz.");
  }
  if (plan && plan.entryStatus !== "confirmed") warnings.push("Entry retest + mum kapanışı henüz tamamlanmadı.");
  if (!htfAligned) warnings.push("HTF draw/bias yönü setup ile tam hizalı değil.");

  const steps = [
    step({
      id: "draw",
      label: "Draw / HTF",
      status: hasDraw ? (htfAligned ? "pass" : "warning") : "pending",
      detail: hasDraw
        ? `Profit side ${profitSide}; Daily/H4/H1 ${context.bias.daily}/${context.bias.h4}/${context.bias.h1}.`
        : `Profit side ${profitSide} objective bekleniyor.`
    }),
    step({
      id: "sweep",
      label: "Liquidity sweep",
      status: sweep ? "pass" : "pending",
      detail: sweep ? `${sweep.side} sweep + reclaim ${sweep.level.toFixed(5)}.` : `${side} sweep + reclaim yok.`,
      candleIndex: sweep?.candleIndex,
      time: candleTime(context, sweep?.candleIndex),
      price: sweep?.level
    }),
    step({
      id: "displacement",
      label: "Displacement",
      status: displacement ? "pass" : sweep ? "pending" : "fail",
      detail: displacement ? `${direction} impulse, range ${displacement.rangeAtr.toFixed(2)}x avg.` : "Sweep sonrası impuls bekleniyor.",
      candleIndex: displacement?.candleIndex,
      time: candleTime(context, displacement?.candleIndex)
    }),
    step({
      id: "mss",
      label: mss?.kind === "choch" ? "CHoCH / CISD" : mss?.kind === "bos" ? "BOS / CISD" : "MSS / CISD",
      status: mss ? "pass" : displacement ? "pending" : "fail",
      detail: mss ? `${direction} ${(mss.kind ?? "mss").toUpperCase()} close through ${mss.level.toFixed(5)}.` : "Yön değişimi mum kapanışı bekleniyor.",
      candleIndex: mss?.candleIndex,
      time: candleTime(context, mss?.candleIndex),
      price: mss?.level
    }),
    step({
      id: "delivery",
      label: "FVG / iFVG delivery",
      status: deliveryGap ? (deliveryFits ? "pass" : "fail") : "pending",
      detail: deliveryGap
        ? deliveryFits
          ? `Setup delivery gap ${deliveryGap.low.toFixed(5)}-${deliveryGap.high.toFixed(5)}.`
          : `Gap ${deliveryGap.low.toFixed(5)}-${deliveryGap.high.toFixed(5)} sequence dışında.`
        : "Sweep sonrası FVG/iFVG delivery bekleniyor.",
      candleIndex: deliveryGap?.candleIndex,
      time: candleTime(context, deliveryGap?.candleIndex),
      price: deliveryGap?.midpoint
    }),
    step({
      id: "retest",
      label: "Retest",
      status: plan?.entryModel.retested ? "pass" : deliveryGap ? "pending" : "fail",
      detail: plan?.entryModel.retested ? "Entry zone retest/mitigation görüldü." : "Entry kutusuna dönüş bekleniyor.",
      price: plan?.entry
    }),
    step({
      id: "entry",
      label: "Entry close",
      status: entryConfirmed ? "pass" : plan ? "pending" : "fail",
      detail: entryConfirmed ? "MSS/CISD kapanışıyla entry onaylandı." : "Entry için mum kapanışı bekleniyor.",
      price: plan?.entry
    })
  ];

  const passed = steps.filter((item) => item.status === "pass").length;
  const warningsCount = steps.filter((item) => item.status === "warning").length;
  const qualityScore = Math.max(0, Math.min(100, Math.round((passed / steps.length) * 100 - warningsCount * 6 - hardBlockers.length * 20)));
  const status: IctSequenceStatus = hardBlockers.length ? "invalid" : ready ? "ready" : "forming";

  return {
    direction,
    status,
    ready,
    orderValid,
    qualityScore,
    setupStartIndex,
    steps,
    sweep,
    displacement,
    mss,
    deliveryGap,
    hardBlockers,
    warnings,
    summary: ready
      ? "ICT sequence tamam: draw, sweep, displacement, MSS, delivery ve retest hazır."
      : [...hardBlockers, ...warnings][0] ?? "ICT sequence izleniyor."
  };
}
