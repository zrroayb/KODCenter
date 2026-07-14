import { selectedSignalAnnotations, signalConfirmTimeframe } from "../charts/selectedSignal";
import { formatPrice, formatR } from "../ict/format";
import type { Sweep, TradingSignal } from "../ict/types";
import { signalDecisionClass } from "./signalClassification";
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

function firstUsefulWait(items: StructureAuditItem[]) {
  return items.find((item) => item.status === "fail" || item.status === "wait" || item.status === "warn")?.detail;
}

function structureVerdict(signal: TradingSignal): StructureAudit["verdict"] {
  if (signal.stage === "invalidated" || signalDecisionClass(signal) === "invalid") return "blocked";
  if (signal.stage === "missed") return "done";
  if (signal.stage === "ready") return "ready";
  return "watch";
}

export function buildStructureAudit(signal: TradingSignal): StructureAudit {
  const annotations = selectedSignalAnnotations(signal);
  const closeRequirement = closeConfirmationRequirement(signal);
  const retestRequirement = entryRetestRequirement(signal);
  const expectedSweep = expectedSweepSide(signal);
  const plannedGap = signal.plan.entryModel.fairValueGap;
  const mss = annotations.marketStructureShift;
  const stageVerdict = structureVerdict(signal);
  const manipulationEvidence = signal.evidence.find((item) => item.id === "manipulation");

  const items: StructureAuditItem[] = [
    {
      label: "CRT Range",
      status: signal.crtAnchor?.originClosed === false ? "wait" : "pass",
      detail: `${(signal.crtAnchor?.rangeTf ?? "4h").toUpperCase()} range ${formatPrice(signal.crtAnchor?.rangeLow ?? signal.context.crt.activeRange.low)} - ${formatPrice(signal.crtAnchor?.rangeHigh ?? signal.context.crt.activeRange.high)}.`
    },
    {
      label: "Manipulation",
      status: manipulationEvidence?.status === "pass" ? "pass" : "wait",
      detail: manipulationEvidence?.status === "pass"
        ? manipulationEvidence.detail
        : `${expectedSweep} tarafındaki CRT kenarı wick ile alınmalı; HTF mum kapanışı beklenmez.`
    },
    {
      label: "Distribution",
      status: signal.plan.entryModel.cisdConfirmed || mss ? "pass" : "wait",
      detail: signal.plan.entryModel.cisdConfirmed || mss
        ? `Dağılım ${directionText(signal)} tarafa iç yapı kapanışıyla başladı${mss ? `: ${formatPrice(mss.level)}` : "."}`
        : closeRequirement
          ? `${closeRequirement.label} kapanışı bekleniyor.`
          : `${signalConfirmTimeframe(signal)} mum ${directionText(signal)} tarafa kapanış vermeli.`
    },
    {
      label: "Entry",
      status: signal.plan.entryStatus === "confirmed" ? "pass" : "wait",
      detail: signal.plan.entryStatus === "confirmed"
        ? `Entry onaylı: ${formatPrice(signal.plan.entry)} (${signal.plan.entrySource}).`
        : retestRequirement ?? "Dağılım kapanışı gelmeden entry yok."
    },
    {
      label: "POI",
      status: plannedGap || signal.plan.entryModel.retested ? "pass" : "warn",
      detail: plannedGap
        ? `Ek kalite: ${formatPrice(plannedGap.low)} - ${formatPrice(plannedGap.high)} POI.`
        : "POI teması yok; bu yalnızca kalite bonusu. Chart yorumunda zone varmış gibi konuşma."
    },
    {
      label: "Risk",
      status: signal.stage === "invalidated" || signal.outcome.status === "stopped" ? "fail" : signal.plan.rr >= 1.5 ? "pass" : "wait",
      detail: `RR ${formatR(signal.plan.rr)} · Stop ${formatPrice(signal.plan.stopLoss)} · EQ/TP1 ${formatPrice(signal.plan.targets[0])} · DOL/TP2 ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}.`
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
      ? `Plan: entry ${formatPrice(signal.plan.entry)}, stop ${formatPrice(signal.plan.stopLoss)}, EQ ${formatPrice(signal.plan.targets[0])}, DOL ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}.`
      : stageVerdict === "blocked"
        ? `Bu setup bozuldu; yeni setup bekle. ${signal.governance.blockers[0] ?? ""}`.trim()
      : stageVerdict === "done"
          ? "Entry veya hedef kaçmış; yeni model bekle."
          : signal.governance.blockers[0] ?? firstUsefulWait(items) ?? "READY olmadan trade alma.";

  return {
    verdict: stageVerdict,
    headline,
    decision,
    items,
    simpleFacts: [
      `${signal.symbol} ${signal.direction.toUpperCase()} · ${signal.stage.toUpperCase()} · ${signal.grade}`,
      decision,
      `Risk: ${formatR(signal.plan.rr)} · SL ${formatPrice(signal.plan.stopLoss)} · EQ/TP1 ${formatPrice(signal.plan.targets[0])} · DOL/TP2 ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}`
    ]
  };
}
