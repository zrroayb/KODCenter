import type { MarketSymbol } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";
import type { SessionName, SessionProfile, SessionWindowConfig } from "./types";

const disabled: SessionWindowConfig = {
  timezone: "UTC",
  start: "00:00",
  end: "00:00",
  enabled: false
};

const marketSessions: Record<SessionName, SessionWindowConfig> = {
  ASIA: {
    timezone: "America/New_York",
    start: "19:00",
    end: "00:00",
    enabled: true,
    strategyWindow: "ASIA_RANGE"
  },
  LONDON: {
    timezone: "Europe/London",
    start: "07:00",
    end: "10:00",
    enabled: true,
    strategyWindow: "LONDON_KILL_ZONE"
  },
  NY_AM: {
    timezone: "America/New_York",
    start: "08:00",
    end: "12:00",
    enabled: true,
    strategyWindow: "NY_AM_KILL_ZONE"
  },
  NY_PM: {
    timezone: "America/New_York",
    start: "13:30",
    end: "16:00",
    enabled: true,
    strategyWindow: "NY_PM"
  },
  LONDON_CLOSE: {
    timezone: "Europe/London",
    start: "15:00",
    end: "17:00",
    enabled: false,
    strategyWindow: "LONDON_CLOSE"
  },
  LONDON_NY_OVERLAP: {
    timezone: "America/New_York",
    start: "08:00",
    end: "10:00",
    enabled: false,
    strategyWindow: "OVERLAP"
  },
  CUSTOM: disabled
};

const cryptoSessions: Record<SessionName, SessionWindowConfig> = {
  ...marketSessions,
  ASIA: { ...marketSessions.ASIA, enabled: true },
  LONDON: { ...marketSessions.LONDON, enabled: true },
  NY_AM: { ...marketSessions.NY_AM, enabled: true },
  NY_PM: { ...marketSessions.NY_PM, enabled: true }
};

function assetClass(symbol: MarketSymbol): SessionProfile["assetClass"] {
  if (isCryptoSymbol(symbol)) return "crypto";
  if (symbol === "NAS100") return "index";
  if (symbol === "XAUUSD") return "metal";
  return "fx";
}

export function sessionProfileForSymbol(symbol: MarketSymbol): SessionProfile {
  const kind = assetClass(symbol);
  return {
    profileId: `${symbol.toLowerCase()}_default_v1`,
    version: "1.0.0",
    symbolPatterns: [symbol],
    assetClass: kind,
    timezoneStorage: "UTC",
    sessions: kind === "crypto" ? cryptoSessions : marketSessions
  };
}

export const SESSION_PROFILE_VERSION = "1.0.0";
