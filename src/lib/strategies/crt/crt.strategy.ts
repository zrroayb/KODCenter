import { checklistItem } from "../../brain/decisionSummary";
import { formatPrice, formatR } from "../../ict/format";
import type { Candle, CrtPoi, DecisionSummary, ExecutionCostStress, MarketContext, MarketSymbol, QualityGrade, SignalActionWindow, SignalEvidenceItem, SignalGovernance, SignalOutcome, StopSource, TradeDirection, TradePlan, TradingSignal } from "../../ict/types";
import { isCryptoSymbol } from "../../ict/symbols";
import { defaultAccountModel } from "../../risk/accountModel";
import { estimateExecutionCosts } from "../../risk/executionCosts";
import { calculatePositionSize } from "../../risk/positionSizing";
import { performanceFromSignals } from "../../analytics/performance";
import { evaluateSignalOutcome, buildActionWindow } from "../../intelligence/outcomeEngine";
import type { BacktestInput, StrategyInput, StrategyModule, StrategyResult } from "../types";

const CRT_STRATEGY_ID = "crt";
const DEFAULT_MINIMUM_RR = 1.5;
// Freshness windows on execution (m15) candles: a sweep older than ~6h or a ChoCH older than ~3h no longer validates a setup.
const SWEEP_FRESHNESS_CANDLES = 24;
const CHOCH_FRESHNESS_CANDLES = 12;
const SYMBOL_MIN_BUFFER: Record<MarketSymbol, number> = {
  XAUUSD: 0.8,
  NAS100: 12,
  EURUSD: 0.0002,
  GBPUSD: 0.0002,
  BTCUSD: 120
};

type CrtSetup = {
  direction: TradeDirection;
  manipulation?: { side: "buy-side" | "sell-side"; level: number; candleIndex: number; reclaimed: boolean };
  choch?: { level: number; candleIndex: number };
  poi?: CrtPoi;
  plan: TradePlan;
  warnings: string[];
  blockers: string[];
  score: number;
};

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

type DirectionSource = "sweep" | "bias" | "pd";

function rangeExtremeSweep(context: MarketContext, direction: TradeDirection): CrtSetup["manipulation"] {
  const candles = executionCandles(context);
  const freshnessStart = Math.max(0, candles.length - SWEEP_FRESHNESS_CANDLES);
  const rangeLevel = direction === "short" ? context.crt.activeRange.high : context.crt.activeRange.low;
  const sweep = candles
    .map((candle, candleIndex) => ({ candle, candleIndex }))
    .filter(({ candleIndex }) => candleIndex >= freshnessStart)
    .filter(({ candle }) => direction === "short"
      ? candle.high > rangeLevel && candle.close < rangeLevel
      : candle.low < rangeLevel && candle.close > rangeLevel)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  if (!sweep) return undefined;
  return {
    side: expectedSweepSide(direction),
    level: direction === "short" ? sweep.candle.high : sweep.candle.low,
    candleIndex: sweep.candleIndex,
    reclaimed: true
  };
}

function directionFromContext(context: MarketContext): { direction: TradeDirection; source: DirectionSource } {
  // CRT reversal model: direction comes from which range extreme was swept and reclaimed,
  // not from HTF bias alone. Bias acts as confluence, not as the dictator.
  const shortSweep = rangeExtremeSweep(context, "short");
  const longSweep = rangeExtremeSweep(context, "long");
  if (shortSweep && longSweep) {
    return { direction: shortSweep.candleIndex >= longSweep.candleIndex ? "short" : "long", source: "sweep" };
  }
  if (shortSweep) return { direction: "short", source: "sweep" };
  if (longSweep) return { direction: "long", source: "sweep" };
  if (context.crt.selectedBias.direction === "long" || context.crt.selectedBias.direction === "short") {
    return { direction: context.crt.selectedBias.direction, source: "bias" };
  }
  return { direction: context.premiumDiscount.zone === "premium" ? "short" : "long", source: "pd" };
}

