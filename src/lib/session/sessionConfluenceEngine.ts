import type { Candle, ICTBias, MarketContext, QualityGrade, TradeDirection, TradingSignal } from "../ict/types";
import { sessionProfileForSymbol } from "./profiles";
import { buildSessionRanges } from "./sessionRangeEngine";
import type {
  SessionName,
  SessionRange,
  SessionScoreBreakdown,
  SessionSetup,
  SessionSetupEvent,
  SessionSetupLifecycle,
  SessionSetupModel,
  SessionStatistics
} from "./types";

const DETECTOR_VERSION = "crt-session-1.0.0";
const PROMPT_VERSION = "crt-session-gemini-1.0.0";
const CONFIRMATION_LOOKAHEAD_MS = 12 * 60 * 60 * 1000;

type PairSpec = {
  reference: SessionName;
  trigger: SessionName;
  lowSweepModel: SessionSetupModel;
  highSweepModel: SessionSetupModel;
  bullishContinuationModel: SessionSetupModel;
  bearishContinuationModel: SessionSetupModel;
};

const PAIRS: PairSpec[] = [
  {
    reference: "ASIA",
    trigger: "LONDON",
    lowSweepModel: "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT",
    highSweepModel: "ASIA_RANGE_LONDON_HIGH_SWEEP_BEARISH_CRT",
    bullishContinuationModel: "ASIA_RANGE_LONDON_BULLISH_CONTINUATION",
    bearishContinuationModel: "ASIA_RANGE_LONDON_BEARISH_CONTINUATION"
  },
  {
    reference: "LONDON",
    trigger: "NY_AM",
    lowSweepModel: "LONDON_RANGE_NY_LOW_SWEEP_BULLISH_CRT",
    highSweepModel: "LONDON_RANGE_NY_HIGH_SWEEP_BEARISH_CRT",
    bullishContinuationModel: "LONDON_EXPANSION_NY_BULLISH_CONTINUATION",
    bearishContinuationModel: "LONDON_EXPANSION_NY_BEARISH_CONTINUATION"
  }
];

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function analysisTimestamp(context: MarketContext, fallback: number): number {
  const candle = executionCandles(context).at(-1);
  return candle ? Math.min(fallback, candle.time + 15 * 60 * 1000) : fallback;
}

function expectedBias(direction: TradeDirection): ICTBias {
  return direction === "long" ? "bullish" : "bearish";
}

