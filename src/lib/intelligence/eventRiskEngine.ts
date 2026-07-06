import type { EventRiskContext, MarketSymbol } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";

type EventTemplate = {
  name: string;
  hourUtc: number;
  minuteUtc: number;
  symbols: MarketSymbol[] | "all";
  activeWindowMinutes: number;
  watchWindowMinutes: number;
  hardBlock: boolean;
  occurs(date: Date): boolean;
};

// Every tracked symbol is either quoted in USD or has USD as the base, so US high-impact
// data windows apply to all of them.
const USD_SYMBOLS: MarketSymbol[] = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"];

function isFirstFriday(date: Date): boolean {
  return date.getUTCDay() === 5 && date.getUTCDate() <= 7;
}

function isWednesday(date: Date): boolean {
  return date.getUTCDay() === 3;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function isSecondWednesday(date: Date): boolean {
  return date.getUTCDay() === 3 && date.getUTCDate() >= 8 && date.getUTCDate() <= 14;
}

function isSecondThursday(date: Date): boolean {
  return date.getUTCDay() === 4 && date.getUTCDate() >= 8 && date.getUTCDate() <= 14;
}

function isThirdThursday(date: Date): boolean {
  return date.getUTCDay() === 4 && date.getUTCDate() >= 15 && date.getUTCDate() <= 21;
}

function isTuesdayOrThursday(date: Date): boolean {
  return date.getUTCDay() === 2 || date.getUTCDay() === 4;
}

function isCryptoFundingWindow(date: Date): boolean {
  return date.getUTCMinutes() <= 10 && [0, 8, 16].includes(date.getUTCHours());
}

const EVENT_TEMPLATES: EventTemplate[] = [
  {
    name: "NFP / US payroll window",
    hourUtc: 12,
    minuteUtc: 30,
    symbols: USD_SYMBOLS,
    activeWindowMinutes: 45,
    watchWindowMinutes: 120,
    hardBlock: true,
    occurs: isFirstFriday
  },
  {
    name: "FOMC-style USD event window",
    hourUtc: 18,
    minuteUtc: 0,
    symbols: USD_SYMBOLS,
    activeWindowMinutes: 60,
    watchWindowMinutes: 180,
    hardBlock: false,
    occurs: isWednesday
  },
  {
    name: "US CPI / inflation window",
    hourUtc: 12,
    minuteUtc: 30,
    symbols: USD_SYMBOLS,
    activeWindowMinutes: 45,
    watchWindowMinutes: 150,
    hardBlock: true,
    occurs: isSecondWednesday
  },
  {
    name: "US PPI / retail sales window",
    hourUtc: 12,
    minuteUtc: 30,
    symbols: USD_SYMBOLS,
    activeWindowMinutes: 35,
    watchWindowMinutes: 120,
    hardBlock: false,
    occurs: (date) => isSecondThursday(date) || isThirdThursday(date)
  },
  {
    name: "US cash open liquidity reset",
    hourUtc: 13,
    minuteUtc: 30,
    symbols: ["XAUUSD", "NAS100"],
    activeWindowMinutes: 20,
    watchWindowMinutes: 45,
    hardBlock: false,
    occurs: isWeekday
  },
  {
    name: "US high-impact data window",
    hourUtc: 12,
    minuteUtc: 30,
    symbols: USD_SYMBOLS,
    activeWindowMinutes: 35,
    watchWindowMinutes: 90,
    hardBlock: false,
    occurs: isTuesdayOrThursday
  }
];

function eventTime(day: Date, template: EventTemplate): number {
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), template.hourUtc, template.minuteUtc);
}

function nextOccurrence(now: Date, template: EventTemplate): number | undefined {
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    if (!template.occurs(day)) continue;
    const time = eventTime(day, template);
    if (time >= now.getTime() - template.activeWindowMinutes * 60_000) return time;
  }
  return undefined;
}

export function buildEventRisk(symbol: MarketSymbol, nowMs: number): EventRiskContext {
  const now = new Date(nowMs);
  const activeEvents: string[] = [];
  const activeWatchEvents: string[] = [];
  const upcomingEvents: string[] = [];
  const minutesToEvents: number[] = [];

  for (const template of EVENT_TEMPLATES) {
    if (template.symbols !== "all" && !template.symbols.includes(symbol)) continue;
    const next = nextOccurrence(now, template);
    if (typeof next !== "number") continue;
    const minutes = Math.round((next - nowMs) / 60_000);
    if (Math.abs(minutes) <= template.activeWindowMinutes) {
      if (template.hardBlock) {
        activeEvents.push(template.name);
      } else {
        activeWatchEvents.push(template.name);
      }
    } else if (minutes > 0 && minutes <= template.watchWindowMinutes) {
      upcomingEvents.push(`${template.name} ${minutes} dk`);
      minutesToEvents.push(minutes);
    }
  }

  if (isCryptoSymbol(symbol) && isCryptoFundingWindow(now)) {
    upcomingEvents.push("Crypto funding/liquidity reset");
  }

  const noTrade = activeEvents.length > 0;
  const level = noTrade ? "high" : activeWatchEvents.length || upcomingEvents.length ? "watch" : "clear";
  const minutesToNext = minutesToEvents.length ? Math.min(...minutesToEvents) : undefined;
  const summaryEvents = [...activeWatchEvents, ...upcomingEvents];
  const warnings = [
    ...activeEvents.map((event) => `${event} aktif: discretionary no-trade penceresi.`),
    ...activeWatchEvents.map((event) => `${event} aktif: canlı takvimle doğrula, spike riski yüksek.`),
    ...upcomingEvents.map((event) => `${event}: spread/spike riski artabilir.`)
  ];

  return {
    level,
    noTrade,
    activeEvents,
    upcomingEvents: [...activeWatchEvents, ...upcomingEvents],
    minutesToNext,
    summary: noTrade
      ? activeEvents.join(" · ")
      : summaryEvents.length
        ? summaryEvents.join(" · ")
        : "Yakın kırmızı-event riski yok.",
    warnings
  };
}