function expectedPd(direction: TradeDirection) {
  return direction === "short" ? "premium" : "discount";
}

function expectedSweepSide(direction: TradeDirection) {
  return direction === "short" ? "buy-side" : "sell-side";
}

function latestByIndex<T extends { candleIndex: number }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.candleIndex - a.candleIndex)[0];
}

function reclaimSweepFromCandles(context: MarketContext, direction: TradeDirection): CrtSetup["manipulation"] {
  const candles = executionCandles(context);
  const expectedSide = expectedSweepSide(direction);
  const freshnessStart = Math.max(0, candles.length - SWEEP_FRESHNESS_CANDLES);
  const rangeLevel = direction === "short" ? context.crt.activeRange.high : context.crt.activeRange.low;
  const rangeSweep = candles
    .map((candle, candleIndex) => ({ candle, candleIndex }))
    .filter(({ candleIndex }) => candleIndex >= freshnessStart)
    .filter(({ candle }) => direction === "short"
      ? candle.high > rangeLevel && candle.close < rangeLevel
      : candle.low < rangeLevel && candle.close > rangeLevel)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  if (rangeSweep) {
    return {
      side: expectedSide,
      level: direction === "short" ? rangeSweep.candle.high : rangeSweep.candle.low,
      candleIndex: rangeSweep.candleIndex,
      reclaimed: true
    };
  }

  const swingSide = direction === "short" ? "high" : "low";
  const swingSweeps = context.swingPoints
    .filter((point) => point.side === swingSide)
    .flatMap((point) => candles
      .map((candle, candleIndex) => ({ point, candle, candleIndex }))
      .filter(({ candleIndex }) => candleIndex > point.candleIndex && candleIndex >= freshnessStart)
      .filter(({ candle }) => direction === "short"
        ? candle.high > point.level && candle.close < point.level
        : candle.low < point.level && candle.close > point.level)
      .map(({ point, candle, candleIndex }) => ({
        side: expectedSide as "buy-side" | "sell-side",
        level: direction === "short" ? candle.high : candle.low,
        candleIndex,
        reclaimed: true,
        distance: Math.abs(candleIndex - point.candleIndex)
      })));

  const fallback = swingSweeps
    .sort((a, b) => b.candleIndex - a.candleIndex || a.distance - b.distance)[0];
  return fallback
    ? { side: fallback.side, level: fallback.level, candleIndex: fallback.candleIndex, reclaimed: fallback.reclaimed }
    : undefined;
}

function symbolBuffer(context: MarketContext): number {
  return Math.max(context.volatility.atr * 0.2, context.volatility.averageRange * 0.15, SYMBOL_MIN_BUFFER[context.symbol]);
}

function priceTouchesPoi(candles: Candle[], poi: CrtPoi): boolean {
  const start = typeof poi.candleIndex === "number" ? Math.max(0, poi.candleIndex) : Math.max(0, candles.length - 24);
  return candles.slice(start).some((candle) => candle.low <= poi.high && candle.high >= poi.low);
}

function selectPoi(context: MarketContext, direction: TradeDirection): CrtPoi | undefined {
  const candles = executionCandles(context);
  const priority: Record<CrtPoi["type"], number> = { fvg: 0, ob: 1, breaker: 2, ote: 3 };
  return context.crt.pois
    .filter((poi) => poi.direction === direction)
    .filter((poi) => priceTouchesPoi(candles, poi))
    .sort((a, b) => priority[a.type] - priority[b.type] || (b.candleIndex ?? 0) - (a.candleIndex ?? 0))[0];
}

function manipulationSweep(context: MarketContext, direction: TradeDirection): CrtSetup["manipulation"] {
  // The true CRT manipulation is the sweep of the range candle's extreme; minor liquidity-pool
  // sweeps are a fallback only — their wick can sit anywhere and break the stop geometry.
  const freshnessStart = Math.max(0, executionCandles(context).length - SWEEP_FRESHNESS_CANDLES);
  return rangeExtremeSweep(context, direction)
    ?? latestByIndex(context.sweeps.filter((sweep) => sweep.side === expectedSweepSide(direction) && sweep.reclaimed && sweep.candleIndex >= freshnessStart))
    ?? reclaimSweepFromCandles(context, direction);
}

