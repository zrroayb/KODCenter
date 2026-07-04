import type { DecisionChecklistItem, MarketContext, TradeDirection, TradePlan } from "../ict/types";
import { formatPrice, formatR } from "../ict/format";
import { isCryptoSymbol } from "../ict/symbols";
import { checklistItem } from "./decisionSummary";

export function buildChecklist(context: MarketContext, direction: TradeDirection, plan: TradePlan): DecisionChecklistItem[] {
  const expectedBias = direction === "long" ? "bullish" : "bearish";
  const usesGapEntry = plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest";
  const plannedGap = usesGapEntry ? plan.entryModel.fairValueGap : undefined;
  const gapLabel = plan.entrySource === "ifvg-retest" ? "iFVG" : "FVG";
  const smt = context.smtDivergences.find((item) => item.direction === direction);
  const mss = context.marketStructureShifts.find((item) => item.direction === direction);
  const orderBlock = [...context.orderBlocks].reverse().find((item) => item.direction === direction);
  const gapExplanation = plannedGap
    ? `${gapLabel} ${formatPrice(plannedGap.low)}-${formatPrice(plannedGap.high)} entry modeli için map edildi${plannedGap.mitigated ? "; retest/mitigation var." : "."}`
    : "Planlı FVG/iFVG yok; entry MSS/close üzerinden izleniyor.";
  return [
    checklistItem("Dealing Range", context.dealingRange.high > context.dealingRange.low ? "pass" : "fail", context.dealingRange.source),
    checklistItem("Entry Model", plan.entryStatus === "confirmed" ? "pass" : plan.entryStatus === "pending" ? "neutral" : "fail", `${plan.entrySource} ${plan.entryStatus}.`),
    checklistItem("Premium / Discount", context.premiumDiscount.zone !== "equilibrium" ? "pass" : "neutral", `Price ${context.premiumDiscount.zone} içinde.`),
    checklistItem(
      "Killzone",
      isCryptoSymbol(context.symbol) || context.killzones.some((zone) => zone.active && zone.name !== "Outside") ? "pass" : "neutral",
      isCryptoSymbol(context.symbol) ? "Crypto 24/7: session filtresi yok." : "Ana session timing kontrol edildi."
    ),
    checklistItem(
      "Judas Swing",
      isCryptoSymbol(context.symbol) || context.judasSwings.length ? "pass" : "neutral",
      isCryptoSymbol(context.symbol) ? "Crypto 24/7: Judas/session şartı yok." : "Session sweep adayı kontrol edildi."
    ),
    checklistItem("Liquidity Sweep", context.sweeps.some((sweep) => sweep.reclaimed) ? "pass" : "neutral", "Raid ve reclaim kontrol edildi."),
    checklistItem("Displacement", context.displacements.some((item) => item.direction === direction) ? "pass" : "neutral", "Directional displacement kontrol edildi."),
    checklistItem("BOS / CHOCH", mss ? "pass" : "neutral", mss ? `${(mss.kind ?? "mss").toUpperCase()} ${formatPrice(mss.level)} kırıldı.` : "Swing bazlı BOS/CHOCH kırılımı bekleniyor."),
    checklistItem("FVG", plannedGap ? (plan.entryModel.retested ? "pass" : "neutral") : "neutral", gapExplanation),
    checklistItem("Order Block", orderBlock ? (orderBlock.mitigated ? "neutral" : "pass") : "neutral", orderBlock ? `${direction} OB ${formatPrice(orderBlock.low)}-${formatPrice(orderBlock.high)}, strength ${orderBlock.strengthPct}%.` : "Swing kırılımından temiz OB teyidi yok."),
    checklistItem("Retracement", context.retracement.currentPct <= 88 ? "pass" : "neutral", context.retracement.summary),
    checklistItem("SMT", smt ? "pass" : "neutral", smt ? smt.note : "SMT pair teyidi yok veya uygun pair verisi yok."),
    checklistItem(
      "Regime",
      context.regime.tradeability === "blocked" ? "fail" : context.regime.tradeability === "caution" ? "neutral" : "pass",
      context.regime.summary
    ),
    checklistItem(
      "Event Risk",
      context.eventRisk.noTrade ? "fail" : context.eventRisk.level === "watch" ? "neutral" : "pass",
      context.eventRisk.summary
    ),
    checklistItem(
      "Data Confidence",
      context.dataConfidence.score < 35 ? "fail" : context.dataConfidence.score < 68 ? "neutral" : "pass",
      context.dataConfidence.summary
    ),
    checklistItem("RR", plan.rr >= 1.5 ? "pass" : "fail", `RR ${formatR(plan.rr)}.`),
    checklistItem(
      "Execution Cost",
      plan.executionCosts.stress === "off" ? "neutral" : plan.rr >= 1.5 ? "pass" : "neutral",
      plan.executionCosts.stress === "off"
        ? "Spread/slippage modeli kapalı."
        : `Net RR ${formatR(plan.rr)}, gross ${formatR(plan.grossRR)}, toplam maliyet ${formatPrice(plan.executionCosts.total)}.`
    ),
    checklistItem("HTF Alignment", context.bias.daily === expectedBias || context.bias.h4 === expectedBias ? "pass" : "neutral", `Daily ${context.bias.daily}, H4 ${context.bias.h4}.`)
  ];
}

