import type { MarketSymbol } from "../ict/types";
import type { AccountModel } from "./accountModel";
import { riskReward } from "./riskReward";

export type PositionSizeInput = {
  account: AccountModel;
  symbol: MarketSymbol;
  entry: number;
  stopLoss: number;
  target: number;
  pointValue?: number;
};

export type PositionSizeResult = {
  riskAmount: number;
  positionSize: number;
  potentialLoss: number;
  potentialGain: number;
  riskDistance: number;
  rr: number;
  approximate: boolean;
  warnings: string[];
};

const APPROX_POINT_VALUE: Record<MarketSymbol, number> = {
  XAUUSD: 100,
  NAS100: 1,
  EURUSD: 100_000,
  GBPUSD: 100_000,
  BTCUSD: 1
};

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const pointValue = input.pointValue ?? APPROX_POINT_VALUE[input.symbol] ?? 1;
  const approximate = input.pointValue === undefined;
  const riskAmount = input.account.accountSize * (input.account.riskPerTradePct / 100);
  const riskDistance = Math.abs(input.entry - input.stopLoss);
  const positionSize = riskDistance > 0 ? riskAmount / (riskDistance * pointValue) : 0;
  const rr = riskReward(input.entry, input.stopLoss, input.target);
  const potentialGain = Math.abs(input.target - input.entry) * pointValue * positionSize;
  const warnings: string[] = [];
  if (approximate) warnings.push("Symbol point value yaklaşık.");
  if (rr < input.account.minimumRR) warnings.push("Risk reward minimumun altında.");
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
    warnings
  };
}
