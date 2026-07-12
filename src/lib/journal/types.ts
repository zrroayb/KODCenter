import type { MarketSymbol, QualityGrade, SignalStage, TradeDirection } from "../ict/types";

export type TradeAction = "watch" | "taken" | "skipped" | "missed";

export type JournalSignalSnapshot = {
  stage: SignalStage;
  grade: QualityGrade;
  score: number;
  rr: number;
  grossRR: number;
  entrySource: string;
  entryStatus: string;
  stopSource: string;
  targetSource: string;
  rangeTf?: string;
  confirmTf: string;
  origin?: string;
  setupPhase?: string;
  premiumDiscount: string;
  session: string;
  regime: string;
  eventRisk: string;
  dataConfidence: number;
  bias: {
    monthly: string;
    weekly: string;
    daily: string;
    h4: string;
    h1: string;
  };
  decision: string;
  invalidation?: string;
  blockers: string[];
  warnings: string[];
  checklist: Array<{ label: string; status: string }>;
  evidence: Array<{ label: string; status: string }>;
};

export type JournalEvent = {
  at: number;
  action: TradeAction;
  result: NonNullable<JournalEntry["result"]>;
  stage: SignalStage;
  score: number;
};

export type JournalEntry = {
  tradeId: string;
  setupKey?: string;
  createdAt: number;
  updatedAt: number;
  strategy: string;
  symbol: MarketSymbol;
  direction: TradeDirection;
  tradeAction?: TradeAction;
  takenAt?: number;
  closedAt?: number;
  entry?: number;
  stopLoss?: number;
  target?: number;
  actualEntry?: number;
  actualExit?: number;
  positionSize?: number;
  riskPct?: number;
  rMultiple?: number;
  exit?: number;
  result?: "open" | "win" | "loss" | "breakeven";
  emotion?: string;
  mistake?: string;
  screenshot?: string;
  notes?: string;
  outcomeNote?: string;
  executionQuality?: string;
  ruleViolations: string[];
  signalSnapshot?: JournalSignalSnapshot;
  latestSignalSnapshot?: JournalSignalSnapshot;
  history?: JournalEvent[];
};

export type JournalInsight = {
  label: string;
  value: string;
  detail: string;
};
