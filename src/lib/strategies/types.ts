import type { MarketContext, Timeframe, TradingSignal } from "../ict/types";
import type { BacktestResult } from "../analytics/performance";

export type StrategySettings = Record<string, number | string | boolean>;

export type StrategyInput = {
  context: MarketContext;
  settings: StrategySettings;
};

export type StrategyResult = {
  signals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
};

export type RejectedSetup = {
  symbol: string;
  strategyId: string;
  reason: string;
  score: number;
};

export type BacktestInput = {
  contexts: MarketContext[];
  settings: StrategySettings;
};

export type StrategyModule = {
  id: string;
  name: string;
  description: string;
  requiredTimeframes: Timeframe[];
  defaultSettings: StrategySettings;
  scan(input: StrategyInput): StrategyResult;
  backtest(input: BacktestInput): BacktestResult;
};