function chochConfirmation(context: MarketContext, direction: TradeDirection, manipulation?: CrtSetup["manipulation"]): CrtSetup["choch"] {
  const candles = executionCandles(context);
  const startIndex = manipulation?.candleIndex ?? Math.max(0, candles.length - 12);
  const swingSide = direction === "short" ? "low" : "high";
  const swing = [...context.swingPoints]
    .filter((point) => point.side === swingSide && point.candleIndex < startIndex)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0];
  const fallbackShift = latestByIndex(context.marketStructureShifts.filter((shift) => shift.direction === direction && shift.candleIndex >= startIndex));
  const level = swing?.level ?? fallbackShift?.level;
  if (typeof level !== "number") return undefined;
  const confirmIndex = candles.findIndex((candle, index) => {
    if (index <= startIndex) return false;
    return direction === "short" ? candle.close < level : candle.close > level;
  });
  if (confirmIndex < 0) return undefined;
  if (confirmIndex < candles.length - CHOCH_FRESHNESS_CANDLES) return undefined;
  return { level, candleIndex: confirmIndex };
}

function targetDol(context: MarketContext, direction: TradeDirection, entry: number): number | undefined {
  // CRT distribution target: the opposite side of the range candle. The HTF DOL only extends the
  // target when it sits beyond the range extreme. Never fabricate a synthetic entry±2R target —
  // a setup without a real draw has no trade.
  const rangeTarget = direction === "short" ? context.crt.activeRange.low : context.crt.activeRange.high;
  const rangeIsUseful = direction === "short" ? rangeTarget < entry : rangeTarget > entry;
  if (rangeIsUseful) return rangeTarget;
  const dol = context.crt.selectedBias.drawLevel;
  const dolIsUseful = direction === "short" ? dol < entry : dol > entry;
  if (dolIsUseful) return dol;
  return undefined;
}

function executionCostStress(settings: StrategyInput["settings"]): ExecutionCostStress {
  if (settings.useExecutionCosts === false) return "off";
  return settings.slippageStress === "high" ? "high" : "normal";
}

