import type { MarketContext, TradeDirection, TradePlan } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";

export function decisionWarnings(context: MarketContext, direction: TradeDirection, plan: TradePlan, riskWarnings: string[]): string[] {
  const warnings = [...riskWarnings, ...plan.planWarnings];
  if (plan.entryStatus !== "confirmed") warnings.push(`Entry modeli ${plan.entryStatus}: ${plan.entrySource}. READY için retest + MSS/CISD gerekli.`);
  if (context.premiumDiscount.zone === "equilibrium") warnings.push("Entry equilibrium'a yakın.");
  const mss = context.marketStructureShifts.find((item) => item.direction === direction);
  if (mss?.kind === "choch") warnings.push("Structure CHOCH: reversal teyidi var ama continuation kadar temiz değil; retest disiplini şart.");
  const orderBlock = [...context.orderBlocks].reverse().find((item) => item.direction === direction);
  if (orderBlock?.mitigated) warnings.push("Order block daha önce mitigated olmuş; reaction kalitesi düşük olabilir.");
  if (context.retracement.currentPct > 88) warnings.push(`Retracement çok derin (${context.retracement.currentPct.toFixed(1)}%); chase/late-entry riski var.`);
  const plannedGap = (plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest") ? plan.entryModel.fairValueGap : undefined;
  if (plannedGap?.mitigated) {
    warnings.push(`${plan.entrySource === "ifvg-retest" ? "iFVG" : "FVG"} plan zone kısmen mitigated olmuş.`);
  }
  if (!isCryptoSymbol(context.symbol) && context.killzones.every((zone) => !zone.active || zone.name === "Outside")) {
    warnings.push("Setup ana Killzone dışında oluştu.");
  }
  warnings.push(...context.regime.warnings);
  warnings.push(...context.eventRisk.warnings);
  warnings.push(...context.dataConfidence.warnings);
  const bias = direction === "long" ? "bullish" : "bearish";
  if (context.bias.daily !== bias) warnings.push(`Daily bias ${context.bias.daily}, güçlü ${bias} değil.`);
  if (plan.executionCosts.stress !== "off" && plan.grossRR >= 1.5 && plan.rr < 1.5) {
    warnings.push("Gross RR yeterli görünse de spread/slippage sonrası net RR yetersiz.");
  }
  if (plan.rr < 1.5) warnings.push("RR minimumun altında.");
  return Array.from(new Set(warnings));
}

export function invalidationText(direction: TradeDirection, plan: TradePlan): string[] {
  return [
    direction === "short"
      ? `Short setup ${plan.invalidation.toFixed(2)} üstünde invalid olur.`
      : `Long setup ${plan.invalidation.toFixed(2)} altında invalid olur.`
  ];
}
