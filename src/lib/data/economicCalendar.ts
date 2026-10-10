import { setLiveCalendar, type CalendarEvent } from "../../data/eventCalendar";

// Public weekly economic calendar (ForexFactory's JSON export). Rows look like
// { title: "CPI m/m", country: "USD", date: "2026-10-14T08:30:00-04:00", impact: "High", ... }.
export const FF_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

// Only High/Medium impact rows with a real timestamp; "All Day"/holiday rows have no tradable time.
export function parseForexFactoryWeek(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: CalendarEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const impact = item.impact === "High" ? "high" : item.impact === "Medium" ? "medium" : undefined;
    const time = typeof item.date === "string" ? Date.parse(item.date) : NaN;
    const currency = typeof item.country === "string" ? item.country.toUpperCase() : "";
    if (!impact || !Number.isFinite(time) || !/^[A-Z]{3}$/.test(currency)) continue;
    events.push({
      name: `${currency} ${typeof item.title === "string" ? item.title : "event"}`,
      timeUtc: new Date(time).toISOString(),
      impact,
      currencies: [currency]
    });
  }
  return events.sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
}

// Browser: the site's own cached proxy. Never throws; an unreachable feed just leaves the list empty.
export async function refreshLiveCalendar(fetcher: typeof fetch = fetch, url = "/api/calendar"): Promise<number> {
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return 0;
    const body = await response.json() as { events?: unknown };
    const events = Array.isArray(body.events) ? (body.events as CalendarEvent[]) : parseForexFactoryWeek(body);
    setLiveCalendar(events);
    return events.length;
  } catch {
    return 0;
  }
}
