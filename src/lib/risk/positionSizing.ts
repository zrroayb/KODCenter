import type { MarketSymbol, QualityGrade } from "../ict/types";
import type { AccountModel } from "./accountModel";
import { riskReward } from "./riskReward";
import { SYMBOL_SPEC } from "../ict/symbolSpec";

export type PositionSizeInput = {
  account: AccountModel;
  symbol: MarketSymbol;
  entry: number;
  stopLoss: number;
  target: number;
  pointValue?: number;
  grade?: QualityGrade;
  // The minimum RR the producing strategy gates with (CRT: EQ exit RR). Defaults to the account's.
  minimumRR?: number;
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

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const spec = SYMBOL_SPEC[input.symbol];
  const pointValue = input.pointValue ?? spec?.pointValue ?? 1;
  const approximate = input.pointValue === undefined && (spec?.pointValueApprox ?? true);
  const gradeRiskFactor = input.grade ? GRADE_RISK_FACTOR[input.grade] : 1;
  const baseRisk = input.account.accountSize * (input.account.riskPerTradePct / 100);
  const riskAmount = baseRisk * gradeRiskFactor;
  const riskDistance = Math.abs(input.entry - input.stopLoss);
  const positionSize = riskDistance > 0 ? riskAmount / (riskDistance * pointValue) : 0;
  const rr = riskReward(input.entry, input.stopLoss, input.target);
  const potentialGain = Math.abs(input.target - input.entry) * pointValue * positionSize;
  const warnings: string[] = [];
  if (approximate) warnings.push("Nokta değeri yaklaşık (brokera göre değişir): boyutu 'lot' değil yaklaşık 'birim' olarak oku.");
  if (rr < (input.minimumRR ?? input.account.minimumRR)) warnings.push("Risk reward minimumun altında.");
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
