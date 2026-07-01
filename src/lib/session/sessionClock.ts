import type { Killzone } from "../ict/types";

export type SessionClockState = {
  activeSession: Killzone["name"];
  nextSession: Exclude<Killzone["name"], "Outside">;
  nextStartsAt: number;
  minutesToNext: number;
  display: string;
};

const SESSION_WINDOWS: Array<Pick<Killzone, "name" | "startHourUtc" | "endHourUtc"> & { name: Exclude<Killzone["name"], "Outside"> }> = [
  { name: "Asia", startHourUtc: 0, endHourUtc: 5 },
  { name: "London", startHourUtc: 7, endHourUtc: 10 },
  { name: "New York AM", startHourUtc: 12.5, endHourUtc: 16 },
  { name: "New York PM", startHourUtc: 18, endHourUtc: 20 }
];

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
  const dayStart = startOfUtcDay(now);
  const active = SESSION_WINDOWS.find((session) => {
    const start = sessionStart(dayStart, session);
    const end = sessionEnd(dayStart, session);
    return now >= start && now < end;
  });
  const todayOrTomorrowStarts = SESSION_WINDOWS
    .flatMap((session) => [
      { session, startsAt: sessionStart(dayStart, session) },
      { session, startsAt: sessionStart(dayStart + 24 * 60 * 60 * 1000, session) }
    ])
    .filter((item) => item.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt);
  const next = todayOrTomorrowStarts[0] ?? { session: SESSION_WINDOWS[0], startsAt: sessionStart(dayStart + 24 * 60 * 60 * 1000, SESSION_WINDOWS[0]) };
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

export function sessionWindows(): Killzone[] {
  return SESSION_WINDOWS.map((session) => ({ ...session, active: false }));
}
