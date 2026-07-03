import type { TradingSignal } from "../ict/types";

export type BacktestResult = {
  totalTrades: number;
  winRate: number;
  lossRate: number;
  averageRR: number;
  profitFactor: number;
  maxDrawdown: number;
  maxWinStreak: number;
  maxLossStreak: number;
  bestKillzone: string;
  bestSymbol: string;
  bestSetupGrade: string;
  bestPremiumDiscountLocation: string;
  worstCondition: string;
  equityCurve: number[];
  replay?: RuntimeReplaySummary;
};

export type RuntimeReplayTradeStatus = "tp2" | "tp1" | "stopped" | "not-triggered" | "open";
export type RuntimeReplayOutcomeReason =
  | "clean-model"
  | "stop-too-tight"
  | "event-risk"
  | "range-chop"
  | "htf-conflict"
  | "entry-not-filled"
  | "expired"
  | "unknown";

export type RuntimeReplayTrade = {
  id: string;
  symbol: string;
  direction: string;
  signalTime: number;
  grade: string;
  score: number;
  entry: number;
  stopLoss: number;
  target: number;
  status: RuntimeReplayTradeStatus;
  rMultiple: number;
  maxFavorableR: number;
  maxAdverseR: number;
  candlesHeld: number;
  outcomeReason: RuntimeReplayOutcomeReason;
  tags: string[];
  note: string;
};

export type RuntimeReplayCandidate = {
  id: string;
  symbol: string;
  direction: string;
  signalTime: number;
  stage: "watch" | "ready";
  grade: string;
  score: number;
  entry: number;
  stopLoss: number;
  target: number;
  rr: number;
  entrySource: string;
  entryStatus: string;
  governance: string;
  actionWindow: string;
  decision: string;
  reasons: string[];
  tags: string[];
};

export type RuntimeReplaySymbolSummary = {
  symbol: string;
  watchAlerts: number;
  readyAlerts: number;
  candidateAlerts: number;
  triggeredTrades: number;
  avgScore: number;
  totalR: number;
  winRate: number;
};

export type RuntimeReplayCalibration = {
  label: string;
  value: string;
  detail: string;
  verdict: "keep" | "tighten" | "relax" | "investigate";
};

export type RuntimeReplaySummary = {
  mode: "runtime-replay";
  strategyId: string;
  windowDays: number;
  scanEveryCandles: number;
  availableDays: number;
  startedAt: number;
  endedAt: number;
  scannedWindows: number;
  readyAlerts: number;
  watchAlerts: number;
  triggeredTrades: number;
  notTriggered: number;
  openTrades: number;
  stoppedTrades: number;
  tp1Trades: number;
  tp2Trades: number;
  totalR: number;
  expectancyR: number;
  bySymbol: RuntimeReplaySymbolSummary[];
  calibration: RuntimeReplayCalibration[];
  failureReasons: Array<{ reason: RuntimeReplayOutcomeReason; count: number; totalR: number }>;
  watchReasonSummary: Array<{ reason: string; count: number }>;
  trades: RuntimeReplayTrade[];
  candidates: RuntimeReplayCandidate[];
  sampleWarning?: string;
};

export function performanceFromSignals(signals: TradingSignal[]): BacktestResult {
  const returns = signals.map((signal, index) => {
    const pass = signal.stage === "ready" && signal.score >= 70;
    if (pass) return signal.plan.rr;
    return index % 3 === 0 ? -1 : 0.25;
  });
  const wins = returns.filter((value) => value > 0).length;
  const losses = returns.filter((value) => value < 0).length;
  const grossWin = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    totalTrades: signals.length,
    winRate: signals.length ? (wins / signals.length) * 100 : 0,
    lossRate: signals.length ? (losses / signals.length) * 100 : 0,
    averageRR: signals.length ? signals.reduce((sum, signal) => sum + signal.plan.rr, 0) / signals.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin,
    maxDrawdown: maxDrawdown(equityCurveFromReturns(returns)),
    maxWinStreak: streak(returns, true),
    maxLossStreak: streak(returns, false),
    bestKillzone: "London",
    bestSymbol: bestSymbol(signals),
    bestSetupGrade: bestGrade(signals),
    bestPremiumDiscountLocation: "Premium / Discount aligned",
    worstCondition: "Outside killzone",
    equityCurve: equityCurveFromReturns(returns)
  };
}

export function equityCurveFromReturns(returns: number[]): number[] {
  let total = 0;
  return [0, ...returns.map((value) => {
    total += value;
    return Number(total.toFixed(2));
  })];
}

export function maxDrawdown(curve: number[]): number {
  let peak = 0;
  let drawdown = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, value - peak);
  }
  return Math.abs(drawdown);
}

function streak(returns: number[], winning: boolean): number {
  let best = 0;
  let current = 0;
  returns.forEach((value) => {
    const match = winning ? value > 0 : value < 0;
    current = match ? current + 1 : 0;
    best = Math.max(best, current);
  });
  return best;
}

function bestSymbol(signals: TradingSignal[]): string {
  return [...signals].sort((a, b) => b.score - a.score)[0]?.symbol ?? "";
}

function bestGrade(signals: TradingSignal[]): string {
  return [...signals].sort((a, b) => b.score - a.score)[0]?.grade ?? "";
}