function htfAlignment(context: MarketContext, direction: TradeDirection): SessionSetup["htfAlignment"] {
  const expected = expectedBias(direction);
  const opposite = direction === "long" ? "bearish" : "bullish";
  const reads = [context.bias.weekly, context.bias.daily, context.bias.h4];
  const matching = reads.filter((read) => read === expected).length;
  const opposing = reads.filter((read) => read === opposite).length;
  if (opposing >= 2) return "conflicting";
  if (opposing === 1) return "weak";
  if (matching === reads.length) return "strong";
  return "moderate";
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function averageBody(candles: Candle[]): number {
  if (!candles.length) return 0;
  return candles.reduce((sum, candle) => sum + Math.abs(candle.close - candle.open), 0) / candles.length;
}

function firstAfter(candles: Candle[], startIndex: number, predicate: (candle: Candle) => boolean): { candle: Candle; index: number } | undefined {
  for (let index = Math.max(0, startIndex); index < candles.length; index += 1) {
    if (predicate(candles[index])) return { candle: candles[index], index };
  }
  return undefined;
}

function hasAcceptance(candles: Candle[], level: number, side: "above" | "below"): boolean {
  let consecutive = 0;
  for (const candle of candles) {
    const accepted = side === "above" ? candle.close > level : candle.close < level;
    consecutive = accepted ? consecutive + 1 : 0;
    if (consecutive >= 2) return true;
  }
  return false;
}

function matchingSignal(signals: TradingSignal[], symbol: string, direction: TradeDirection): TradingSignal | undefined {
  return [...signals]
    .filter((signal) => signal.symbol === symbol && signal.direction === direction)
    .sort((left, right) => {
      const stage = Number(right.stage === "ready") - Number(left.stage === "ready");
      return stage || right.score - left.score;
    })[0];
}

function scoreFor(input: {
  context: MarketContext;
  direction: TradeDirection;
  reference: SessionRange;
  sweep: boolean;
  reclaim: boolean;
  displacement: boolean;
  confirmed: boolean;
  targetValid: boolean;
  timingValid: boolean;
  bothSwept: boolean;
  dstUncertain: boolean;
}): { score: number; breakdown: SessionScoreBreakdown; warnings: string[] } {
  const alignment = htfAlignment(input.context, input.direction);
  const warnings: string[] = [];
  const htf = alignment === "strong" ? 15 : alignment === "moderate" ? 10 : alignment === "weak" ? 4 : 0;
  const rangeQuality = input.reference.quality === "normal" ? 10 : input.reference.quality === "unknown" ? 6 : 3;
  const breakdown: SessionScoreBreakdown = {
    htfAlignment: htf,
    rangeQuality,
    liquidityLevel: 10,
    sweepQuality: input.sweep ? 15 : 0,
    reclaimQuality: input.reclaim ? 10 : 0,
    displacementQuality: input.displacement ? 15 : 0,
    crtQuality: input.confirmed ? 10 : input.displacement ? 5 : 0,
    ltfConfirmation: input.confirmed ? 5 : 0,
    targetQuality: input.targetValid ? 5 : 0,
    timingQuality: input.timingValid ? 5 : 0,
    penalties: 0
  };
  if (alignment === "conflicting") {
    breakdown.penalties += 20;
    warnings.push("HTF yönü setup yönüne karşı.");
  } else if (alignment === "weak") {
    breakdown.penalties += 8;
    warnings.push("HTF zincirinde bir karşı yön var.");
  }
  if (input.reference.quality === "wide") {
    breakdown.penalties += 8;
    warnings.push("Referans session range geniş; expansion kısmen tüketilmiş olabilir.");
  }
  if (input.reference.quality === "too-narrow") {
    breakdown.penalties += 4;
    warnings.push("Referans session range olağandışı dar.");
  }
  if (input.bothSwept) {
    breakdown.penalties += 12;
    warnings.push("Referans range iki taraftan da alındı; yön çözülmedi.");
  }
  if (input.dstUncertain) {
    breakdown.penalties += 15;
    warnings.push("Session sınırında DST belirsizliği var.");
  }
  const positive = Object.entries(breakdown)
    .filter(([key]) => key !== "penalties")
    .reduce((sum, [, value]) => sum + value, 0);
  return { score: Math.max(0, Math.min(100, positive - breakdown.penalties)), breakdown, warnings };
}

function lifecycleFor(input: {
  trigger: SessionRange;
  sweep: boolean;
  reclaim: boolean;
  displacement: boolean;
  confirmed: boolean;
  invalid: boolean;
  now: number;
}): SessionSetupLifecycle {
  if (input.invalid) return "INVALIDATED";
  if (input.confirmed) return "CONFIRMED";
  if (input.trigger.state === "SCHEDULED") return "WAITING_FOR_SWEEP";
  if (!input.sweep) return input.trigger.state === "BUILDING" ? "WAITING_FOR_SWEEP" : "EXPIRED";
  if (!input.reclaim) return "WAITING_FOR_RECLAIM";
  if (!input.displacement) return "WAITING_FOR_DISPLACEMENT";
  if (input.now > input.trigger.endsAt + CONFIRMATION_LOOKAHEAD_MS) return "LATE";
  return "WAITING_FOR_LTF_CONFIRMATION";
}

function summaryFor(
  direction: TradeDirection,
  reference: SessionName,
  trigger: SessionName,
  lifecycle: SessionSetupLifecycle
): string {
  const side = direction === "long" ? "low" : "high";
  if (lifecycle === "CONFIRMED") return `${reference} ${side} alındı; ${trigger} içinde CRT onayı tamam.`;
  if (lifecycle === "WAITING_FOR_RECLAIM") return `${reference} ${side} alındı; range içine dönüş bekleniyor.`;
  if (lifecycle === "WAITING_FOR_DISPLACEMENT") return "Reclaim var; temiz displacement bekleniyor.";
  if (lifecycle === "WAITING_FOR_LTF_CONFIRMATION") return "Session modeli hazır; lower-timeframe CRT onayı bekleniyor.";
  if (lifecycle === "INVALIDATED") return "Range dışı kabul veya HTF çatışması setupı bozdu.";
  if (lifecycle === "EXPIRED") return "Trigger session bitti; temiz sequence oluşmadı.";
  return `${trigger} içinde ${reference} ${side} etkileşimi bekleniyor.`;
}

function buildPairSetup(
  context: MarketContext,
  signals: TradingSignal[],
  reference: SessionRange,
  trigger: SessionRange,
  spec: PairSpec,
  now: number
): SessionSetup | undefined {
  if (reference.high === undefined || reference.low === undefined || reference.midpoint === undefined) return undefined;
  const candles = executionCandles(context).filter((candle) => candle.time >= trigger.startsAt && candle.time < Math.min(now, trigger.endsAt + CONFIRMATION_LOOKAHEAD_MS));
  const highSweep = firstAfter(candles, 0, (candle) => candle.high > reference.high!);
  const lowSweep = firstAfter(candles, 0, (candle) => candle.low < reference.low!);
  const highReclaim = highSweep ? firstAfter(candles, highSweep.index, (candle) => candle.close < reference.high!) : undefined;
  const lowReclaim = lowSweep ? firstAfter(candles, lowSweep.index, (candle) => candle.close > reference.low!) : undefined;
  const acceptedAbove = hasAcceptance(candles, reference.high, "above");
  const acceptedBelow = hasAcceptance(candles, reference.low, "below");
  const bodyMean = averageBody(candles.slice(0, Math.max(1, candles.length - 1)));

  let direction: TradeDirection;
  let model: SessionSetupModel;
  let sweep: { candle: Candle; index: number } | undefined;
  let reclaim: { candle: Candle; index: number } | undefined;
  let continuation = false;

  if (lowSweep && lowReclaim && !(highSweep && highReclaim)) {
    direction = "long";
    model = spec.lowSweepModel;
    sweep = lowSweep;
    reclaim = lowReclaim;
  } else if (highSweep && highReclaim && !(lowSweep && lowReclaim)) {
    direction = "short";
    model = spec.highSweepModel;
    sweep = highSweep;
    reclaim = highReclaim;
  } else if (acceptedAbove && !acceptedBelow) {
    direction = "long";
    model = spec.bullishContinuationModel;
    sweep = highSweep;
    continuation = true;
  } else if (acceptedBelow && !acceptedAbove) {
    direction = "short";
    model = spec.bearishContinuationModel;
    sweep = lowSweep;
    continuation = true;
  } else {
    const bullishReads = [context.bias.weekly, context.bias.daily, context.bias.h4].filter((bias) => bias === "bullish").length;
    const bearishReads = [context.bias.weekly, context.bias.daily, context.bias.h4].filter((bias) => bias === "bearish").length;
    direction = bullishReads >= bearishReads ? "long" : "short";
    model = direction === "long" ? spec.lowSweepModel : spec.highSweepModel;
    sweep = direction === "long" ? lowSweep : highSweep;
    reclaim = direction === "long" ? lowReclaim : highReclaim;
  }

  const displacementStart = reclaim?.index ?? sweep?.index ?? 0;
  const displacement = firstAfter(candles, displacementStart, (candle) => {
    const body = Math.abs(candle.close - candle.open);
    const directional = direction === "long" ? candle.close > candle.open : candle.close < candle.open;
    return directional && bodyMean > 0 && body >= bodyMean * 1.25;
  });
  const signal = matchingSignal(signals, context.symbol, direction);
  const confirmed = Boolean(
    signal?.stage === "ready" &&
    signal.evidence.some((item) => item.id === "choch" && item.status === "pass") &&
    signal.plan.entryModel.retested
  );
  const target = signal?.plan.targets[1] ?? signal?.plan.targets[0];
  const targetValid = typeof target === "number" && (direction === "long" ? target > reference.midpoint : target < reference.midpoint);
  const bothSwept = Boolean(highSweep && lowSweep);
  const reclaimFound = continuation ? true : Boolean(reclaim);
  const invalid = htfAlignment(context, direction) === "conflicting" || (bothSwept && !confirmed);
  const lifecycle = lifecycleFor({
    trigger,
    sweep: Boolean(sweep),
    reclaim: reclaimFound,
    displacement: Boolean(displacement),
    confirmed,
    invalid,
    now
  });
  const scored = scoreFor({
    context,
    direction,
    reference,
    sweep: Boolean(sweep),
    reclaim: reclaimFound,
    displacement: Boolean(displacement),
    confirmed,
    targetValid,
    timingValid: now <= trigger.endsAt + CONFIRMATION_LOOKAHEAD_MS,
    bothSwept,
    dstUncertain: reference.dstUncertain || trigger.dstUncertain
  });
  const events: SessionSetupEvent[] = [
    {
      id: `${reference.id}:range`,
      kind: "range",
      status: reference.state === "LOCKED" || reference.state === "EXPIRED" ? "pass" : "pending",
      label: `${reference.session} range`,
      detail: `${reference.low.toFixed(5)} - ${reference.high.toFixed(5)} kilitli range.`,
      timestampUtc: reference.endsAt
    },
    {
      id: `${reference.id}:${trigger.id}:sweep`,
      kind: continuation ? "acceptance" : "sweep",
      status: sweep ? "pass" : "pending",
      label: continuation ? "Range dışı kabul" : "Liquidity sweep",
      detail: sweep
        ? `${direction === "long" ? "Low" : "High"} ${trigger.session} içinde etkilendi.`
        : `${trigger.session} içinde anlamlı range etkileşimi bekleniyor.`,
      timestampUtc: sweep?.candle.time,
      price: sweep ? (direction === "long" ? sweep.candle.low : sweep.candle.high) : undefined,
      timeframe: "15m"
    },
    {
      id: `${reference.id}:${trigger.id}:reclaim`,
      kind: continuation ? "acceptance" : "reclaim",
      status: reclaimFound ? "pass" : sweep ? "pending" : "pending",
      label: continuation ? "Acceptance" : "Range içine dönüş",
      detail: continuation ? "İki kapanış range dışında kabul gösterdi." : reclaim ? "Mum range içine kapandı." : "Range içine kapanış yok.",
      timestampUtc: reclaim?.candle.time,
      price: reclaim?.candle.close,
      timeframe: "15m"
    },
    {
      id: `${reference.id}:${trigger.id}:displacement`,
      kind: "displacement",
      status: displacement ? "pass" : reclaimFound ? "pending" : "pending",
      label: "Displacement",
      detail: displacement ? `${direction.toUpperCase()} impulsive delivery görüldü.` : "Yönlü displacement henüz yok.",
      timestampUtc: displacement?.candle.time,
      price: displacement?.candle.close,
      timeframe: "15m"
    },
    {
      id: `${reference.id}:${trigger.id}:confirmation`,
      kind: "ltf-confirmation",
      status: confirmed ? "pass" : displacement ? "pending" : "pending",
      label: "CRT confirmation",
      detail: confirmed ? `${signal?.timeframe.toUpperCase()} ChoCH + retest tamam.` : "Mevcut CRT motorundan READY onayı bekleniyor.",
      timestampUtc: confirmed ? signal?.createdAt : undefined,
      price: signal?.plan.entry,
      timeframe: signal?.timeframe
    }
  ];
  const blockers = events.filter((event) => event.status === "pending").map((event) => event.detail);
  if (htfAlignment(context, direction) === "conflicting") blockers.unshift("Weekly/Daily/H4 yön zinciri setupa karşı.");

  return {
    id: `${context.symbol}:${model}:${reference.id}`,
    setupFamily: "CRT_SESSION",
    setupModel: model,
    referenceSession: spec.reference,
    triggerSession: spec.trigger,
    confirmationSession: spec.trigger,
    direction,
    lifecycleStatus: lifecycle,
    grade: gradeFromScore(scored.score),
    score: scored.score,
    symbol: context.symbol,
    timeframe: reference.session === "ASIA" || reference.session === "LONDON" ? "15m" : "1h",
    confirmationTimeframe: signal?.timeframe ?? "15m",
    tradingDayId: reference.tradingDayId,
    sessionProfileId: reference.profileId,
    sessionProfileVersion: reference.profileVersion,
    detectorVersion: DETECTOR_VERSION,
    promptVersion: PROMPT_VERSION,
    createdAt: sweep?.candle.time ?? trigger.startsAt,
    updatedAt: now,
    referenceRangeId: reference.id,
    referenceRange: {
      high: reference.high,
      low: reference.low,
      midpoint: reference.midpoint,
      quality: reference.quality,
      startsAt: reference.startsAt,
      endsAt: reference.endsAt
    },
    currentPrice: candles.at(-1)?.close ?? executionCandles(context).at(-1)?.close ?? reference.midpoint,
    sweptSide: bothSwept ? "BOTH" : highSweep ? "HIGH" : lowSweep ? "LOW" : "NONE",
    sweepTimestampUtc: sweep?.candle.time,
    reclaimTimestampUtc: reclaim?.candle.time,
    displacementDirection: displacement ? direction : undefined,
    signalId: signal?.id,
    plan: signal?.plan,
    htfAlignment: htfAlignment(context, direction),
    scoreBreakdown: scored.breakdown,
    events,
    warnings: [...scored.warnings, ...(signal?.plan.planWarnings ?? [])],
    blockers,
    summary: summaryFor(direction, spec.reference, spec.trigger, lifecycle)
  };
}

function pairedRanges(ranges: SessionRange[], spec: PairSpec, now: number): Array<{ reference: SessionRange; trigger: SessionRange }> {
  const references = ranges
    .filter((range) =>
      range.session === spec.reference &&
      range.endsAt <= now &&
      range.high !== undefined &&
      range.low !== undefined
    )
    .slice(-3);
  return references.flatMap((reference) => {
    const trigger = ranges.find((range) =>
      range.session === spec.trigger &&
      range.startsAt >= reference.endsAt &&
      range.startsAt <= reference.endsAt + 30 * 60 * 60 * 1000
    );
    return trigger ? [{ reference, trigger }] : [];
  });
}

function latestTriggerRange(ranges: SessionRange[], now: number): SessionRange | undefined {
  const supported: SessionName[] = ["LONDON", "NY_AM", "NY_PM"];
  return [...ranges]
    .filter((range) =>
      supported.includes(range.session) &&
      range.startsAt <= now &&
      range.endsAt + CONFIRMATION_LOOKAHEAD_MS >= now
    )
    .sort((left, right) => {
      const leftActive = Number(now >= left.startsAt && now < left.endsAt);
      const rightActive = Number(now >= right.startsAt && now < right.endsAt);
      return rightActive - leftActive || right.startsAt - left.startsAt;
    })[0];
}

function syntheticReferenceRange(input: {
  id: string;
  trigger: SessionRange;
  high: number;
  low: number;
  startsAt: number;
  endsAt: number;
}): SessionRange {
  return {
    ...input.trigger,
    id: input.id,
    session: "CUSTOM",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    state: "LOCKED",
    high: input.high,
    low: input.low,
    midpoint: (input.high + input.low) / 2,
    open: undefined,
    close: undefined,
    highTime: undefined,
    lowTime: undefined,
    candleCount: 1,
    size: input.high - input.low,
    medianSize: undefined,
    quality: "unknown",
    lockedAt: input.endsAt,
    expiresAt: input.trigger.expiresAt,
    dstUncertain: input.trigger.dstUncertain
  };
}

function rangeWasSwept(context: MarketContext, trigger: SessionRange, high: number, low: number, now: number): boolean {
  return executionCandles(context).some((candle) =>
    candle.time >= trigger.startsAt &&
    candle.time < Math.min(now, trigger.endsAt + CONFIRMATION_LOOKAHEAD_MS) &&
    (candle.high > high || candle.low < low)
  );
}

function buildPreviousDaySetup(
  context: MarketContext,
  signals: TradingSignal[],
  ranges: SessionRange[],
  now: number
): SessionSetup | undefined {
  const trigger = latestTriggerRange(ranges, now);
  const previousDay = context.timeframes.daily.filter((candle) => candle.closed !== false).at(-1);
  if (!trigger || !previousDay || !rangeWasSwept(context, trigger, previousDay.high, previousDay.low, now)) return undefined;
  const reference = syntheticReferenceRange({
    id: `${context.symbol}:previous-day:${previousDay.time}`,
    trigger,
    high: previousDay.high,
    low: previousDay.low,
    startsAt: previousDay.time,
    endsAt: previousDay.time + 24 * 60 * 60 * 1000
  });
  const spec: PairSpec = {
    reference: "CUSTOM",
    trigger: trigger.session,
    lowSweepModel: "PDL_SESSION_SWEEP_BULLISH_CRT",
    highSweepModel: "PDH_SESSION_SWEEP_BEARISH_CRT",
    bullishContinuationModel: "PDL_SESSION_SWEEP_BULLISH_CRT",
    bearishContinuationModel: "PDH_SESSION_SWEEP_BEARISH_CRT"
  };
  const setup = buildPairSetup(context, signals, reference, trigger, spec, now);
  if (!setup || setup.sweptSide === "NONE") return undefined;
  return {
    ...setup,
    id: `${context.symbol}:${setup.setupModel}:${reference.id}:${trigger.id}`,
    referenceSession: "PREVIOUS_DAY",
    referenceRangeId: reference.id,
    summary: setup.direction === "long"
      ? `PDL ${trigger.session} içinde alındı; bullish CRT sequence ${setup.lifecycleStatus === "CONFIRMED" ? "tamam" : "gelişiyor"}.`
      : `PDH ${trigger.session} içinde alındı; bearish CRT sequence ${setup.lifecycleStatus === "CONFIRMED" ? "tamam" : "gelişiyor"}.`
  };
}

function buildPreviousHtfSetups(
  context: MarketContext,
  signals: TradingSignal[],
  ranges: SessionRange[],
  now: number
): SessionSetup[] {
  const trigger = latestTriggerRange(ranges, now);
  if (!trigger) return [];
  const seen = new Set<string>();
  return signals.flatMap((signal) => {
    const anchor = signal.crtAnchor;
    if (!anchor?.raidActive || anchor.rangeHigh <= anchor.rangeLow) return [];
    const key = `${anchor.rangeTf}:${anchor.rangeHigh}:${anchor.rangeLow}`;
    if (seen.has(key) || !rangeWasSwept(context, trigger, anchor.rangeHigh, anchor.rangeLow, now)) return [];
    seen.add(key);
    const reference = syntheticReferenceRange({
      id: `${context.symbol}:previous-${anchor.rangeTf}:${anchor.rangeHigh}:${anchor.rangeLow}`,
      trigger,
      high: anchor.rangeHigh,
      low: anchor.rangeLow,
      startsAt: trigger.startsAt - 24 * 60 * 60 * 1000,
      endsAt: trigger.startsAt
    });
    const spec: PairSpec = {
      reference: "CUSTOM",
      trigger: trigger.session,
      lowSweepModel: "PREV_HTF_LOW_SESSION_SWEEP_BULLISH_CRT",
      highSweepModel: "PREV_HTF_HIGH_SESSION_SWEEP_BEARISH_CRT",
      bullishContinuationModel: "PREV_HTF_LOW_SESSION_SWEEP_BULLISH_CRT",
      bearishContinuationModel: "PREV_HTF_HIGH_SESSION_SWEEP_BEARISH_CRT"
    };
    const setup = buildPairSetup(context, signals, reference, trigger, spec, now);
    if (!setup || setup.sweptSide === "NONE") return [];
    return [{
      ...setup,
      id: `${context.symbol}:${setup.setupModel}:${reference.id}:${trigger.id}`,
      referenceSession: "PREVIOUS_HTF" as const,
      referenceRangeId: reference.id,
      timeframe: anchor.rangeTf,
      confirmationTimeframe: anchor.confirmTf,
      summary: `${anchor.rangeTf.toUpperCase()} CRT ${setup.direction === "long" ? "low" : "high"} ${trigger.session} içinde alındı; ${anchor.confirmTf.toUpperCase()} onay ${setup.lifecycleStatus === "CONFIRMED" ? "tamam" : "bekleniyor"}.`
    }];
  });
}

export function buildSessionSetups(input: {
  contexts: MarketContext[];
  signals: TradingSignal[];
  now?: number;
}): SessionSetup[] {
  const fallbackNow = input.now ?? Date.now();
  const setups = input.contexts.flatMap((context) => {
    const now = analysisTimestamp(context, fallbackNow);
    const profile = sessionProfileForSymbol(context.symbol);
    const ranges = buildSessionRanges(context, profile, now);
    const symbolSignals = input.signals.filter((signal) => signal.symbol === context.symbol);
    const pairSetups = PAIRS.flatMap((spec) =>
      pairedRanges(ranges, spec, now)
        .map(({ reference, trigger }) => buildPairSetup(context, symbolSignals, reference, trigger, spec, now))
        .filter((setup): setup is SessionSetup => Boolean(setup))
    );
    const previousDay = buildPreviousDaySetup(context, symbolSignals, ranges, now);
    return [
      ...pairSetups,
      ...(previousDay ? [previousDay] : []),
      ...buildPreviousHtfSetups(context, symbolSignals, ranges, now)
    ];
  });

  return setups
    .sort((left, right) => {
      const confirmed = Number(right.lifecycleStatus === "CONFIRMED") - Number(left.lifecycleStatus === "CONFIRMED");
      return confirmed || right.updatedAt - left.updatedAt || right.score - left.score;
    })
    .filter((setup, index, all) => all.findIndex((candidate) => candidate.id === setup.id) === index);
}

export function buildSessionStatistics(setups: SessionSetup[]): SessionStatistics {
  const models = new Map<SessionSetupModel, SessionSetup[]>();
  const routes = new Map<string, SessionSetup[]>();
  for (const setup of setups) {
    models.set(setup.setupModel, [...(models.get(setup.setupModel) ?? []), setup]);
    const route = `${setup.referenceSession} → ${setup.triggerSession}`;
    routes.set(route, [...(routes.get(route) ?? []), setup]);
  }
  const confirmedStatuses: SessionSetupLifecycle[] = ["CONFIRMED", "ACTIVE", "TARGET_1_REACHED", "TARGET_2_REACHED", "COMPLETED"];
  const invalidStatuses: SessionSetupLifecycle[] = ["INVALIDATED", "LATE", "EXPIRED"];
  return {
    total: setups.length,
    developing: setups.filter((setup) => !confirmedStatuses.includes(setup.lifecycleStatus) && !invalidStatuses.includes(setup.lifecycleStatus)).length,
    confirmed: setups.filter((setup) => confirmedStatuses.includes(setup.lifecycleStatus)).length,
    invalid: setups.filter((setup) => invalidStatuses.includes(setup.lifecycleStatus)).length,
    averageScore: setups.length ? setups.reduce((sum, setup) => sum + setup.score, 0) / setups.length : 0,
    byModel: [...models.entries()].map(([model, rows]) => ({
      model,
      total: rows.length,
      confirmed: rows.filter((row) => confirmedStatuses.includes(row.lifecycleStatus)).length,
      averageScore: rows.reduce((sum, row) => sum + row.score, 0) / rows.length
    })).sort((left, right) => right.confirmed - left.confirmed || right.averageScore - left.averageScore),
    byReferenceTrigger: [...routes.entries()].map(([route, rows]) => ({
      route,
      total: rows.length,
      confirmed: rows.filter((row) => confirmedStatuses.includes(row.lifecycleStatus)).length
    })).sort((left, right) => right.confirmed - left.confirmed || right.total - left.total)
  };
}
