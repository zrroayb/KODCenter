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

export type SessionSetupModel =
  | "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT"
  | "ASIA_RANGE_LONDON_HIGH_SWEEP_BEARISH_CRT"
  | "ASIA_RANGE_LONDON_BULLISH_CONTINUATION"
  | "ASIA_RANGE_LONDON_BEARISH_CONTINUATION"
  | "LONDON_RANGE_NY_HIGH_SWEEP_BEARISH_CRT"
  | "LONDON_RANGE_NY_LOW_SWEEP_BULLISH_CRT"
  | "LONDON_EXPANSION_NY_BULLISH_CONTINUATION"
  | "LONDON_EXPANSION_NY_BEARISH_CONTINUATION"
  | "PDH_SESSION_SWEEP_BEARISH_CRT"
  | "PDL_SESSION_SWEEP_BULLISH_CRT"
  | "PREV_HTF_HIGH_SESSION_SWEEP_BEARISH_CRT"
  | "PREV_HTF_LOW_SESSION_SWEEP_BULLISH_CRT"
  | "NY_AM_OPEN_MANIPULATION_BULLISH_CRT"
  | "NY_AM_OPEN_MANIPULATION_BEARISH_CRT"
  | "LONDON_NY_OVERLAP_BULLISH_EXPANSION"
  | "LONDON_NY_OVERLAP_BEARISH_EXPANSION"
  | "LONDON_CLOSE_BULLISH_REVERSION"
  | "LONDON_CLOSE_BEARISH_REVERSION";

export type SessionSetupLifecycle =
  | "CANDIDATE"
  | "RANGE_BUILDING"
  | "RANGE_LOCKED"
  | "WAITING_FOR_SWEEP"
  | "SWEEP_DETECTED"
  | "WAITING_FOR_RECLAIM"
  | "RECLAIM_CONFIRMED"
  | "WAITING_FOR_DISPLACEMENT"
  | "WAITING_FOR_LTF_CONFIRMATION"
  | "CONFIRMED"
  | "ACTIVE"
  | "TARGET_1_REACHED"
  | "TARGET_2_REACHED"
  | "INVALIDATED"
  | "LATE"
  | "EXPIRED"
  | "COMPLETED";

export type SessionSetupEvent = {
  id: string;
  kind:
    | "range"
    | "sweep"
    | "reclaim"
    | "acceptance"
    | "displacement"
    | "crt"
    | "ltf-confirmation"
    | "target"
    | "invalidation";
  status: "pass" | "pending" | "fail" | "warning";
  label: string;
  detail: string;
  timestampUtc?: number;
  price?: number;
  timeframe?: Timeframe;
};

export type SessionScoreBreakdown = {
  htfAlignment: number;
  rangeQuality: number;
  liquidityLevel: number;
  sweepQuality: number;
  reclaimQuality: number;
  displacementQuality: number;
  crtQuality: number;
  ltfConfirmation: number;
  targetQuality: number;
  timingQuality: number;
  penalties: number;
};

export type SessionSetup = {
  id: string;
  setupFamily: "CRT_SESSION";
  setupModel: SessionSetupModel;
  referenceSession: SessionName | "PREVIOUS_DAY" | "PREVIOUS_HTF";
  triggerSession: SessionName;
  confirmationSession: SessionName;
  direction: TradeDirection;
  lifecycleStatus: SessionSetupLifecycle;
  grade: QualityGrade;
  score: number;
  symbol: MarketSymbol;
  timeframe: Timeframe;
  confirmationTimeframe: Timeframe;
  tradingDayId: string;
  sessionProfileId: string;
  sessionProfileVersion: string;
  detectorVersion: string;
  promptVersion: string;
  createdAt: number;
  updatedAt: number;
  referenceRangeId: string;
  referenceRange: {
    high: number;
    low: number;
    midpoint: number;
    quality: SessionRangeQuality;
    startsAt: number;
    endsAt: number;
  };
  currentPrice: number;
  sweptSide: "HIGH" | "LOW" | "NONE" | "BOTH";
  sweepTimestampUtc?: number;
  reclaimTimestampUtc?: number;
  displacementDirection?: TradeDirection;
  signalId?: string;
  plan?: TradePlan;
  htfAlignment: "strong" | "moderate" | "weak" | "conflicting";
  scoreBreakdown: SessionScoreBreakdown;
  events: SessionSetupEvent[];
  warnings: string[];
  blockers: string[];
  summary: string;
};

export type SessionSetupLog = {
  id: string;
  setupId: string;
  setupFamily: "CRT_SESSION";
  setupModel: SessionSetupModel;
  symbol: MarketSymbol;
  referenceSession: SessionSetup["referenceSession"];
  triggerSession: SessionName;
  lifecycleStatus: SessionSetupLifecycle;
  eventTimestampUtc: number;
  eventType: "CREATED" | "STATE_CHANGED" | "UPDATED";
  detail: string;
  sessionProfileVersion: string;
};

export type SessionStatistics = {
  total: number;
  developing: number;
  confirmed: number;
  invalid: number;
  averageScore: number;
  byModel: Array<{ model: SessionSetupModel; total: number; confirmed: number; averageScore: number }>;
  byReferenceTrigger: Array<{ route: string; total: number; confirmed: number }>;
};
