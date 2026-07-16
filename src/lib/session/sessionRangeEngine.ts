import type { Candle, MarketContext, MarketSymbol } from "../ict/types";
import { addLocalDays, localDateKey, parseClock, zonedLocalToUtc } from "./timezone";
import type { SessionName, SessionOccurrence, SessionProfile, SessionRange, SessionRangeQuality } from "./types";
import { sessionProfileForSymbol } from "./profiles";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_LOOKBACK_DAYS = 10;

function clockMinutes(value: string): number {
  const clock = parseClock(value);
  return clock.hour * 60 + clock.minute;
}

function occurrenceFor(profile: SessionProfile, session: SessionName, localDate: string): SessionOccurrence {
  const config = profile.sessions[session];
  const wraps = clockMinutes(config.end) <= clockMinutes(config.start);
  const endDate = wraps ? addLocalDays(localDate, 1) : localDate;
  const start = zonedLocalToUtc(localDate, config.start, config.timezone);
  const end = zonedLocalToUtc(endDate, config.end, config.timezone);
  return {
    id: `${profile.profileId}:${profile.version}:${session}:${localDate}`,
    session,
    profileId: profile.profileId,
    profileVersion: profile.version,
    timezone: config.timezone,
    localDate,
    tradingDayId: `${profile.profileId}:${wraps ? endDate : localDate}`,
    startsAt: start.timestamp,
    endsAt: end.timestamp,
    dstUncertain: start.uncertain || end.uncertain
  };
}

function uniqueLocalDates(candles: Candle[], now: number, timeZone: string): string[] {
  const dates = new Set<string>();
  const first = candles[0]?.time ?? now - DAY_MS;
  const last = Math.max(candles.at(-1)?.time ?? now, now);
  for (let cursor = first - DAY_MS; cursor <= last + DAY_MS; cursor += DAY_MS) {
    const key = localDateKey(cursor, timeZone);
    dates.add(key);
    dates.add(addLocalDays(key, -1));
    dates.add(addLocalDays(key, 1));
  }
  return [...dates].sort();
}

