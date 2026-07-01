import type { MarketContext, TradeDirection, TradePlan } from "../ict/types";
import { isCryptoSymbol } from "../ict/symbols";
import type { Rule, RuleResult } from "./ruleTypes";

function result(passed: boolean, reason: string, scoreImpact = 10): RuleResult {
  return { passed, reason, scoreImpact: passed ? scoreImpact : -scoreImpact };
}

export function PriceInPremiumCondition(direction: TradeDirection): Rule<MarketContext> {
  return {
    id: "price-in-premium-discount",
    label: "Premium / Discount",
    evaluate: (context) => {
      const valid = direction === "short" ? context.premiumDiscount.zone === "premium" : context.premiumDiscount.zone === "discount";
      return result(valid, `Price ${context.premiumDiscount.zone} içinde.`);
    }
  };
}

export function LiquiditySweptCondition(direction: TradeDirection): Rule<MarketContext> {
  return {
    id: "liquidity-swept",
    label: "Liquidity Sweep",
    evaluate: (context) => {
      const side = direction === "short" ? "buy-side" : "sell-side";
      const sweep = context.sweeps.find((item) => item.side === side && item.reclaimed);
      return result(Boolean(sweep), sweep ? `${side} swept ve reclaimed.` : `${side} sweep henüz reclaimed değil.`);
    }
  };
}

export function DisplacementCondition(direction: TradeDirection): Rule<MarketContext> {
  return {
    id: "displacement",
    label: "Displacement",
    evaluate: (context) => result(context.displacements.some((item) => item.direction === direction), "Displacement candle kontrol edildi.")
  };
}

export function MssCondition(direction: TradeDirection): Rule<MarketContext> {
  return {
    id: "mss",
    label: "MSS",
    evaluate: (context) => result(context.marketStructureShifts.some((item) => item.direction === direction), "Market structure shift kontrol edildi.")
  };
}

export function FvgCondition(direction: TradeDirection, plan?: TradePlan): Rule<MarketContext> {
  return {
    id: "fvg",
    label: "FVG",
    evaluate: (context) => {
      if (plan) {
        const usesGapEntry = plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest";
        const gap = usesGapEntry ? plan.entryModel.fairValueGap : undefined;
        const gapLabel = plan.entrySource === "ifvg-retest" ? "iFVG" : "FVG";
        return result(
          Boolean(gap),
          gap
            ? `${gapLabel} plan entry olarak map edildi.`
            : "Planlı FVG/iFVG yok; entry MSS/close fallback üzerinden.",
          6
        );
      }
      return result(context.fairValueGaps.some((item) => item.direction === direction), "Fair Value Gap kontrol edildi.");
    }
  };
}

export function SmtCondition(direction: TradeDirection): Rule<MarketContext> {
  return {
    id: "smt",
    label: "SMT",
    evaluate: (context) => {
      const smt = context.smtDivergences.find((item) => item.direction === direction);
      return {
        passed: Boolean(smt),
        reason: smt ? smt.note : "SMT divergence teyidi yok.",
        scoreImpact: smt ? 4 : 0
      };
    }
  };
}

export function KillzoneCondition(): Rule<MarketContext> {
  return {
    id: "killzone",
    label: "Killzone",
    evaluate: (context) => {
      if (isCryptoSymbol(context.symbol)) return result(true, "Crypto 24/7: session filtresi yok.", 0);
      return result(context.killzones.some((item) => item.active && item.name !== "Outside"), "Killzone context kontrol edildi.", 6);
    }
  };
}

export function RiskRewardCondition(rr: number, minimumRR: number): Rule<MarketContext> {
  return {
    id: "risk-reward",
    label: "RR",
    evaluate: () => result(rr >= minimumRR, `RR ${rr.toFixed(2)}, minimum ${minimumRR}.`)
  };
}
