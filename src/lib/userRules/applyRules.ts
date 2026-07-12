import type { MarketContext, TradingSignal } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";
import { effectiveMinimumScore } from "./scorePolicy";
import type { UserRules } from "./userRules";

function hasAllowedActiveKillzone(context: MarketContext, rules: UserRules): boolean {
  if (isCryptoSymbol(context.symbol)) return true;
  const active = context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  return rules.allowedKillzones.includes(active);
}

function hasAlignedHtf(signal: TradingSignal): boolean {
  const { daily, h4 } = signal.context.bias;
  if (signal.direction === "long") return daily !== "bearish" && h4 !== "bearish";
  return daily !== "bullish" && h4 !== "bullish";
}

function hasValidPremiumDiscount(signal: TradingSignal): boolean {
  const zone = signal.context.premiumDiscount.zone;
  if (zone === "equilibrium") return true;
  if (signal.direction === "long") return zone === "discount";
  return zone === "premium";
}

function hasJudasSwing(signal: TradingSignal): boolean {
  return signal.context.judasSwings.some((candidate) => candidate.direction === signal.direction);
}

export function ruleAllowsContext(context: MarketContext, rules: UserRules): boolean {
  return rules.allowedSymbols.includes(context.symbol) && hasAllowedActiveKillzone(context, rules);
}

export function ruleAllowsSignal(signal: TradingSignal, rules: UserRules): boolean {
  if (signal.stage === "invalidated" || signal.stage === "missed") return false;
  if (signal.score < effectiveMinimumScore(rules.minimumScore)) return false;
  if (signal.stage === "ready" && signal.plan.rr < rules.minimumRR) return false;
  if (rules.usePremiumDiscountFilter && !hasValidPremiumDiscount(signal)) return false;
  if (rules.useJudasSwingFilter && !hasJudasSwing(signal)) return false;
  if (rules.useHtfAlignmentFilter && !hasAlignedHtf(signal)) return false;
  return true;
}