export function buildSessionOccurrences(
  profile: SessionProfile,
  candles: Candle[],
  now: number
): SessionOccurrence[] {
  const earliest = (candles[0]?.time ?? now) - DAY_MS;
  const latest = now + DAY_MS;
  return (Object.keys(profile.sessions) as SessionName[])
    .filter((session) => profile.sessions[session].enabled)
    .flatMap((session) =>
      uniqueLocalDates(candles, now, profile.sessions[session].timezone)
        .map((date) => occurrenceFor(profile, session, date))
    )
    .filter((occurrence) => occurrence.endsAt >= earliest && occurrence.startsAt <= latest)
    .sort((left, right) => left.startsAt - right.startsAt);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rangeQuality(size: number | undefined, sessionMedian: number | undefined): SessionRangeQuality {
  if (!size || !sessionMedian) return "unknown";
  if (size < sessionMedian * 0.5) return "too-narrow";
  if (size > sessionMedian * 1.8) return "wide";
  return "normal";
}

export function buildSessionRanges(
  context: Pick<MarketContext, "timeframes">,
  profile: SessionProfile,
  now: number
): SessionRange[] {
  const candles = context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
  const occurrences = buildSessionOccurrences(profile, candles, now);
  const raw: SessionRange[] = occurrences.map((occurrence): SessionRange => {
    const included = candles.filter((candle) =>
      candle.time >= occurrence.startsAt &&
      candle.time < occurrence.endsAt &&
      candle.time <= now
    );
    const nextSame = occurrences.find((candidate) =>
      candidate.session === occurrence.session &&
      candidate.startsAt > occurrence.startsAt
    );
    const expiresAt = nextSame?.startsAt ?? occurrence.startsAt + DAY_MS;
    const state = now < occurrence.startsAt
      ? "SCHEDULED" as const
      : now < occurrence.endsAt
        ? "BUILDING" as const
        : now >= expiresAt
          ? "EXPIRED" as const
          : "LOCKED" as const;
    if (!included.length) {
      return {
        ...occurrence,
        state,
        high: undefined,
        low: undefined,
        midpoint: undefined,
        open: undefined,
        close: undefined,
        highTime: undefined,
        lowTime: undefined,
        candleCount: 0,
        size: undefined,
        medianSize: undefined,
        quality: "unknown" as const,
        expiresAt,
        lockedAt: state === "LOCKED" || state === "EXPIRED" ? occurrence.endsAt : undefined
      };
    }
    const highCandle = included.reduce((best, candle) => candle.high > best.high ? candle : best);
    const lowCandle = included.reduce((best, candle) => candle.low < best.low ? candle : best);
    const high = highCandle.high;
    const low = lowCandle.low;
    return {
      ...occurrence,
      state,
      high,
      low,
      midpoint: (high + low) / 2,
      open: included[0].open,
      close: included.at(-1)?.close,
      highTime: highCandle.time,
      lowTime: lowCandle.time,
      candleCount: included.length,
      size: high - low,
      quality: "unknown" as const,
      expiresAt,
      lockedAt: state === "LOCKED" || state === "EXPIRED" ? occurrence.endsAt : undefined
    };
  });

  return raw.map((range) => {
    const sessionSizes = raw
      .filter((candidate) =>
        candidate.session === range.session &&
        candidate.startsAt < range.startsAt &&
        candidate.state !== "BUILDING" &&
        typeof candidate.size === "number"
      )
      .slice(-8)
      .map((candidate) => candidate.size as number);
    const sessionMedian = median(sessionSizes);
    return {
      ...range,
      medianSize: sessionMedian,
      quality: rangeQuality(range.size, sessionMedian)
    };
  });
}

export function activeSessionRange(ranges: SessionRange[], now: number): SessionRange | undefined {
  return ranges.find((range) => now >= range.startsAt && now < range.endsAt);
}

export function latestLockedRange(ranges: SessionRange[], session: SessionName, before: number): SessionRange | undefined {
  return [...ranges]
    .filter((range) =>
      range.session === session &&
      range.endsAt <= before &&
      typeof range.high === "number" &&
      typeof range.low === "number"
    )
    .sort((left, right) => right.endsAt - left.endsAt)[0];
}

const SESSION_LABELS: Record<SessionName, string> = {
  ASIA: "Asia",
  LONDON: "London",
  NY_AM: "New York AM",
  NY_PM: "New York PM",
  LONDON_CLOSE: "London Close",
  LONDON_NY_OVERLAP: "London-NY Overlap",
  CUSTOM: "Custom"
};

function countdown(minutes: number): string {
  if (minutes <= 0) return "şimdi";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return [hours ? `${hours}s` : "", mins ? `${mins}dk` : ""].filter(Boolean).join(" ");
}

export function buildProfileSessionClock(symbol: MarketSymbol, now = Date.now()) {
  const profile = sessionProfileForSymbol(symbol);
  const occurrences = buildSessionOccurrences(profile, [], now);
  const active = occurrences.find((occurrence) => now >= occurrence.startsAt && now < occurrence.endsAt);
  const next = occurrences
    .filter((occurrence) => occurrence.startsAt > now)
    .sort((left, right) => left.startsAt - right.startsAt)[0];
  const minutesToNext = next ? Math.max(0, Math.ceil((next.startsAt - now) / 60_000)) : 0;
  return {
    activeSession: active ? SESSION_LABELS[active.session] : "Outside",
    nextSession: next ? SESSION_LABELS[next.session] : "Outside",
    nextStartsAt: next?.startsAt ?? now,
    minutesToNext,
    display: next ? `${SESSION_LABELS[next.session]} ${countdown(minutesToNext)}` : "Session yok",
    profileId: profile.profileId,
    profileVersion: profile.version
  };
}
