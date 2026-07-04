import type { Killzone } from "../ict/types";

export type SessionClockState = {
  activeSession: Killzone["name"];
  nextSession: Exclude<Killzone["name"], "Outside">;
  nextStartsAt: number;
  minutesToNext: number;
  display: string;
};

// Killzones live in their local market timezone; fixed UTC hours would shift the London and
// New York windows by an hour on every DST change — fatal for a timing-driven strategy.
const SESSION_DEFS: Array<{ name: Exclude<Killzone["name"], "Outside">; timeZone: string; startHour: number; endHour: number }> = [
  { name: "Asia", timeZone: "UTC", startHour: 0, endHour: 5 },
  { name: "London", timeZone: "Europe/London", startHour: 7, endHour: 10 },
  { name: "New York AM", timeZone: "America/New_York", startHour: 7.5, endHour: 11 },
  { name: "New York PM", timeZone: "America/New_York", startHour: 13, endHour: 15 }
];

function tzOffsetHours(timeZone: string, at: number): number {
  const value = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = value.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) + Number(match[3]) / 60);
}

type SessionWindow = Pick<Killzone, "name" | "startHourUtc" | "endHourUtc"> & { name: Exclude<Killzone["name"], "Outside"> };

function sessionWindowsAt(at: number): SessionWindow[] {
  return SESSION_DEFS.map((def) => {
    const offset = def.timeZone === "UTC" ? 0 : tzOffsetHours(def.timeZone, at);
    return {
      name: def.name,
      startHourUtc: (def.startHour - offset + 24) % 24,
      endHourUtc: (def.endHour - offset + 24) % 24
    };
  });
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function hourToMs(hour: number): number {
  return Math.round(hour * 60 * 60 * 1000);
}

function sessionStart(dayStart: number, session: Pick<Killzone, "startHourUtc">): number {
  return dayStart + hourToMs(session.startHourUtc);
}

function sessionEnd(dayStart: number, session: Pick<Killzone, "endHourUtc">): number {
  return dayStart + hourToMs(session.endHourUtc);
}

function formatCountdown(minutes: number): string {
  if (minutes <= 0) return "şimdi";
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}g`);
  if (hours) parts.push(`${hours}s`);
  if (mins || !parts.length) parts.push(`${mins}dk`);
  return parts.join(" ");
}

export function buildSessionClock(now = Date.now()): SessionClockState {
  const windows = sessionWindowsAt(now);
  const dayStart = startOfUtcDay(now);
  const active = windows.find((session) => {
    const start = sessionStart(dayStart, session);
    const end = sessionEnd(dayStart, session);
    return now >= start && now < end;
  });
  const todayOrTomorrowStarts = windows
    .flatMap((session) => [
      { session, startsAt: sessionStart(dayStart, session) },
      { session, startsAt: sessionStart(dayStart + 24 * 60 * 60 * 1000, session) }
    ])
    .filter((item) => item.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt);
  const next = todayOrTomorrowStarts[0] ?? { session: windows[0], startsAt: sessionStart(dayStart + 24 * 60 * 60 * 1000, windows[0]) };
  const minutesToNext = Math.max(0, Math.ceil((next.startsAt - now) / 60_000));

  return {
    activeSession: active?.name ?? "Outside",
    nextSession: next.session.name,
    nextStartsAt: next.startsAt,
    minutesToNext,
    display: `${next.session.name} ${formatCountdown(minutesToNext)}`
  };
}

export function formatTurkeySessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Istanbul"
  });
}

export function sessionWindows(at = Date.now()): Killzone[] {
  return sessionWindowsAt(at).map((session) => ({ ...session, active: false }));
}
