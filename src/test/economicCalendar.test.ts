import { afterEach, describe, expect, it } from "vitest";
import { parseForexFactoryWeek, refreshLiveCalendar } from "../lib/data/economicCalendar";
import { calendarEvents, setLiveCalendar } from "../data/eventCalendar";
import { buildEventRisk } from "../lib/intelligence/eventRiskEngine";

const week = [
  { title: "CPI m/m", country: "USD", date: "2026-10-14T08:30:00-04:00", impact: "High", forecast: "0.3%" },
  { title: "ECB Press Conference", country: "EUR", date: "2026-10-15T08:45:00-04:00", impact: "Medium" },
  { title: "Bank Holiday", country: "JPY", date: "2026-10-12T00:00:00-04:00", impact: "Holiday" },
  { title: "Retail Sales", country: "GBP", date: "2026-10-16T02:00:00-04:00", impact: "Low" },
  { title: "Broken", country: "USD", date: "not a date", impact: "High" }
];

afterEach(() => setLiveCalendar([]));

describe("economic calendar (real dated releases instead of weekday guesses)", () => {
  it("keeps only high/medium releases with a real time, in UTC", () => {
    const events = parseForexFactoryWeek(week);
    expect(events).toEqual([
      { name: "USD CPI m/m", timeUtc: "2026-10-14T12:30:00.000Z", impact: "high", currencies: ["USD"] },
      { name: "EUR ECB Press Conference", timeUtc: "2026-10-15T12:45:00.000Z", impact: "medium", currencies: ["EUR"] }
    ]);
    expect(parseForexFactoryWeek({ nope: true })).toEqual([]);
  });

  it("loads the week through the site's proxy and never throws when it is down", async () => {
    const ok = (async () => new Response(JSON.stringify({ status: "ok", events: parseForexFactoryWeek(week) }))) as unknown as typeof fetch;
    expect(await refreshLiveCalendar(ok)).toBe(2);
    expect(calendarEvents().map((event) => event.name)).toContain("USD CPI m/m");
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await refreshLiveCalendar(down)).toBe(0);
  });

  it("a real high-impact USD release flags every USD pair around its time; templates stay quiet", () => {
    setLiveCalendar(parseForexFactoryWeek(week));
    const cpi = Date.parse("2026-10-14T12:30:00Z");
    expect(buildEventRisk("EURUSD", cpi + 5 * 60_000).noTrade).toBe(true);
    expect(buildEventRisk("XAUUSD", cpi - 10 * 60_000).noTrade).toBe(true);
    // A day later nothing is active and the weekday ESTIMATES are not used once a calendar exists.
    const quiet = buildEventRisk("EURUSD", cpi + 24 * 60 * 60_000 - 60 * 60_000);
    expect(quiet.noTrade).toBe(false);
    expect(quiet.summary).not.toContain("tahmini");
  });
});