function buildCrtPlan(context: MarketContext, direction: TradeDirection, manipulation: CrtSetup["manipulation"], choch: CrtSetup["choch"], poi: CrtPoi | undefined, minimumRR: number, stress: ExecutionCostStress): TradePlan {
  const candles = executionCandles(context);
  const latest = candles[candles.length - 1];
  const buffer = symbolBuffer(context);
  // Entry is the retest after confirmation, never the displaced ChoCH close: chasing the
  // displacement leaves no room to the distribution target and destroys RR.
  const insideRange = (level: number) => level <= context.crt.activeRange.high && level >= context.crt.activeRange.low;
  const retestLevel = choch
    ? (poi && insideRange(poi.midpoint) && (direction === "short" ? poi.midpoint > choch.level : poi.midpoint < choch.level) ? poi.midpoint : choch.level)
    : undefined;
  const entry = retestLevel ?? poi?.midpoint ?? latest.close;
  // Stop must sit on the loss side of the entry: a pool-sweep wick can be anywhere, and a
  // "long" with the stop above the entry is not a plan, it is a rendering of a bug.
  const manipulationStop = manipulation
    ? direction === "short" ? manipulation.level + buffer : manipulation.level - buffer
    : undefined;
  const manipulationStopValid = typeof manipulationStop === "number"
    && (direction === "short" ? manipulationStop > entry : manipulationStop < entry);
  const stopSource: StopSource = manipulationStopValid ? "manipulation" : "swing";
  const stopLoss = manipulationStopValid && typeof manipulationStop === "number"
    ? manipulationStop
    : direction === "short" ? context.crt.activeRange.high + buffer : context.crt.activeRange.low - buffer;
  const riskDistance = Math.max(Math.abs(entry - stopLoss), 0.000001);
  const tp1 = context.crt.activeRange.midpoint;
  const realTarget = targetDol(context, direction, entry);
  const tp2 = realTarget ?? tp1;
  const costs = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp2, stress });
  const entryStatus = choch ? "confirmed" : poi ? "pending" : "fallback";
  const entrySource = choch ? "choch-close" : poi ? "poi-retest" : "fallback-close";
  const planWarnings = [
    `CRT range minimum ${context.crt.rangeTimeframe}; aktif range ${formatPrice(context.crt.activeRange.low)}-${formatPrice(context.crt.activeRange.high)}.`,
    `TP1/EQ yönetim seviyesi ${formatPrice(tp1)}; TP2/DOL ${formatPrice(tp2)}.`,
    `Stop manipulation wick dışına ${formatPrice(buffer)} buffer ile kondu.`,
    ...(costs.netRR < minimumRR ? [`TP2/DOL net RR ${costs.netRR.toFixed(2)}, minimum ${minimumRR}. READY değil.`] : []),
    ...(entryStatus !== "confirmed" ? ["ChoCH/Just mum kapanışı bekleniyor."] : [])
  ];

  return {
    entry,
    entrySource,
    entryStatus,
    entryModel: {
      source: entrySource,
      status: entryStatus,
      level: entry,
      retested: Boolean(poi),
      cisdConfirmed: Boolean(choch),
      fairValueGap: poi?.type === "fvg" || poi?.type === "breaker"
        ? {
            direction: poi.direction,
            low: poi.low,
            high: poi.high,
            midpoint: poi.midpoint,
            candleIndex: poi.candleIndex ?? 0,
            mitigated: poi.mitigated
          }
        : undefined,
      warnings: entryStatus === "confirmed" ? [] : ["POI teması sonrası ChoCH/Just kapanışı bekleniyor."]
    },
    stopLoss,
    targets: [tp1, tp2],
    invalidation: stopLoss,
    rr: costs.netRR,
    grossRR: costs.grossRR,
    riskDistance,
    stopSource,
    stopBuffer: buffer,
    targetSource: "crt-dol",
    executionCosts: costs,
    planWarnings
  };
}

