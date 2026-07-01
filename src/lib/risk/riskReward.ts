export function riskReward(entry: number, stopLoss: number, target: number): number {
  const risk = Math.abs(entry - stopLoss);
  if (risk === 0) return 0;
  return Math.abs(target - entry) / risk;
}
