import type { MarketSymbol, QualityGrade } from "../ict/types";
import type { AccountModel } from "./accountModel";
import { riskReward } from "./riskReward";

export type PositionSizeInput = {
  account: AccountModel;
  symbol: MarketSymbol;
  entry: number;
  stopLoss: number;
  target: number;
  pointValue?: number;
  grade?: QualityGrade;
};

export type PositionSizeResult = {
  riskAmount: number;
  positionSize: number;
  potentialLoss: number;
  potentialGain: number;
  riskDistance: number;
  rr: number;
  approximate: boolean;
  gradeRiskFactor: number;
  warnings: string[];
};

// Size by conviction: an A+ setup earns full risk, a C setup a token size or watch-only.
// Grade already reflects how many confluences lined up, so "size by grade" becomes automatic
// instead of a note the trader has to remember.
export const GRADE_RISK_FACTOR: Record<QualityGrade, number> = {
  "A+": 1,
  A: 0.85,
  B: 0.55,
  C: 0.3,
  D: 0.15
};

const APPROX_POINT_VALUE: Record<MarketSymbol, number> = {
  XAUUSD: 100,
  NAS100: 1,
  EURUSD: 100_000,
  GBPUSD: 100_000,
  // USD-quote pairs pay 100k per lot per 1.0 move; USDJPY P&L is in JPY, so the per-lot
  // value is roughly 100k / rate (~145) converted back to USD.
  USDJPY: 700,
  AUDUSD: 100_000,
  USDCHF: 110_000,
  BTCUSD: 1,
  ETHUSD: 1,
  XRPUSD: 1,
  BNBUSD: 1,
  SOLUSD: 1
};

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const pointValue = input.pointValue ?? APPROX_POINT_VALUE[input.symbol] ?? 1;
  const approximate = input.pointValue === undefined;
  const gradeRiskFactor = input.grade ? GRADE_RISK_FACTOR[input.grade] : 1;
  const baseRisk = input.account.accountSize * (input.account.riskPerTradePct / 100);
  const riskAmount = baseRisk * gradeRiskFactor;
  const riskDistance = Math.abs(input.entry - input.stopLoss);
  const positionSize = riskDistance > 0 ? riskAmount / (riskDistance * pointValue) : 0;
  const rr = riskReward(input.entry, input.stopLoss, input.target);
  const potentialGain = Math.abs(input.target - input.entry) * pointValue * positionSize;
  const warnings: string[] = [];
  if (approximate) warnings.push("Symbol point value yaklaşık.");
  if (rr < input.account.minimumRR) warnings.push("Risk reward minimumun altında.");
  if (input.grade && gradeRiskFactor < 1) {
    const pct = (input.account.riskPerTradePct * gradeRiskFactor).toFixed(2);
    warnings.push(`${input.grade} grade: risk %${input.account.riskPerTradePct} yerine %${pct}'e düşürüldü (grade'e göre boyut).`);
  }
  if (input.account.riskPerTradePct * input.account.maxTradesPerDay > input.account.maxDailyLossPct) {
    warnings.push("Tüm izinli tradeler loss olursa daily max risk aşılır.");
  }
  if (riskDistance === 0) warnings.push("Stop loss Entry ile aynı olamaz.");
  return {
    riskAmount,
    positionSize,
    potentialLoss: riskAmount,
    potentialGain,
    riskDistance,
    rr,
    approximate,
    gradeRiskFactor,
    warnings
  };
}