function buildCrtSetup(context: MarketContext, settings: StrategyInput["settings"]): CrtSetup {
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const { direction, source: directionSource } = directionFromContext(context);
  const biasDirection = context.crt.selectedBias.direction;
  const biasConflict = directionSource === "sweep" && biasDirection !== "neutral" && biasDirection !== direction;
  const manipulation = manipulationSweep(context, direction);
  const choch = chochConfirmation(context, direction, manipulation);
  const poi = selectPoi(context, direction);
  const plan = buildCrtPlan(context, direction, manipulation, choch, poi, minimumRR, executionCostStress(settings));
  // CRT premium/discount is measured on the planned entry level against the range candle itself:
  // the retest limit can sit in premium while the current price already returned to EQ.
  const crtZone = plan.entry >= context.crt.activeRange.midpoint ? "premium" : "discount";
  const pdAligned = crtZone === expectedPd(direction);
  const smtAligned = context.smtDivergences.some((item) => item.direction === direction);
  const inSession = isCryptoSymbol(context.symbol) || context.killzones.some((zone) => zone.active && zone.name !== "Outside");
  const tp1Valid = direction === "short" ? plan.targets[0] < plan.entry : plan.targets[0] > plan.entry;
  const stopValid = direction === "short" ? plan.stopLoss > plan.entry : plan.stopLoss < plan.entry;
  const hasRealTarget = typeof targetDol(context, direction, plan.entry) === "number";
  // A range candle smaller than the average 4H range is noise, not a CRT range; and a stop
  // inside the m15 noise band turns every entry into a coin flip regardless of gross RR.
  const h4Candles = context.timeframes.h4.slice(-20);
  const h4AverageRange = h4Candles.length
    ? h4Candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / h4Candles.length
    : 0;
  const rangeHeight = context.crt.activeRange.high - context.crt.activeRange.low;
  const rangeTooSmall = h4AverageRange > 0 && rangeHeight < h4AverageRange * 0.6;
  const stopInNoise = plan.riskDistance < context.volatility.atr * 0.6;
  // Check both the CRT candle biases and the swing-structure biases: a reversal against a
  // daily AND 4H structural trend is fading strength, not trading manipulation.
  const opposite: TradeDirection = direction === "short" ? "long" : "short";
  const oppositeStructure = direction === "short" ? "bullish" : "bearish";
  const crtDaily = context.crt.macroBiases.find((bias) => bias.timeframe === "1d")?.direction;
  const crtH4 = context.crt.macroBiases.find((bias) => bias.timeframe === "4h")?.direction;
  const fullHtfConflict = (crtDaily === opposite && crtH4 === opposite)
    || (context.bias.daily === oppositeStructure && context.bias.h4 === oppositeStructure);
  const blockers = [
    directionSource === "pd" ? "Range extreme sweep yok ve HTF bias neutral; trade yönü net değil." : undefined,
    !context.crt.validPullback ? context.crt.pullbackSummary : undefined,
    !pdAligned ? `${direction.toUpperCase()} için CRT range ${expectedPd(direction)} gerekir; şu an ${crtZone}.` : undefined,
    !poi ? "POI teması yok: FVG, OB, Breaker veya OTE bekleniyor." : undefined,
    !manipulation ? "Manipulation sweep + reclaim yok." : undefined,
    !choch ? "ChoCH/Just mum kapanışı yok." : undefined,
    !hasRealTarget ? "Gerçek distribution/DOL hedefi yok; entry range'in ötesine taşmış." : undefined,
    rangeTooSmall ? "CRT range mumu ortalama 4H range'in altında; küçük range gürültüdür, trade edilmez." : undefined,
    stopInNoise ? "Stop mesafesi m15 gürültü bandının içinde; RR görünüşte iyi ama stop korunmasız." : undefined,
    fullHtfConflict ? "Daily ve 4H bias birlikte ters yönde; tam HTF conflict'te reversal alınmaz." : undefined,
    !tp1Valid ? "Entry range EQ seviyesini geçmiş; TP1 hedefi girişin gerisinde, kovalama riski." : undefined,
    !stopValid ? "Stop entry'nin yanlış tarafında; plan geometrisi bozuk, trade edilemez." : undefined,
    !inSession ? "Killzone dışı; CRT zamanlama stratejisidir, FX/endeks için session hard gate." : undefined,
    plan.rr < minimumRR ? `TP2/DOL RR minimumun altında (${plan.rr.toFixed(2)} < ${minimumRR}).` : undefined,
    context.regime.tradeability === "blocked" ? `Rejim uygun değil: ${context.regime.summary}` : undefined,
    context.regime.type === "trend" && biasConflict ? "Trend rejiminde counter-bias reversal alınmaz; sweep devam hareketine dönüşür." : undefined,
    context.eventRisk.noTrade && settings.avoidNews !== false ? context.eventRisk.summary : undefined,
    context.dataConfidence.score < 35 ? context.dataConfidence.summary : undefined
  ].filter((item): item is string => Boolean(item));
  const warnings = [
    biasConflict ? "HTF bias sweep yönünün tersinde; counter-bias reversal, boyutu küçük tut." : undefined,
    context.regime.tradeability === "caution" ? context.regime.summary : undefined,
    !smtAligned ? "SMT yok; hard şart değil, sadece kalite notu." : undefined,
    ...plan.planWarnings
  ].filter((item): item is string => Boolean(item));
  const score = Math.max(0, Math.min(100,
    18
    + (directionSource === "sweep" ? (biasConflict ? 12 : 18) : directionSource === "bias" ? 10 : 0)
    + (context.crt.validPullback ? 10 : 0)
    + (pdAligned ? 12 : 0)
    + (poi ? 12 : 0)
    + (manipulation ? 16 : 0)
    + (choch ? 16 : 0)
    + (plan.rr >= minimumRR ? 10 : 0)
    + (smtAligned ? 4 : 0)
    + (inSession ? 2 : 0)
    + Math.min(6, Math.max(0, (context.dataConfidence.score - 50) / 10))
  ));
  // A setup with open blockers is not A-grade material no matter how many boxes it ticks.
  const cappedScore = blockers.length ? Math.min(score, 72) : score;
  return { direction, manipulation, choch, poi, plan: { ...plan, planWarnings: Array.from(new Set(warnings)) }, warnings, blockers, score: cappedScore };
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 90) return "A+";
  if (score >= 78) return "A";
  if (score >= 64) return "B";
  if (score >= 48) return "C";
  return "D";
}

