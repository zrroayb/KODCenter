import type { MarketSymbol, QualityGrade, Timeframe, TradeDirection, TradePlan } from "../ict/types";

export type SessionName =
  | "ASIA"
  | "LONDON"
  | "NY_AM"
  | "NY_PM"
  | "LONDON_CLOSE"
  | "LONDON_NY_OVERLAP"
  | "CUSTOM";

export type SessionRangeState = "SCHEDULED" | "BUILDING" | "LOCKED" | "EXPIRED";
export type SessionRangeQuality = "too-narrow" | "normal" | "wide" | "unknown";

export type SessionWindowConfig = {
  timezone: string;
  start: string;
  end: string;
  enabled: boolean;
  strategyWindow?: string;
};

export type SessionProfile = {
  profileId: string;
  version: string;
  symbolPatterns: string[];
  assetClass: "fx" | "index" | "metal" | "crypto";
  timezoneStorage: "UTC";
  sessions: Record<SessionName, SessionWindowConfig>;
};

export type SessionOccurrence = {
  id: string;
  session: SessionName;
  profileId: string;
  profileVersion: string;
  timezone: string;
  localDate: string;
  tradingDayId: string;
  startsAt: number;
  endsAt: number;
  dstUncertain: boolean;
};

export type SessionRange = SessionOccurrence & {
  state: SessionRangeState;
  high?: number;
  low?: number;
  midpoint?: number;
  open?: number;
  close?: number;
  highTime?: number;
  lowTime?: number;
  candleCount: number;
  size?: number;
  medianSize?: number;
  quality: SessionRangeQuality;
  lockedAt?: number;
  expiresAt: number;
};
