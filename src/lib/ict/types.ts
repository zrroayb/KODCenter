export type Timeframe = "1M" | "1w" | "1d" | "4h" | "1h" | "15m" | "5m";
export type ICTBias = "bullish" | "bearish" | "neutral";
export type TradeDirection = "long" | "short";
export type SignalStage = "watch" | "ready" | "invalidated" | "missed";
export type QualityGrade = "A+" | "A" | "B" | "C" | "D";

export type MarketSymbol =
  | "XAUUSD"
  | "NAS100"
  | "EURUSD"
  | "GBPUSD"
  | "USDJPY"
  | "AUDUSD"
  | "USDCHF"
  | "BTCUSD"
  | "ETHUSD"
  | "XRPUSD"
  | "BNBUSD"
  | "SOLUSD";

export type Ohlc = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed?: boolean;
  mid?: Ohlc;
  bid?: Ohlc;
  ask?: Ohlc;
  priceComponent?: "mid" | "bid" | "ask";
  feed?: "broker-bid-ask" | "synthetic-bid-ask" | "mid-only" | "demo";
};

export type DealingRange = {
  high: number;
  low: number;
  midpoint: number;
  source: string;
};

export type CrtBiasKind = "bullish-continuation" | "bearish-continuation" | "bullish-reversal" | "bearish-reversal" | "neutral";

export type CrtBiasContext = {
  timeframe: Extract<Timeframe, "1M" | "1w" | "1d" | "4h">;
  kind: CrtBiasKind;
  direction: TradeDirection | "neutral";
  drawLevel: number;
  drawSide: "buy-side" | "sell-side" | "none";
  rangeHigh: number;
  rangeLow: number;
  midpoint: number;
  previousHigh?: number;
  previousLow?: number;
  currentHigh?: number;
  currentLow?: number;
  strength: "strong" | "moderate" | "weak";
  summary: string;
};

export type CrtPoi = {
  type: "fvg" | "ob" | "breaker" | "ote";
  direction: TradeDirection;
  low: number;
  high: number;
  midpoint: number;
  candleIndex?: number;
  mitigated: boolean;
  label: string;
};

export type CrtContext = {
  rangeTimeframe: Extract<Timeframe, "1M" | "1w" | "1d" | "4h">;
  activeRange: DealingRange;
  selectedBias: CrtBiasContext;
  macroBiases: CrtBiasContext[];
  validPullback: boolean;
  pullbackSummary: string;
  pois: CrtPoi[];
};

export type PremiumDiscountContext = {
  zone: "premium" | "discount" | "equilibrium";
  positionPct: number;
  midpoint: number;
};

export type Killzone = {
  name: "Asia" | "London" | "New York AM" | "London Close" | "Outside";
  active: boolean;
  startHourUtc: number;
  endHourUtc: number;
};

export type LiquidityPool = {
  id: string;
  side: "buy-side" | "sell-side";
  level: number;
  label: string;
  strength: "weak" | "moderate" | "strong";
};

export type LiquidityObjectiveKind = "PDH" | "PDL" | "PWH" | "PWL" | "PMH" | "PML" | "DRH" | "DRL";

export type LiquidityObjective = {
  id: string;
  kind: LiquidityObjectiveKind;
  side: "buy-side" | "sell-side";
  level: number;
  label: string;
  timeframe: Timeframe;
  source: string;
  strength: "weak" | "moderate" | "strong";
};

export type Sweep = {
  side: "buy-side" | "sell-side";
  level: number;
  candleIndex: number;
  reclaimed: boolean;
};

export type SwingPoint = {
  side: "high" | "low";
  level: number;
  candleIndex: number;
  strength: "minor" | "major";
};

export type JudasSwing = {
  direction: TradeDirection;
  session: string;
  sweepLevel: number;
};

export type Displacement = {
  direction: TradeDirection;
  candleIndex: number;
  bodyRatio: number;
  rangeAtr: number;
};

export type MarketStructureShift = {
  direction: TradeDirection;
  level: number;
  candleIndex: number;
  kind?: "bos" | "choch" | "mss";
  brokenIndex?: number;
};

export type FairValueGap = {
  direction: TradeDirection;
  low: number;
  high: number;
  midpoint: number;
  candleIndex: number;
  mitigated: boolean;
  mitigatedIndex?: number;
};

export type OrderBlock = {
  direction: TradeDirection;
  low: number;
  high: number;
  midpoint: number;
  candleIndex: number;
  mitigated: boolean;
  mitigatedIndex?: number;
  volumeScore: number;
  strengthPct: number;
};

export type RetracementContext = {
  direction: "bullish" | "bearish" | "neutral";
  currentPct: number;
  deepestPct: number;
  swingHigh?: number;
  swingLow?: number;
  summary: string;
};

export type SmtDivergence = {
  partner: MarketSymbol;
  direction: TradeDirection;
  side: "buy-side" | "sell-side";
  candleIndex: number;
  time: number;
  localLevel: number;
  partnerLevel: number;
  localExtreme: number;
  partnerExtreme: number;
  note: string;
};

export type VolatilityContext = {
  atr: number;
  averageRange: number;
};

export type MarketRegimeType = "trend" | "range" | "chop" | "news-expansion" | "post-sweep-continuation";

export type MarketRegimeContext = {
  type: MarketRegimeType;
  tradeability: "good" | "caution" | "blocked";
  scoreImpact: number;
  efficiency: number;
  volatilityRatio: number;
  rangePosition: "upper" | "middle" | "lower";
  summary: string;
  warnings: string[];
};

export type EventRiskLevel = "clear" | "watch" | "high";