function crtChecklist(context: MarketContext, setup: CrtSetup) {
  const direction = setup.direction;
  const crtZone = setup.plan.entry >= context.crt.activeRange.midpoint ? "premium" : "discount";
  const pdAligned = crtZone === expectedPd(direction);
  const smtAligned = context.smtDivergences.some((item) => item.direction === direction);
  return [
    checklistItem("CRT Bias / DOL", context.crt.selectedBias.direction === direction ? "pass" : "fail", context.crt.selectedBias.summary),
    checklistItem("4H+ Range", context.crt.rangeTimeframe === "4h" || context.crt.rangeTimeframe === "1d" ? "pass" : "fail", context.crt.activeRange.source),
    checklistItem("Valid Pullback", context.crt.validPullback ? "pass" : "neutral", context.crt.pullbackSummary),
    checklistItem("Premium / Discount", pdAligned ? "pass" : "fail", `${direction.toUpperCase()} için CRT range ${expectedPd(direction)}; price ${crtZone}.`),
    checklistItem("POI Touch", setup.poi ? "pass" : "fail", setup.poi ? `${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)}.` : "FVG/OB/Breaker/OTE teması yok."),
    checklistItem("Manipulation", setup.manipulation ? "pass" : "fail", setup.manipulation ? `${setup.manipulation.side} sweep ${formatPrice(setup.manipulation.level)}.` : "Sweep + reclaim bekleniyor."),
    checklistItem("ChoCH / Just", setup.choch ? "pass" : "fail", setup.choch ? `Mum kapanışı ${formatPrice(setup.choch.level)} seviyesini kırdı.` : "Manipulation start level kapanışla kırılmalı."),
    checklistItem("SMT", smtAligned ? "pass" : "neutral", smtAligned ? "SMT kalite teyidi var." : "SMT hard şart değil."),
    checklistItem("RR to DOL", setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "fail", `TP2/DOL net RR ${formatR(setup.plan.rr)}.`),
    checklistItem("Data", context.dataConfidence.score >= 68 ? "pass" : context.dataConfidence.score >= 35 ? "neutral" : "fail", context.dataConfidence.summary)
  ];
}

