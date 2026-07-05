import type { Killzone } from "../ict/types";

export type SessionClockState = {
  activeSession: Killzone["name"];
  nextSession: Exclude<Killzone["name"], "Outside">;
  nextStartsAt: number;
  minutesToNext: number;
  display: string;
};

// ICT killzones, anchored to their market timezone so DST is handled automatically.
// Reference table (Türkiye saati, TR = UTC+3 sabit):
//   Asia KZ         02:00-05:00 TR (Istanbul sabit — Asya piyasalarında DST yok)
//   London KZ       09:00-12:00 TR yazın (07:00-10:00 Londra lokal)
//   NY KZ           14:00-17:00 TR yazın (07:00-10:00 New York lokal)
//   London Close KZ 17:00-19:00 TR yazın (10:00-12:00 New York lokal)
const SESSION_DEFS: Array<{ name: Exclude<Killzone["name"], "Outside">; timeZone: string; startHour: number; endHour: number }> = [
  { name: "Asia", timeZone: "Europe/Istanbul", startHour: 2, endHour: 5 },
  { name: "London", timeZone: "Europe/London", startHour: 7, endHour: 10 },
  { name: "New York AM", timeZone: "America/New_York", startHour: 7, endHour: 10 },
  { name: "London Close", timeZone: "America/New_York", startHour: 10, endHour: 12 }
];

const DAY_MS = 24 * 60 * 60 * 1000;

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
    const offset = tzOffsetHours(def.timeZone, at);
    return {
      name: def.name,
      startHourUtc: (def.startHour - offset + 24) % 24,
      endHourUtc: (def.endHour - offset + 24) % 24
    };
  });
}

export function sessionDurationHours(session: Pick<Killzone, "startHourUtc" | "endHourUtc">): number {
  return (session.endHourUtc - session.startHourUtc + 24) % 24;
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function hourToMs(hour: number): number {
  return Math.round(hour * 60 * 60 * 1000);
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
  // Sessions can wrap past midnight UTC (Asia), so lay out concrete windows across
  // yesterday/today/tomorrow and work with absolute timestamps.
  const concrete = windows.flatMap((session) => [-1, 0, 1].map((offset) => {
    const startsAt = dayStart + offset * DAY_MS + hourToMs(session.startHourUtc);
    return { session, startsAt, endsAt: startsAt + hourToMs(sessionDurationHours(session)) };
  }));
  const active = concrete.find((item) => now >= item.startsAt && now < item.endsAt);
  const next = concrete
    .filter((item) => item.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0]
    ?? { session: windows[0], startsAt: dayStart + DAY_MS + hourToMs(windows[0].startHourUtc), endsAt: 0 };
  const minutesToNext = Math.max(0, Math.ceil((next.startsAt - now) / 60_000));

  return {
    activeSession: active?.session.name ?? "Outside",
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
