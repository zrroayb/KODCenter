// Real high-impact event calendar (item 6, 2026-09-26). The built-in weekday templates in
// eventRiskEngine are ESTIMATES (NFP is not always the first Friday, FOMC is not every
// Wednesday), so they only warn. Only dated entries here can trigger the no-trade window
// (`avoidNews`). Add each release with its exact UTC time from an official calendar, e.g.
// { name: "US CPI", timeUtc: "2026-10-14T12:30:00Z", impact: "high", currencies: ["USD"] }.
// Every tracked symbol has USD on one side, so a USD event applies to all of them.
export type CalendarEvent = {
  name: string;
  timeUtc: string;
  impact: "high" | "medium";
  currencies: string[];
};

export const EVENT_CALENDAR: CalendarEvent[] = [];
