import type { MarketContext, TradingSignal } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";
import { effectiveMinimumScore } from "./scorePolicy";
import type { UserRules } from "./userRules";

function hasAllowedActiveKillzone(context: MarketContext, rules: UserRules): boolean {
  if (isCryptoSymbol(context.symbol)) return true;
  const active = context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  return rules.allowedKillzones.includes(active);
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
  // HTF kapısı BİLEREK burada değil: stratejide (crt.strategy readyEligible + blockers) duruyor,
  // çünkü yalnız orada `reversalAtExternalHtf` istisnası var — haftalık/aylık external likidite
  // süpürülmüş dönüş setup'ları veto edilmez, boyutu küçültülür (owner kuralı, USDCHF vakası).
  // Burada tekrar uygulamak (a) o istisnayı sessizce delerdi, (b) aynı şeyi iki kez kapıya
  // koyup watch listesini boğardı — ölçüm: 18 görünür sinyalin 12'si kaybolyordu.
  return true;
}
