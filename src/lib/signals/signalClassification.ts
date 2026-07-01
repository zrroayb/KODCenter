import type { TradingSignal } from "../ict/types";

export type SignalDecisionClass = "tradeable" | "watch" | "wait" | "inactive";

export function signalDecisionClass(signal: TradingSignal): SignalDecisionClass {
  if (signal.stage === "invalidated" || signal.stage === "missed") return "inactive";
  if (signal.stage === "ready") return "tradeable";
  if (signal.score >= 65 && signal.plan.rr >= 1) return "watch";
  return "wait";
}

export function signalDecisionLabel(signal: TradingSignal): string {
  const decision = signalDecisionClass(signal);
  if (decision === "tradeable") return "ALINABİLİR";
  if (decision === "watch") return "İZLE";
  if (decision === "wait") return "BEKLE";
  return "GEÇMİŞ";
}

export function signalDecisionReason(signal: TradingSignal): string {
  const decision = signalDecisionClass(signal);
  if (decision === "tradeable") return "READY: entry, stop ve TP planı aktif.";
  if (decision === "inactive") {
    return signal.stage === "invalidated"
      ? "Stop/invalidation görülmüş. Trade kovalanmaz."
      : signal.plan.planWarnings.find((warning) => warning.includes("Entry kaçtı")) ?? "Hedefe gitmiş veya geç kalmış. Yeni model beklenir.";
  }
  if (signal.plan.planWarnings.length) return signal.plan.planWarnings[0];
  const failed = signal.decisionSummary.checklist.find((item) => item.status === "fail");
  if (failed) return failed.explanation;
  return decision === "watch" ? "Setup izlenebilir ama henüz manuel entry planı değil." : "Kalite düşük; confirmation beklenmeli.";
}
