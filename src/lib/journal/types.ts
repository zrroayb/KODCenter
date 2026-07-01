import type { MarketSymbol, TradeDirection } from "../ict/types";

export type TradeAction = "watch" | "taken" | "skipped" | "missed";

export type JournalEntry = {
  tradeId: string;
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
};

export type JournalInsight = {
  label: string;
  value: string;
  detail: string;
};
