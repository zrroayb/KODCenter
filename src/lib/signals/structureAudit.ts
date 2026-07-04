import { selectedSignalAnnotations } from "../charts/selectedSignal";
import { formatPrice, formatR } from "../ict/format";
import type { Sweep, TradingSignal } from "../ict/types";
import { closeConfirmationRequirement, entryRetestRequirement } from "./waitingGuidance";

export type StructureAuditStatus = "pass" | "wait" | "warn" | "fail";

export type StructureAuditItem = {
  label: string;
  status: StructureAuditStatus;
  detail: string;
};

export type StructureAudit = {
  verdict: "ready" | "watch" | "blocked" | "done";
  headline: string;
  decision: string;
  items: StructureAuditItem[];
  simpleFacts: string[];
};

function expectedSweepSide(signal: TradingSignal): Sweep["side"] {
  return signal.direction === "short" ? "buy-side" : "sell-side";
}

function directionText(signal: TradingSignal) {
  return signal.direction === "long" ? "yukarı" : "aşağı";
}

function expectedPdZone(signal: TradingSignal) {
  return signal.direction === "long" ? "discount" : "premium";
}

function firstUsefulWait(items: StructureAuditItem[]) {
  return items.find((item) => item.status === "fail" || item.status === "wait" || item.status === "warn")?.detail;
}

function structureVerdict(signal: TradingSignal): StructureAudit["verdict"] {
  if (signal.stage === "invalidated") return "blocked";
  if (signal.stage === "missed") return "done";
  if (signal.stage === "ready") return "ready";
  return "watch";
}

export function buildStructureAudit(signal: TradingSignal): StructureAudit {
  const annotations = selectedSignalAnnotations(signal);
  const closeRequirement = closeConfirmationRequirement(signal);
  const retestRequirement = entryRetestRequirement(signal);
  const expectedSweep = expectedSweepSide(signal);
  const expectedZone = expectedPdZone(signal);
  const plannedGap = (signal.plan.entrySource === "fvg-retest" || signal.plan.entrySource === "ifvg-retest")
    ? signal.plan.entryModel.fairValueGap
    : undefined;
  const mss = annotations.marketStructureShift;
  const sweep = annotations.sweep;
  const stageVerdict = structureVerdict(signal);
  const orderBlock = [...signal.context.orderBlocks].reverse().find((item) => item.direction === signal.direction);

  const items: StructureAuditItem[] = [
    {
      label: "Liquidity",
      status: sweep?.side === expectedSweep && sweep.reclaimed ? "pass" : "wait",
      detail: sweep?.side === expectedSweep && sweep.reclaimed
        ? `${expectedSweep} sweep alındı ve reclaim var: ${formatPrice(sweep.level)}.`
        : `${expectedSweep} sweep + reclaim netleşmeden model hazır sayılmaz.`
    },
    {
      label: "MSS/CISD",
      status: signal.plan.entryModel.cisdConfirmed || mss ? "pass" : "wait",
      detail: signal.plan.entryModel.cisdConfirmed || mss
        ? `Yön değişimi ${directionText(signal)} tarafa ${(mss?.kind ?? "MSS").toString().toUpperCase()} ile onaylı${mss ? `: ${formatPrice(mss.level)}` : "."}`
        : closeRequirement
          ? `${closeRequirement.label} kapanışı bekleniyor. Sebep: ${closeRequirement.reason}`
          : `15m mum ${directionText(signal)} tarafa kapanış vermeli.`
    },
    {
      label: "Entry",
      status: signal.plan.entryStatus === "confirmed" ? "pass" : "wait",
      detail: signal.plan.entryStatus === "confirmed"
        ? `Entry onaylı: ${formatPrice(signal.plan.entry)} (${signal.plan.entrySource}).`
        : retestRequirement ?? `Fiyat ${formatPrice(signal.plan.entry)} giriş alanına gelip kapanış onayı vermeli.`
    },
    {
      label: "FVG/iFVG",
      status: plannedGap ? "pass" : signal.plan.entrySource === "fvg-retest" || signal.plan.entrySource === "ifvg-retest" ? "fail" : "warn",
      detail: plannedGap
        ? `Planlı ${signal.plan.entrySource} alanı: ${formatPrice(plannedGap.low)} - ${formatPrice(plannedGap.high)}.`
        : "Bu plan FVG/iFVG kullanmıyor; chart yorumunda FVG varmış gibi konuşma."
    },
    {
      label: "PD",
      status: signal.context.premiumDiscount.zone === expectedZone ? "pass" : "warn",
      detail: signal.context.premiumDiscount.zone === expectedZone
        ? `${expectedZone} bölge uygun.`
        : `PD ${signal.context.premiumDiscount.zone}; ideal bölge ${expectedZone}.`
    },
    {
      label: "Risk",
      status: signal.stage === "invalidated" || signal.outcome.status === "stopped" ? "fail" : signal.plan.rr >= 1.5 ? "pass" : "wait",
      detail: `RR ${formatR(signal.plan.rr)} · Stop ${formatPrice(signal.plan.stopLoss)} · TP1 ${formatPrice(signal.plan.targets[0])}.`
    },
    {
      label: "OB/Ret",
      status: signal.context.retracement.currentPct > 88 ? "warn" : "pass",
      detail: orderBlock
        ? `OB ${formatPrice(orderBlock.low)}-${formatPrice(orderBlock.high)} · retracement ${signal.context.retracement.currentPct.toFixed(1)}%.`
        : `OB teyidi yok; retracement ${signal.context.retracement.currentPct.toFixed(1)}%.`
    }
  ];

  const headline =
    stageVerdict === "ready"
      ? "Hazır: plan ve risk belli."
      : stageVerdict === "blocked"
        ? "Bozuldu: artık işlem yok."
        : stageVerdict === "done"
          ? "Geç kaldı: kovalamıyoruz."
          : "Bekle: henüz onay eksik.";

  const decision =
    stageVerdict === "ready"
      ? `Plan: entry ${formatPrice(signal.plan.entry)}, stop ${formatPrice(signal.plan.stopLoss)}, TP1 ${formatPrice(signal.plan.targets[0])}.`
      : stageVerdict === "blocked"
        ? "Stop/invalidation görülmüş; yeni setup bekle."
        : stageVerdict === "done"
          ? "Entry veya hedef kaçmış; yeni model bekle."
          : firstUsefulWait(items) ?? "READY olmadan trade alma.";

  return {
    verdict: stageVerdict,
    headline,
    decision,
    items,
    simpleFacts: [
      `${signal.symbol} ${signal.direction.toUpperCase()} · ${signal.stage.toUpperCase()} · ${signal.grade}`,
      decision,
      `Risk: ${formatR(signal.plan.rr)} · SL ${formatPrice(signal.plan.stopLoss)} · TP1 ${formatPrice(signal.plan.targets[0])}`
    ]
  };
}
