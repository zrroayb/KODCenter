import type { Candle, MarketSymbol, QualityGrade, TradeDirection } from "../../ict/types";

// ICT Silver Bullet — NY_AM_09_HOURLY_RANGE_REVERSAL_V1 (docs/SILVER_BULLET_MASTER_INSTRUCTION.md)

export const SB_STRATEGY_PROFILE = "NY_AM_09_HOURLY_RANGE_REVERSAL_V1";
export const SB_SETUP_FAMILY = "ICT_SILVER_BULLET";
export const SB_DETECTOR_VERSION = "sb-1.0.0";

export type SilverBulletConfig = {
  displacementBodyToRangeMin: number;
  displacementBodyToAtrMin: number;
  fvgMinAtrRatio: number;
  minimumRR: number;
  breakEvenR: number;
  stopBufferAtr: number;
  acceptanceClosesOutside: number;
  maxTradesPerSymbolPerDay: number;
  lateWindowSeconds: number;
  htfBiasMode: "MECHANICAL" | "BIAS_FILTERED" | "BIAS_SCORED";
  enabledSymbols: MarketSymbol[] | "all";
};

// Initial values from references/Silver-Bullet-AM-Session (REFERENCE ONLY); all configurable.
export const SB_DEFAULT_CONFIG: SilverBulletConfig = {
  displacementBodyToRangeMin: 0.7,
  displacementBodyToAtrMin: 1.5,
  fvgMinAtrRatio: 0.3,
  minimumRR: 2.5,
  breakEvenR: 3,
  stopBufferAtr: 0.25,
  acceptanceClosesOutside: 2,
  maxTradesPerSymbolPerDay: 1,
  lateWindowSeconds: 300,
  htfBiasMode: "BIAS_SCORED",
  enabledSymbols: "all"
};

export type SbRangeQuality = "compressed" | "normal" | "expanded" | "exhausted" | "invalid";
export type SbDataQuality = "valid" | "incomplete" | "duplicate_bars" | "invalid";

export type SilverBulletReferenceRange = {
  referenceRangeId: string;
  strategyProfile: typeof SB_STRATEGY_PROFILE;
  symbol: MarketSymbol;
  tradingDayId: string;
  timezone: "America/New_York";
  startUtc: number;
  endUtc: number;
  open: number;
  high: number;
  low: number;
  close: number;
  midpoint: number;
  rangeSize: number;
  atr: number;
  rangeAtrRatio: number;
  highTimestamp: number;
  lowTimestamp: number;
  highFirst: boolean;
  quality: SbRangeQuality;
  isComplete: boolean;
  dataQuality: SbDataQuality;
  barCount: number;
};

export type SbLifecycle =
  | "PRE_REFERENCE"
  | "REFERENCE_BUILDING"
  | "REFERENCE_LOCKED"
  | "WINDOW_OPEN"
  | "WAITING_FOR_SWEEP"
  | "HIGH_SWEPT"
  | "LOW_SWEPT"
  | "BOTH_SIDES_SWEPT"
  | "WAITING_FOR_RECLAIM"
  | "RECLAIM_CONFIRMED"
  | "BREAK_ACCEPTED_OUTSIDE"
  | "WAITING_FOR_DISPLACEMENT"
  | "WAITING_FOR_STRUCTURE_SHIFT"
  | "WAITING_FOR_ENTRY_ARRAY"
  | "ORDER_PENDING"
  | "ENTRY_FILLED"
  | "ACTIVE"
  | "TARGET_1_REACHED"
  | "TARGET_2_REACHED"
  | "STOPPED"
  | "INVALIDATED"
  | "LATE"
  | "EXPIRED"
  | "NO_TRADE"
  | "COMPLETED";

export type SbSetupModel = "NY_AM_09_RANGE_HIGH_SWEEP_BEARISH_SB" | "NY_AM_09_RANGE_LOW_SWEEP_BULLISH_SB";
export type SbTriggerType = "SB_MSS_FVG" | "SB_CISD_FVG";

export type SbEvent = {
  id: string;
  kind: "reference" | "sweep" | "reclaim" | "acceptance" | "displacement" | "mss" | "cisd" | "entry-array" | "entry" | "target" | "invalidation";
  status: "pass" | "pending" | "fail" | "warning";
  label: string;
  detail: string;
  timestampUtc?: number;
  price?: number;
};

export type SbScoreBreakdown = {
  rangeQuality: number;
  sweepQuality: number;
  reclaimQuality: number;
  displacementQuality: number;
  structureQuality: number;
  entryArrayQuality: number;
  htfAlignment: number;
  targetQuality: number;
  riskReward: number;
  timingQuality: number;
  penalties: number;
};

export type SilverBulletSetup = {
  setupId: string;
  idempotencyKey: string;
  setupFamily: typeof SB_SETUP_FAMILY;
  strategyProfile: typeof SB_STRATEGY_PROFILE;
  strategyVersion: string;
  detectorVersion: string;
  symbol: MarketSymbol;
  tradingDayId: string;
  createdAtUtc: number;
  updatedAtUtc: number;
  referenceRange: SilverBulletReferenceRange;
  windowStartUtc: number;
  windowEndUtc: number;
  direction: TradeDirection | "none";
  setupModel?: SbSetupModel;
  triggerType?: SbTriggerType;
  sweep?: {
    side: "HIGH" | "LOW";
    extremePrice: number;
    timestampUtc: number;
    penetration: number;
    penetrationAtrRatio: number;
    closesOutside: number;
    reclaimed: boolean;
    reclaimTimestampUtc?: number;
  };
  bothSides: boolean;
  displacement?: { timestampUtc: number; bodyToRange: number; bodyToAtr: number; fvgCreated: boolean };
  mss?: { levelPrice: number; levelTimestampUtc: number; breakTimestampUtc: number; confirmationTimestampUtc: number };
  cisd?: { levelPrice: number; confirmationTimestampUtc: number };
  entryArray?: { type: "FVG"; top: number; bottom: number; createdAtUtc: number };
  plan?: {
    entry: number;
    stopLoss: number;
    rawSweepExtreme: number;
    stopBuffer: number;
    targets: number[];
    plannedRR: number;
    entryFilledUtc?: number;
    remainingSecondsAtEntry?: number;
  };
  lifecycleStatus: SbLifecycle;
  score: number;
  grade: QualityGrade | "reject";
  scoreBreakdown: SbScoreBreakdown;
  htfAlignment: "aligned" | "neutral" | "conflicting";
  events: SbEvent[];
  warnings: string[];
  noTradeReasons: string[];
  invalidationReasons: string[];
  lateReason?: string;
  summary: string;
};

export type SilverBulletLog = {
  id: string;
  setupId: string;
  eventNamespace: "SILVER_BULLET_SETUP";
  setupFamily: typeof SB_SETUP_FAMILY;
  strategyProfile: typeof SB_STRATEGY_PROFILE;
  symbol: MarketSymbol;
  tradingDayId: string;
  direction: TradeDirection | "none";
  statusBefore: SbLifecycle | "";
  statusAfter: SbLifecycle;
  eventType: string;
  eventTimestampUtc: number;
  reason: string;
  detectorVersion: string;
};

export type SbCandle = Candle;