function crtDecisionSummary(context: MarketContext, setup: CrtSetup, grade: QualityGrade, riskWarnings: string[]): DecisionSummary {
  const checklist = crtChecklist(context, setup);
  const side = setup.direction === "short" ? "Bearish" : "Bullish";
  const fullReasoning = [
    `${context.symbol} ${side} CRT setup.`,
    context.crt.selectedBias.summary,
    `Aktif CRT range ${formatPrice(context.crt.activeRange.low)}-${formatPrice(context.crt.activeRange.high)}, EQ ${formatPrice(context.crt.activeRange.midpoint)}.`,
    setup.poi ? `POI: ${setup.poi.label} ${formatPrice(setup.poi.low)}-${formatPrice(setup.poi.high)}.` : "POI bekleniyor.",
    setup.manipulation ? `Manipulation: ${setup.manipulation.side} ${formatPrice(setup.manipulation.level)} sweep.` : "Manipulation bekleniyor.",
    setup.choch ? `ChoCH/Just close ${formatPrice(setup.choch.level)} kırdı.` : "ChoCH/Just kapanışı bekleniyor.",
    `Entry ${formatPrice(setup.plan.entry)}, SL ${formatPrice(setup.plan.stopLoss)}, EQ/TP1 ${formatPrice(setup.plan.targets[0])}, DOL/TP2 ${formatPrice(setup.plan.targets[1])}.`,
    `Grade ${grade}, net RR ${formatR(setup.plan.rr)}.`,
    ...riskWarnings
  ].join(" ");
  return {
    shortSummary: `${context.symbol} ${setup.direction.toUpperCase()} CRT ${setup.plan.entryStatus === "confirmed" ? "plan" : "watch"} · RR ${formatR(setup.plan.rr)}.`,
    fullReasoning,
    checklist,
    warnings: Array.from(new Set([...setup.warnings, ...riskWarnings])).slice(0, 8),
    invalidation: [`${formatPrice(setup.plan.stopLoss)} stop/invalidation görülürse CRT setup geçersiz olur.`],
    confidence: Math.max(0, Math.min(100, setup.score - setup.blockers.length * 8))
  };
}

function governanceFor(context: MarketContext, setup: CrtSetup): SignalGovernance {
  const status: SignalGovernance["status"] = setup.blockers.length ? "caution" : "allow";
  return {
    status,
    scoreImpact: setup.blockers.length ? -12 : 6,
    blockers: setup.blockers,
    warnings: setup.warnings,
    checklist: crtChecklist(context, setup),
    summary: setup.blockers[0] ?? "CRT SOP tamam: bias, POI, manipulation, ChoCH ve DOL planı okunabilir."
  };
}

function lifecycle(context: MarketContext, setup: CrtSetup, readyCandidate: boolean): { stage: TradingSignal["stage"]; outcome: SignalOutcome; actionWindow: SignalActionWindow } {
  const startIndex = setup.manipulation?.candleIndex ?? Math.max(0, executionCandles(context).length - 1);
  const outcome = evaluateSignalOutcome(context, setup.direction, setup.plan, startIndex);
  // Only a confirmed entry can be stopped out or missed; a hypothetical fallback entry running
  // through history must not kill a setup that is still waiting for its ChoCH confirmation.
  if (setup.plan.entryStatus === "confirmed") {
    if (outcome.status === "stopped") {
      return { stage: "invalidated", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "invalidated") };
    }
    if (outcome.status === "tp1" || outcome.status === "tp2" || outcome.status === "missed") {
      return { stage: "missed", outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, "missed") };
    }
  }
  const stage = readyCandidate ? "ready" : "watch";
  return { stage, outcome, actionWindow: buildActionWindow(context, setup.plan, outcome, stage) };
}