export type EventRiskContext = {
  level: EventRiskLevel;
  noTrade: boolean;
  activeEvents: string[];
  upcomingEvents: string[];
  minutesToNext?: number;
  summary: string;
  warnings: string[];
};

export type DataConfidenceGrade = "A" | "B" | "C" | "D";

export type DataConfidenceContext = {
  score: number;
  grade: DataConfidenceGrade;
  stale: boolean;
  source: "broker-bid-ask" | "synthetic-bid-ask" | "mid-only" | "demo";
  summary: string;
  warnings: string[];
};

export type StopSource = "sweep" | "fvg" | "swing" | "manipulation" | "volatility-floor";
export type TargetSource = "dealing-range" | "liquidity" | "crt-dol" | "equilibrium" | "projection";
export type ExecutionCostStress = "off" | "normal" | "high";
export type EntrySource = "fvg-retest" | "ifvg-retest" | "mss-close" | "choch-close" | "poi-retest" | "turtle-soup-open" | "fallback-close";
export type EntryStatus = "confirmed" | "pending" | "fallback";

export type MarketContext = {
  symbol: MarketSymbol;
  timeframes: {
    monthly: Candle[];
    weekly: Candle[];
    daily: Candle[];
    h4: Candle[];
    h1: Candle[];
    m15: Candle[];
    m5: Candle[];
  };
  bias: {
    monthly: ICTBias;
    weekly: ICTBias;
    daily: ICTBias;
    h4: ICTBias;
    h1: ICTBias;
  };
  dealingRange: DealingRange;
  premiumDiscount: PremiumDiscountContext;
  killzones: Killzone[];
  liquidityPools: LiquidityPool[];
  liquidityObjectives: LiquidityObjective[];
  sweeps: Sweep[];
  swingPoints: SwingPoint[];
  judasSwings: JudasSwing[];
  displacements: Displacement[];
  marketStructureShifts: MarketStructureShift[];
  fairValueGaps: FairValueGap[];
  orderBlocks: OrderBlock[];
  retracement: RetracementContext;
  smtDivergences: SmtDivergence[];
  volatility: VolatilityContext;
  regime: MarketRegimeContext;
  eventRisk: EventRiskContext;
  dataConfidence: DataConfidenceContext;
  dataFeed: {
    source: "broker-bid-ask" | "synthetic-bid-ask" | "mid-only" | "demo";
    executionPrice: "bid-ask" | "mid";
    note: string;
  };
  crt: CrtContext;
};

export type TradePlan = {
  entry: number;
  entrySource: EntrySource;
  entryStatus: EntryStatus;
  entryModel: {
    source: EntrySource;
    status: EntryStatus;
    level: number;
    retested: boolean;
    cisdConfirmed: boolean;
    fairValueGap?: FairValueGap;
    warnings: string[];
  };
  stopLoss: number;
  targets: number[];
  invalidation: number;
  rr: number;
  grossRR: number;
  riskDistance: number;
  stopSource: StopSource;
  stopBuffer: number;
  targetSource: TargetSource;
  executionCosts: {
    stress: ExecutionCostStress;
    spread: number;
    slippage: number;
    commission: number;
    total: number;
    grossReward: number;
    netReward: number;
    riskAfterCosts: number;
  };
  planWarnings: string[];
};

export type DecisionChecklistItem = {
  label: string;
  status: "pass" | "fail" | "neutral";
  explanation: string;
};

export type DecisionSummary = {
  shortSummary: string;
  fullReasoning: string;
  checklist: DecisionChecklistItem[];
  warnings: string[];
  invalidation: string[];
  confidence: number;
};

export type SignalEvidenceItem = {
  id: string;
  label: string;
  status: DecisionChecklistItem["status"] | "warning";
  detail: string;
  timeframe?: Timeframe;
  candleIndex?: number;
  time?: number;
  price?: number;
  metadata?: Record<string, string | number | boolean | undefined>;
};

export type SignalOutcomeStatus = "not-triggered" | "open" | "tp1" | "tp2" | "stopped" | "missed";

export type SignalOutcome = {
  status: SignalOutcomeStatus;
  entryTouched: boolean;
  entryCandleIndex?: number;
  exitCandleIndex?: number;
  maxFavorableR: number;
  maxAdverseR: number;
  candlesTracked: number;
  summary: string;
};

export type SignalGovernance = {
  status: "allow" | "caution" | "block";
  scoreImpact: number;
  blockers: string[];
  warnings: string[];
  checklist: DecisionChecklistItem[];
  summary: string;
};

export type SignalActionWindow = {
  status: "valid" | "waiting" | "expired" | "inactive";
  candlesRemaining: number;
  validUntil?: number;
  summary: string;
};

export type TradingSignal = {
  id: string;
  strategyId: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  stage: SignalStage;
  grade: QualityGrade;
  score: number;
  createdAt: number;
  timeframe: Timeframe;
  plan: TradePlan;
  context: MarketContext;
  decisionSummary: DecisionSummary;
  evidence: SignalEvidenceItem[];
  riskWarnings: string[];
  outcome: SignalOutcome;
  governance: SignalGovernance;
  actionWindow: SignalActionWindow;
  crtAnchor?: CrtAnchorInfo;
};

export type CrtAnchorInfo = {
  rangeTf: Timeframe;
  confirmTf: Timeframe;
  raidActive: boolean;
  raidClosed: boolean;
  rangeHigh: number;
  rangeLow: number;
  origin?: "standard" | "fvg-origin" | "active-crt";
  originLabel?: string;
  setupPhase?: "context" | "raid" | "model" | "ready";
};
