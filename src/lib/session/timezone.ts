const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  FORMATTERS.set(timeZone, created);
  return created;
}

export function zonedParts(timestamp: number, timeZone: string): DateParts {
  const parts = formatter(timeZone).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

export function localDateKey(timestamp: number, timeZone: string): string {
  const parts = zonedParts(timestamp, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addLocalDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function parseClock(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid session clock: ${value}`);
  }
  return { hour, minute };
}

function partsAsUtc(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function zonedLocalToUtc(
  dateKey: string,
  clock: string,
  timeZone: string
): { timestamp: number; uncertain: boolean } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const { hour, minute } = parseClock(clock);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;

  for (let index = 0; index < 4; index += 1) {
    const offset = partsAsUtc(zonedParts(guess, timeZone)) - guess;
    const corrected = target - offset;
    if (Math.abs(corrected - guess) < 1_000) {
      guess = corrected;
      break;
    }
    guess = corrected;
  }

  const roundTrip = zonedParts(guess, timeZone);
  const uncertain =
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== hour ||
    roundTrip.minute !== minute;
  return { timestamp: guess, uncertain };
}

export function formatZonedIso(timestamp: number, timeZone: string): string {
  const parts = zonedParts(timestamp, timeZone);
  const offsetMinutes = Math.round((partsAsUtc(parts) - timestamp) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${offset}`;
}