export function reasoningText(context: MarketContext, direction: TradeDirection, plan: TradePlan): { shortSummary: string; fullReasoning: string } {
  const side = direction === "short" ? "Bearish" : "Bullish";
  const sweep = context.sweeps.find((item) => item.reclaimed);
  const fvg = (plan.entrySource === "fvg-retest" || plan.entrySource === "ifvg-retest") ? plan.entryModel.fairValueGap : undefined;
  const gapLabel = plan.entrySource === "ifvg-retest" ? "iFVG" : "FVG";
  const smt = context.smtDivergences.find((item) => item.direction === direction);
  const mss = context.marketStructureShifts.find((item) => item.direction === direction);
  const orderBlock = [...context.orderBlocks].reverse().find((item) => item.direction === direction);
  const stopSide = direction === "short" ? "üstüne" : "altına";
  const shortSummary = `${context.symbol} üzerinde ${side} KOD setup bulundu. RR ${formatR(plan.rr)}.`;
  const fullReasoning = [
    `${side} KOD setup bulundu.`,
    `Price aktif Dealing Range'e göre ${context.premiumDiscount.zone} içinde.`,
    sweep ? `${formatPrice(sweep.level)} seviyesindeki ${sweep.side} liquidity swept ve reclaimed oldu.` : "Liquidity sweep hâlâ gelişiyor.",
    `Daily bias ${context.bias.daily}, 4H ${context.bias.h4}, 1H ${context.bias.h1}.`,
    mss ? `${(mss.kind ?? "mss").toUpperCase()} ${formatPrice(mss.level)} swing kırılımı ile structure shift verdi.` : "Swing bazlı BOS/CHOCH henüz net değil.",
    fvg ? `${gapLabel} ${formatPrice(fvg.midpoint)} civarında entry modeli olarak map edildi.` : "Planlı FVG/iFVG yok; entry kapanış/onay modeliyle izleniyor.",
    orderBlock ? `OB referansı ${formatPrice(orderBlock.low)}-${formatPrice(orderBlock.high)}; strength ${orderBlock.strengthPct}%.` : "OB teyidi yok; tek başına hard block değil.",
    `Retracement: ${context.retracement.summary}`,
    smt ? `SMT: ${smt.note}` : "SMT teyidi yok; bu tek başına hard block değil.",
    `Rejim: ${context.regime.summary}`,
    `Event risk: ${context.eventRisk.summary}`,
    `Veri güveni: ${context.dataConfidence.summary}.`,
    `Entry ${formatPrice(plan.entry)}, SL ${formatPrice(plan.stopLoss)}, ana TP ${formatPrice(plan.targets[0])}.`,
    `Entry modeli ${plan.entrySource}; durum ${plan.entryStatus}.`,
    `Stop ${plan.stopSource} ${stopSide} ${formatPrice(plan.stopBuffer)} buffer ile kondu; risk mesafesi ${formatPrice(plan.riskDistance)}.`,
    plan.executionCosts.stress === "off"
      ? `RR ${formatR(plan.rr)} spread/slippage kapalı hesaplandı.`
      : `Spread/slippage sonrası net RR ${formatR(plan.rr)}; gross RR ${formatR(plan.grossRR)}.`
  ].join(" ");
  return { shortSummary, fullReasoning };
}
