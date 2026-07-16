import type { Candle, MarketContext, MarketSymbol, QualityGrade, TradeDirection } from "../../ict/types";
import { buildSilverBulletReferenceRange, nyHourToUtc, nyTradingDayId } from "./referenceRange";
import {
  SB_DEFAULT_CONFIG,
  SB_DETECTOR_VERSION,
  SB_SETUP_FAMILY,
  SB_STRATEGY_PROFILE,
  type SbEvent,
  type SbLifecycle,
  type SbScoreBreakdown,
  type SilverBulletConfig,
  type SilverBulletLog,
  type SilverBulletReferenceRange,
  type SilverBulletSetup
} from "./types";

// NY_AM_09_HOURLY_RANGE_REVERSAL_V1 — deterministic Silver Bullet window engine.
// Master §9-§24: sweep → failure to accept → reclaim → displacement → MSS/CISD → FVG entry
// filled before 11:00 → stop at sweep extreme + buffer → opposite-range target → score.
// Everything is computed from candles ≤ now; the locked reference is never repainted.

type WindowRead = {
  sweep?: SilverBulletSetup["sweep"];
  bothSides: boolean;
  acceptedOutside: boolean;
  displacement?: SilverBulletSetup["displacement"];
  displacementIndex?: number;
  mss?: SilverBulletSetup["mss"];
  cisd?: SilverBulletSetup["cisd"];
  entryArray?: SilverBulletSetup["entryArray"];
  plan?: SilverBulletSetup["plan"];
  outcome?: "tp1" | "tp2" | "stopped";
};

function bodyToRange(candle: Candle): number {
  const range = Math.max(candle.high - candle.low, 1e-9);
  return Math.abs(candle.close - candle.open) / range;
}

// CISD (explicit project definition, Master §14): the delivery series INTO the sweep extreme is
// the consecutive same-direction candle run ending at the sweep candle; its origin candle's OPEN
// is the CISD level. A close through that level against the delivery confirms the CISD.
function cisdLevel(windowCandles: Candle[], sweepIndex: number, direction: TradeDirection): number | undefined {
  let origin = sweepIndex;
  while (origin - 1 >= 0) {
    const candle = windowCandles[origin - 1];
    const deliversIntoSweep = direction === "short" ? candle.close >= candle.open : candle.close <= candle.open;
    if (!deliversIntoSweep) break;
    origin -= 1;
  }
  return windowCandles[origin]?.open;
}

