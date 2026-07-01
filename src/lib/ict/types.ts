export type Timeframe = "1M" | "1w" | "1d" | "4h" | "1h" | "15m" | "5m";
export type ICTBias = "bullish" | "bearish" | "neutral";
export type TradeDirection = "long" | "short";
export type SignalStage = "watch" | "ready" | "invalidated" | "missed";
export type QualityGrade = "A+" | "A" | "B" | "C" | "D";

export type MarketSymbol = "XAUUSD" | "NAS100" | "EURUSD" | "GBPUSD" | "BTCUSD";

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

export type PremiumDiscountContext = {
  zone: "premium" | "discount" | "equilibrium";
  positionPct: number;
  midpoint: number;
};

export type Killzone = {
  name: "Asia" | "London" | "New York AM" | "New York PM" | "Outside";
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
};

export type FairValueGap = {
  direction: TradeDirection;
  low: number;
  high: number;
  midpoint: number;
  candleIndex: number;
  mitigated: boolean;
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

export type StopSource = "sweep" | "fvg" | "swing" | "volatility-floor";
export type TargetSource = "dealing-range" | "liquidity" | "projection";
export type ExecutionCostStress = "off" | "normal" | "high";
export type EntrySource = "fvg-retest" | "ifvg-retest" | "mss-close" | "fallback-close";
export type EntryStatus = "confirmed" | "pending" | "fallback";

export type MarketContext = {
  symbol: MarketSymbol;
  timeframes: {
    daily: Candle[];
    h4: Candle[];
    h1: Candle[];
    m15: Candle[];
    m5: Candle[];
  };
  bias: {
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
  judasSwings: JudasSwing[];
  displacements: Displacement[];
  marketStructureShifts: MarketStructureShift[];
  fairValueGaps: FairValueGap[];
  smtDivergences: SmtDivergence[];
  volatility: VolatilityContext;
  dataFeed: {
    source: "broker-bid-ask" | "synthetic-bid-ask" | "mid-only" | "demo";
    executionPrice: "bid-ask" | "mid";
    note: string;
  };
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
};