function evidenceFor(context: MarketContext, setup: CrtSetup): SignalEvidenceItem[] {
  return [
    { id: "crt-bias", label: "CRT Bias / DOL", status: context.crt.selectedBias.direction === setup.direction ? "pass" : "fail", detail: context.crt.selectedBias.summary, timeframe: context.crt.selectedBias.timeframe, price: context.crt.selectedBias.drawLevel },
    { id: "crt-range", label: "4H+ Candle Range", status: "pass", detail: `${context.crt.rangeTimeframe} range high/low/mid used.`, timeframe: context.crt.rangeTimeframe, price: context.crt.activeRange.midpoint },
    { id: "valid-pullback", label: "Valid Pullback", status: context.crt.validPullback ? "pass" : "neutral", detail: context.crt.pullbackSummary, timeframe: context.crt.rangeTimeframe },
    { id: "poi", label: "POI", status: setup.poi ? "pass" : "fail", detail: setup.poi ? `${setup.poi.label} touched.` : "FVG/OB/Breaker/OTE touch bekleniyor.", timeframe: "15m", candleIndex: setup.poi?.candleIndex, price: setup.poi?.midpoint },
    { id: "manipulation", label: "Manipulation", status: setup.manipulation ? "pass" : "fail", detail: setup.manipulation ? `${setup.manipulation.side} sweep + reclaim.` : "Sweep + reclaim yok.", timeframe: "15m", candleIndex: setup.manipulation?.candleIndex, price: setup.manipulation?.level },
    { id: "choch", label: "ChoCH / Just", status: setup.choch ? "pass" : "fail", detail: setup.choch ? `Close broke manipulation start ${formatPrice(setup.choch.level)}.` : "Manipulation start level kapanışla kırılmadı.", timeframe: "15m", candleIndex: setup.choch?.candleIndex, price: setup.choch?.level },
    { id: "eq-management", label: "EQ / TP1", status: "neutral", detail: `0.5 range management: ${formatPrice(setup.plan.targets[0])}.`, timeframe: context.crt.rangeTimeframe, price: setup.plan.targets[0] },
    { id: "dol-target", label: "DOL / TP2", status: setup.plan.rr >= DEFAULT_MINIMUM_RR ? "pass" : "warning", detail: `Final DOL target ${formatPrice(setup.plan.targets[1])}, RR ${formatR(setup.plan.rr)}.`, timeframe: context.crt.selectedBias.timeframe, price: setup.plan.targets[1] }
  ];
}

function signalFromContext(context: MarketContext, settings: StrategyInput["settings"]): TradingSignal {
  const setup = buildCrtSetup(context, settings);
  const minimumRR = typeof settings.minimumRR === "number" ? settings.minimumRR : DEFAULT_MINIMUM_RR;
  const readyCandidate = setup.blockers.length === 0 && setup.plan.entryStatus === "confirmed" && setup.plan.rr >= minimumRR;
  const life = lifecycle(context, setup, readyCandidate);
  const grade = gradeFromScore(setup.score);
  const position = calculatePositionSize({
    account: defaultAccountModel,
    symbol: context.symbol,
    entry: setup.plan.entry,
    stopLoss: setup.plan.stopLoss,
    target: setup.plan.targets[1] ?? setup.plan.targets[0]
  });
  return {
    id: `${context.symbol}-${setup.direction}-${executionCandles(context).at(-1)?.time ?? Date.now()}-crt`,
    strategyId: CRT_STRATEGY_ID,
    symbol: context.symbol,
    direction: setup.direction,
    stage: life.stage,
    grade,
    score: setup.score,
    createdAt: Date.now(),
    timeframe: "15m",
    plan: setup.plan,
    context,
    decisionSummary: crtDecisionSummary(context, setup, grade, position.warnings),
    evidence: evidenceFor(context, setup),
    riskWarnings: position.warnings,
    outcome: life.outcome,
    governance: governanceFor(context, setup),
    actionWindow: life.actionWindow
  };
}

export const crtStrategy: StrategyModule = {
  id: CRT_STRATEGY_ID,
  name: "CRT Candle Range",
  description: "Candle Range Theory: 4H+ range, HTF DOL, POI, manipulation, ChoCH and EQ/DOL risk plan.",
  requiredTimeframes: ["1M", "1w", "1d", "4h", "1h", "15m"],
  defaultSettings: {
    minimumRR: 1.5,
    mode: "watch_ready",
    useExecutionCosts: true,
    slippageStress: "normal",
    noAutoExecution: true
  },
  scan(input: StrategyInput): StrategyResult {
    const signal = signalFromContext(input.context, input.settings);
    return {
      signals: [signal],
      rejectedSetups: signal.stage === "ready"
        ? []
        : [{ symbol: input.context.symbol, strategyId: this.id, reason: signal.governance.blockers[0] ?? signal.plan.planWarnings[0] ?? "CRT confirmation bekleniyor.", score: signal.score }]
    };
  },
  backtest(input: BacktestInput) {
    return performanceFromSignals(input.contexts.map((context) => signalFromContext(context, input.settings)));
  }
};