function detectWindow(reference: SilverBulletReferenceRange, windowCandles: Candle[], atr: number, config: SilverBulletConfig, windowEndUtc: number): WindowRead {
  const read: WindowRead = { bothSides: false, acceptedOutside: false };
  // Both-sides / target-already-delivered gate (Master §21-§22): a second-side sweep BEFORE the
  // entry fills rejects the reversal — the opposite extreme IS the target. Applied on every exit
  // path so partial sequences (no displacement/array yet) reject too.
  let secondSweepTime = -1;
  const finish = (): WindowRead => {
    if (secondSweepTime >= 0 && (!read.plan?.entryFilledUtc || secondSweepTime < read.plan.entryFilledUtc)) {
      read.bothSides = true;
    }
    return read;
  };
  let sweepSide: "HIGH" | "LOW" | undefined;
  let sweepIndex = -1;
  let extreme = 0;
  let closesOutside = 0;
  let reclaimIndex = -1;

  for (let index = 0; index < windowCandles.length; index += 1) {
    const candle = windowCandles[index];
    if (!sweepSide) {
      const tookHigh = candle.high > reference.high;
      const tookLow = candle.low < reference.low;
      if (tookHigh && tookLow) { read.bothSides = true; return finish(); }
      if (tookHigh) { sweepSide = "HIGH"; sweepIndex = index; extreme = candle.high; }
      else if (tookLow) { sweepSide = "LOW"; sweepIndex = index; extreme = candle.low; }
      if (!sweepSide) continue;
    }
    if (sweepSide === "HIGH") {
      if (secondSweepTime < 0 && candle.low < reference.low) secondSweepTime = candle.time;
      extreme = Math.max(extreme, candle.high);
      if (reclaimIndex < 0) {
        if (candle.close > reference.high) closesOutside += 1;
        else if (candle.close <= reference.high) reclaimIndex = index;
      }
    } else {
      if (secondSweepTime < 0 && candle.high > reference.high) secondSweepTime = candle.time;
      extreme = Math.min(extreme, candle.low);
      if (reclaimIndex < 0) {
        if (candle.close < reference.low) closesOutside += 1;
        else if (candle.close >= reference.low) reclaimIndex = index;
      }
    }
    if (reclaimIndex < 0 && closesOutside >= config.acceptanceClosesOutside) {
      read.acceptedOutside = true;
    }
  }
  if (!sweepSide || sweepIndex < 0) return finish();

  const direction: TradeDirection = sweepSide === "HIGH" ? "short" : "long";
  const level = sweepSide === "HIGH" ? reference.high : reference.low;
  const penetration = Math.abs(extreme - level);
  read.sweep = {
    side: sweepSide,
    extremePrice: extreme,
    timestampUtc: windowCandles[sweepIndex].time,
    penetration,
    penetrationAtrRatio: atr > 0 ? penetration / atr : 0,
    closesOutside,
    reclaimed: reclaimIndex >= 0,
    reclaimTimestampUtc: reclaimIndex >= 0 ? windowCandles[reclaimIndex].time : undefined
  };
  if (read.acceptedOutside || reclaimIndex < 0) return finish();

  // Displacement after (or at) the reclaim, against the sweep.
  for (let index = reclaimIndex; index < windowCandles.length; index += 1) {
    const candle = windowCandles[index];
    const directional = direction === "short" ? candle.close < candle.open : candle.close > candle.open;
    const ratio = bodyToRange(candle);
    const bodyAtr = atr > 0 ? Math.abs(candle.close - candle.open) / atr : 0;
    if (directional && ratio >= config.displacementBodyToRangeMin && bodyAtr >= config.displacementBodyToAtrMin) {
      read.displacement = { timestampUtc: candle.time, bodyToRange: Number(ratio.toFixed(2)), bodyToAtr: Number(bodyAtr.toFixed(2)), fvgCreated: false };
      read.displacementIndex = index;
      break;
    }
  }
  if (read.displacementIndex === undefined) return finish();

  // MSS: the confirmed counter-structure pivot between sweep and displacement, broken by close.
  // (bearish: pivot LOW with one-bar wings; confirmed only after its right wing exists.)
  for (let pivot = sweepIndex + 1; pivot < read.displacementIndex; pivot += 1) {
    const previous = windowCandles[pivot - 1];
    const candle = windowCandles[pivot];
    const next = windowCandles[pivot + 1];
    if (!previous || !next) continue;
    const isPivot = direction === "short"
      ? candle.low < previous.low && candle.low <= next.low
      : candle.high > previous.high && candle.high >= next.high;
    if (!isPivot) continue;
    const pivotLevel = direction === "short" ? candle.low : candle.high;
    for (let breaker = read.displacementIndex; breaker < windowCandles.length; breaker += 1) {
      const closeThrough = direction === "short" ? windowCandles[breaker].close < pivotLevel : windowCandles[breaker].close > pivotLevel;
      if (closeThrough) {
        read.mss = {
          levelPrice: pivotLevel,
          levelTimestampUtc: candle.time,
          breakTimestampUtc: windowCandles[breaker].time,
          confirmationTimestampUtc: windowCandles[breaker].time
        };
        break;
      }
    }
    if (read.mss) break;
  }

  // CISD fallback/confluence.
  const level2 = cisdLevel(windowCandles, sweepIndex, direction);
  if (typeof level2 === "number") {
    for (let index = read.displacementIndex; index < windowCandles.length; index += 1) {
      const closeThrough = direction === "short" ? windowCandles[index].close < level2 : windowCandles[index].close > level2;
      if (closeThrough) {
        read.cisd = { levelPrice: level2, confirmationTimestampUtc: windowCandles[index].time };
        break;
      }
    }
  }
  if (!read.mss && !read.cisd) return finish();

  // Entry array: the FVG left by the confirmation displacement (three-bar imbalance).
  const displacementIndex = read.displacementIndex;
  for (let index = Math.max(1, displacementIndex - 1); index < windowCandles.length - 1; index += 1) {
    const first = windowCandles[index - 1];
    const third = windowCandles[index + 1];
    const gapTop = direction === "short" ? first.low : third.low;
    const gapBottom = direction === "short" ? third.high : first.high;
    const isGap = direction === "short" ? first.low > third.high : first.high < third.low;
    if (!isGap) continue;
    const size = Math.abs(gapTop - gapBottom);
    if (atr > 0 && size < atr * config.fvgMinAtrRatio) continue;
    read.entryArray = {
      type: "FVG",
      top: Math.max(gapTop, gapBottom),
      bottom: Math.min(gapTop, gapBottom),
      createdAtUtc: windowCandles[index + 1].time
    };
    if (read.displacement) read.displacement.fvgCreated = true;
    break;
  }
  if (!read.entryArray || !read.sweep) return finish();

  // Trade plan: entry at the FVG consequent encroachment, stop at the sweep extreme + buffer,
  // targets = reference midpoint then the opposite extreme. Entry must FILL inside the window.
  const entry = (read.entryArray.top + read.entryArray.bottom) / 2;
  const buffer = atr * config.stopBufferAtr;
  const stopLoss = direction === "short" ? read.sweep.extremePrice + buffer : read.sweep.extremePrice - buffer;
  const targets = direction === "short" ? [reference.midpoint, reference.low] : [reference.midpoint, reference.high];
  const risk = Math.max(Math.abs(entry - stopLoss), 1e-9);
  const plannedRR = Number((Math.abs(targets[1] - entry) / risk).toFixed(2));
  let entryFilledUtc: number | undefined;
  for (let index = windowCandles.findIndex((candle) => candle.time > read.entryArray!.createdAtUtc); index >= 0 && index < windowCandles.length; index += 1) {
    const candle = windowCandles[index];
    const touches = direction === "short" ? candle.high >= entry : candle.low <= entry;
    if (touches && candle.time < windowEndUtc) { entryFilledUtc = candle.time; break; }
  }
  read.plan = {
    entry,
    stopLoss,
    rawSweepExtreme: read.sweep.extremePrice,
    stopBuffer: buffer,
    targets,
    plannedRR,
    entryFilledUtc,
    remainingSecondsAtEntry: entryFilledUtc ? Math.max(0, Math.round((windowEndUtc - entryFilledUtc) / 1000)) : undefined
  };

  if (entryFilledUtc) {
    for (const candle of windowCandles.filter((item) => item.time >= entryFilledUtc!)) {
      const stopHit = direction === "short" ? candle.high >= stopLoss : candle.low <= stopLoss;
      const tp2Hit = direction === "short" ? candle.low <= targets[1] : candle.high >= targets[1];
      const tp1Hit = direction === "short" ? candle.low <= targets[0] : candle.high >= targets[0];
      if (stopHit) { read.outcome = "stopped"; break; }
      if (tp2Hit) { read.outcome = "tp2"; break; }
      if (tp1Hit) read.outcome = "tp1";
    }
  }
  return finish();
}

function gradeFor(score: number): QualityGrade | "reject" {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "reject";
}

export function evaluateSilverBullet(input: {
  context: MarketContext;
  now?: number;
  config?: Partial<SilverBulletConfig>;
}): SilverBulletSetup | undefined {
  const config = { ...SB_DEFAULT_CONFIG, ...input.config };
  const context = input.context;
  const symbol = context.symbol as MarketSymbol;
  if (config.enabledSymbols !== "all" && !config.enabledSymbols.includes(symbol)) return undefined;
  const candles = context.timeframes.m5.length >= 60 ? context.timeframes.m5 : context.timeframes.m15;
  const now = input.now ?? candles.at(-1)?.time ?? Date.now();
  const reference = buildSilverBulletReferenceRange({ symbol, candles, now });
  if (!reference) return undefined;

  const windowStartUtc = reference.endUtc;
  const windowEndUtc = nyHourToUtc(reference.startUtc, 11);
  const windowCandles = candles.filter((candle) => candle.time >= windowStartUtc && candle.time < windowEndUtc && candle.time <= now);
  const windowOver = now >= windowEndUtc;

  const events: SbEvent[] = [];
  const warnings: string[] = [];
  const noTradeReasons: string[] = [];
  const invalidationReasons: string[] = [];
  let lifecycle: SbLifecycle;
  let direction: TradeDirection | "none" = "none";

  events.push({
    id: `${reference.referenceRangeId}:reference`,
    kind: "reference",
    status: reference.isComplete ? "pass" : reference.dataQuality === "valid" ? "pending" : "fail",
    label: "09:00 Reference Range",
    detail: `09:00-10:00 NY ${reference.low.toFixed(4)}-${reference.high.toFixed(4)} (${reference.quality}, ${reference.barCount} bar, ${reference.dataQuality}).`,
    timestampUtc: reference.startUtc,
    price: reference.midpoint
  });

  if (now < windowStartUtc) {
    lifecycle = "REFERENCE_BUILDING";
  } else if (!reference.isComplete) {
    lifecycle = "NO_TRADE";
    noTradeReasons.push(`09:00 referans mumu geçersiz (${reference.dataQuality}).`);
  } else {
    const read = detectWindow(reference, windowCandles, reference.atr, config, windowEndUtc);
    if (read.bothSides) {
      lifecycle = "BOTH_SIDES_SWEPT";
      invalidationReasons.push("Her iki referans tarafı da süpürüldü; reversal setup reddedilir (varsayılan).");
      events.push({ id: `${reference.referenceRangeId}:both`, kind: "invalidation", status: "fail", label: "Both Sides Swept", detail: "Reference high ve low aynı pencerede alındı." });
    } else if (!read.sweep) {
      lifecycle = windowOver ? "NO_TRADE" : "WAITING_FOR_SWEEP";
      if (windowOver) noTradeReasons.push("11:00 NY'e kadar sweep gelmedi (no-sweep günü).");
    } else {
      direction = read.sweep.side === "HIGH" ? "short" : "long";
      events.push({
        id: `${reference.referenceRangeId}:sweep`,
        kind: "sweep",
        status: "pass",
        label: `Reference ${read.sweep.side} Sweep`,
        detail: `${read.sweep.side === "HIGH" ? "High" : "Low"} ${read.sweep.extremePrice.toFixed(4)}'e süpürüldü (penetrasyon ${read.sweep.penetrationAtrRatio.toFixed(2)}×ATR, dışarıda ${read.sweep.closesOutside} kapanış).`,
        timestampUtc: read.sweep.timestampUtc,
        price: read.sweep.extremePrice
      });
      if (read.acceptedOutside) {
        lifecycle = "BREAK_ACCEPTED_OUTSIDE";
        invalidationReasons.push(`Range dışında kabul (${read.sweep.closesOutside} kapanış); reversal değil continuation — setup reddedildi.`);
        events.push({ id: `${reference.referenceRangeId}:acceptance`, kind: "acceptance", status: "fail", label: "Accepted Outside", detail: "Reclaim yok; dışarıda çoklu kapanış." });
      } else if (!read.sweep.reclaimed) {
        lifecycle = windowOver ? "NO_TRADE" : "WAITING_FOR_RECLAIM";
        if (windowOver) noTradeReasons.push("Reclaim gelmeden pencere kapandı.");
      } else {
        events.push({ id: `${reference.referenceRangeId}:reclaim`, kind: "reclaim", status: "pass", label: "Reclaim", detail: "Kapanış range içine döndü; dışarıda kabul yok.", timestampUtc: read.sweep.reclaimTimestampUtc });
        if (!read.displacement) {
          lifecycle = windowOver ? "NO_TRADE" : "WAITING_FOR_DISPLACEMENT";
          if (windowOver) noTradeReasons.push("Displacement gelmedi.");
        } else {
          events.push({ id: `${reference.referenceRangeId}:disp`, kind: "displacement", status: "pass", label: "Displacement", detail: `Gövde/menzil ${read.displacement.bodyToRange}, gövde ${read.displacement.bodyToAtr}×ATR.`, timestampUtc: read.displacement.timestampUtc });
          if (!read.mss && !read.cisd) {
            lifecycle = windowOver ? "NO_TRADE" : "WAITING_FOR_STRUCTURE_SHIFT";
            if (windowOver) noTradeReasons.push("MSS/CISD onayı gelmedi.");
          } else {
            if (read.mss) events.push({ id: `${reference.referenceRangeId}:mss`, kind: "mss", status: "pass", label: "MSS", detail: `Pivot ${read.mss.levelPrice.toFixed(4)} kapanışla kırıldı.`, timestampUtc: read.mss.confirmationTimestampUtc, price: read.mss.levelPrice });
            if (read.cisd) events.push({ id: `${reference.referenceRangeId}:cisd`, kind: "cisd", status: "pass", label: "CISD", detail: `Delivery serisi açılışı ${read.cisd.levelPrice.toFixed(4)} kapanışla geçildi.`, timestampUtc: read.cisd.confirmationTimestampUtc, price: read.cisd.levelPrice });
            if (!read.entryArray || !read.plan) {
              lifecycle = windowOver ? "NO_TRADE" : "WAITING_FOR_ENTRY_ARRAY";
              if (windowOver) noTradeReasons.push("Geçerli entry array (FVG) oluşmadı.");
            } else {
              events.push({ id: `${reference.referenceRangeId}:array`, kind: "entry-array", status: "pass", label: "FVG Entry Array", detail: `FVG ${read.entryArray.bottom.toFixed(4)}-${read.entryArray.top.toFixed(4)} (CE entry).`, timestampUtc: read.entryArray.createdAtUtc, price: (read.entryArray.top + read.entryArray.bottom) / 2 });
              if (read.plan.plannedRR < config.minimumRR) {
                lifecycle = "NO_TRADE";
                noTradeReasons.push(`R:R ${read.plan.plannedRR} < minimum ${config.minimumRR}.`);
              } else if (!read.plan.entryFilledUtc) {
                lifecycle = windowOver ? "EXPIRED" : "ORDER_PENDING";
                if (windowOver) noTradeReasons.push("Entry 11:00 NY'den önce DOLMADI; emir iptal (strict deadline).");
              } else {
                const remaining = read.plan.remainingSecondsAtEntry ?? 0;
                if (remaining <= config.lateWindowSeconds) {
                  warnings.push(`Entry pencere kapanışına ${Math.round(remaining / 60)} dk kala doldu (LATE riski).`);
                }
                events.push({ id: `${reference.referenceRangeId}:entry`, kind: "entry", status: "pass", label: "Entry Filled", detail: `Entry ${read.plan.entry.toFixed(4)} doldu; kalan süre ${Math.round(remaining / 60)} dk.`, timestampUtc: read.plan.entryFilledUtc, price: read.plan.entry });
                lifecycle = read.outcome === "stopped" ? "STOPPED"
                  : read.outcome === "tp2" ? "COMPLETED"
                  : read.outcome === "tp1" ? "TARGET_1_REACHED"
                  : windowOver ? "ACTIVE" : "ENTRY_FILLED";
                if (read.outcome === "tp2") events.push({ id: `${reference.referenceRangeId}:tp2`, kind: "target", status: "pass", label: "Opposite Range Target", detail: "Karşı referans ucu görüldü.", price: read.plan.targets[1] });
              }
            }
          }
        }
      }
    }

    // HTF context — BIAS_SCORED: recorded and scored, never a silent gate (Master §11.3).
    const htfVotes = [context.bias.daily, context.bias.h4, context.bias.h1];
    const wanted = direction === "short" ? "bearish" : "bullish";
    const agree = direction === "none" ? 0 : htfVotes.filter((vote) => vote === wanted).length;
    const oppose = direction === "none" ? 0 : htfVotes.filter((vote) => vote !== wanted && vote !== "neutral").length;
    const htfAlignment: SilverBulletSetup["htfAlignment"] = agree > oppose ? "aligned" : oppose > agree ? "conflicting" : "neutral";
    if (htfAlignment === "conflicting" && direction !== "none") warnings.push("HTF bias setup yönüne karşı (BIAS_SCORED: skor düşer, mekanik tetik bloklanmaz).");

    const breakdown: SbScoreBreakdown = {
      rangeQuality: reference.quality === "normal" ? 10 : reference.quality === "compressed" ? 7 : reference.quality === "expanded" ? 5 : 2,
      sweepQuality: read.sweep ? Math.max(4, 15 - read.sweep.closesOutside * 4 - (read.sweep.penetrationAtrRatio > 3 ? 4 : 0)) : 0,
      reclaimQuality: read.sweep?.reclaimed ? (read.sweep.closesOutside === 0 ? 10 : 6) : 0,
      displacementQuality: read.displacement ? Math.min(15, Math.round(read.displacement.bodyToAtr * 5 + read.displacement.bodyToRange * 5)) : 0,
      structureQuality: read.mss && read.cisd ? 15 : read.mss ? 12 : read.cisd ? 9 : 0,
      entryArrayQuality: read.entryArray ? 10 : 0,
      htfAlignment: htfAlignment === "aligned" ? 10 : htfAlignment === "neutral" ? 5 : 0,
      targetQuality: read.plan ? 5 : 0,
      riskReward: read.plan ? (read.plan.plannedRR >= config.minimumRR ? 5 : 0) : 0,
      timingQuality: read.plan?.entryFilledUtc ? ((read.plan.remainingSecondsAtEntry ?? 0) > config.lateWindowSeconds ? 5 : 2) : 0,
      penalties: 0
    };
    let penalties = 0;
    if (read.bothSides) penalties += 25;
    if (read.acceptedOutside) penalties += 25;
    if (reference.quality === "exhausted") penalties += 10;
    if (htfAlignment === "conflicting") penalties += 8;
    breakdown.penalties = -penalties;
    const rawScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const setupModel = direction === "short" ? "NY_AM_09_RANGE_HIGH_SWEEP_BEARISH_SB" as const : direction === "long" ? "NY_AM_09_RANGE_LOW_SWEEP_BULLISH_SB" as const : undefined;
    const triggerType = read.mss && read.entryArray ? "SB_MSS_FVG" as const : read.cisd && read.entryArray ? "SB_CISD_FVG" as const : undefined;
    const idempotencyKey = [symbol, reference.tradingDayId, SB_STRATEGY_PROFILE, direction, reference.referenceRangeId, read.sweep?.timestampUtc ?? "none", triggerType ?? "none"].join("|");

    return {
      setupId: `${reference.referenceRangeId}:${direction}`,
      idempotencyKey,
      setupFamily: SB_SETUP_FAMILY,
      strategyProfile: SB_STRATEGY_PROFILE,
      strategyVersion: "1.0.0",
      detectorVersion: SB_DETECTOR_VERSION,
      symbol,
      tradingDayId: reference.tradingDayId,
      createdAtUtc: read.sweep?.timestampUtc ?? windowStartUtc,
      updatedAtUtc: now,
      referenceRange: reference,
      windowStartUtc,
      windowEndUtc,
      direction,
      setupModel,
      triggerType,
      sweep: read.sweep,
      bothSides: read.bothSides,
      displacement: read.displacement,
      mss: read.mss,
      cisd: read.cisd,
      entryArray: read.entryArray,
      plan: read.plan,
      lifecycleStatus: lifecycle,
      score,
      grade: gradeFor(score),
      scoreBreakdown: breakdown,
      htfAlignment,
      events,
      warnings,
      noTradeReasons,
      invalidationReasons,
      summary: noTradeReasons[0] ?? invalidationReasons[0] ?? (read.plan?.entryFilledUtc
        ? `${setupModel ?? "SB"} entry doldu (${read.plan.entry.toFixed(4)}), hedef karşı uç.`
        : `Silver Bullet ${lifecycle} — 09:00 range ${reference.low.toFixed(4)}-${reference.high.toFixed(4)}.`)
    };
  }

  // Pre-window / invalid-reference minimal object (kept for the tab's live status).
  return {
    setupId: `${reference.referenceRangeId}:none`,
    idempotencyKey: [symbol, reference.tradingDayId, SB_STRATEGY_PROFILE, "none", reference.referenceRangeId, "none", "none"].join("|"),
    setupFamily: SB_SETUP_FAMILY,
    strategyProfile: SB_STRATEGY_PROFILE,
    strategyVersion: "1.0.0",
    detectorVersion: SB_DETECTOR_VERSION,
    symbol,
    tradingDayId: reference.tradingDayId,
    createdAtUtc: reference.startUtc,
    updatedAtUtc: now,
    referenceRange: reference,
    windowStartUtc,
    windowEndUtc,
    direction: "none",
    bothSides: false,
    lifecycleStatus: lifecycle,
    score: 0,
    grade: "reject",
    scoreBreakdown: { rangeQuality: 0, sweepQuality: 0, reclaimQuality: 0, displacementQuality: 0, structureQuality: 0, entryArrayQuality: 0, htfAlignment: 0, targetQuality: 0, riskReward: 0, timingQuality: 0, penalties: 0 },
    htfAlignment: "neutral",
    events,
    warnings,
    noTradeReasons,
    invalidationReasons,
    summary: noTradeReasons[0] ?? "09:00 referans mumu oluşuyor."
  };
}

export function buildSilverBulletSetups(input: { contexts: MarketContext[]; now?: number; config?: Partial<SilverBulletConfig> }): SilverBulletSetup[] {
  return input.contexts
    .map((context) => evaluateSilverBullet({ context, now: input.now, config: input.config }))
    .filter((setup): setup is SilverBulletSetup => Boolean(setup));
}

export function silverBulletTransitionLog(previous: SilverBulletSetup | undefined, next: SilverBulletSetup): SilverBulletLog | undefined {
  if (previous?.lifecycleStatus === next.lifecycleStatus) return undefined;
  return {
    id: `${next.setupId}:${next.lifecycleStatus}`,
    setupId: next.setupId,
    eventNamespace: "SILVER_BULLET_SETUP",
    setupFamily: SB_SETUP_FAMILY,
    strategyProfile: SB_STRATEGY_PROFILE,
    symbol: next.symbol,
    tradingDayId: next.tradingDayId,
    direction: next.direction,
    statusBefore: previous?.lifecycleStatus ?? "",
    statusAfter: next.lifecycleStatus,
    eventType: previous ? "STATE_CHANGED" : "CREATED",
    eventTimestampUtc: next.updatedAtUtc,
    reason: next.summary,
    detectorVersion: next.detectorVersion
  };
}
