import type { TradingSignal } from "../ict/types";

export type SignalDecisionClass = "tradeable" | "watch" | "wait" | "invalid" | "inactive";

const TERMINAL_BLOCKER_PARTS = [
  "HTF continuation kapanışı ters yönde",
  "reclaim tutmuyor",
  "Gerçek distribution/DOL hedefi yok",
  "TP1 hedefi girişin gerisinde",
  "Stop entry'nin yanlış tarafında",
  "Retest uzak",
  "Haber/spike expansion rejimi",
  "Trend rejiminde counter-bias reversal alınmaz",
  "Replay sonucu stop/invalidation görmüş",
  "Replay sonucu hedef görülmüş",
  "ICT sequence invalid"
];

export function signalHardInvalidReason(signal: TradingSignal): string | undefined {
  return signal.governance.blockers.find((blocker) =>
    TERMINAL_BLOCKER_PARTS.some((part) => blocker.includes(part))
  );
}

// A filled trade still running after its entry window closed: the engine marks it "missed" (no new
// entries), but for whoever took it the position is OPEN — label it that way, never "GEÇMİŞ".
export function signalIsOpenTrade(signal: TradingSignal): boolean {
  return signal.stage === "missed" && signal.outcome.status === "open";
}

export function signalDecisionClass(signal: TradingSignal): SignalDecisionClass {
  if (signal.stage === "invalidated" || signal.stage === "missed") return "inactive";
  if (signalHardInvalidReason(signal)) return "invalid";
  if (signal.governance.status === "block") return "wait";
  if (signal.stage === "ready") return "tradeable";
  if (signal.score >= 65 && signal.plan.rr >= 1) return "watch";
  return "wait";
}

export function signalDecisionLabel(signal: TradingSignal): string {
  const decision = signalDecisionClass(signal);
  if (signalIsOpenTrade(signal)) return "AÇIK İŞLEM";
  if (decision === "tradeable") return "ALINABİLİR";
  if (decision === "invalid") return "GEÇERSİZ";
  if (signal.crtAnchor?.setupPhase === "context") return "BAĞLAM";
  if (signal.crtAnchor?.setupPhase === "raid") return "RAID";
  if (signal.crtAnchor?.setupPhase === "model") return "MODEL";
  if (decision === "watch") return "İZLE";
  if (decision === "wait") return "BEKLE";
  return "GEÇMİŞ";
}

export function signalDecisionReason(signal: TradingSignal): string {
  const decision = signalDecisionClass(signal);
  if (decision === "tradeable") return "READY: entry, stop ve TP planı aktif.";
  if (signalIsOpenTrade(signal)) {
    return "İşlem açık; giriş penceresi kapandı — yeni giriş yok. Stop (EQ'dan sonra BE) ve DOL çıkışını yönet.";
  }
  if (decision === "inactive") {
    return signal.stage === "invalidated"
      ? "Stop/invalidation görülmüş. Trade kovalanmaz."
      : signal.plan.planWarnings.find((warning) => warning.includes("%50/EQ") || warning.includes("Entry kaçtı")) ?? "Hedefe gitmiş veya geç kalmış. Yeni model beklenir.";
  }
  if (decision === "invalid") return signalHardInvalidReason(signal) ?? "Setup yapısı bozulmuş; yeni CRT modeli bekle.";
  if (signal.governance.blockers.length) return signal.governance.blockers[0];
  if (signal.crtAnchor?.setupPhase === "context") return "Sadece CRT bağlamı var; raid/manipulation gelmeden trade yok.";
  if (signal.crtAnchor?.setupPhase === "raid") return `CRT high/low alındı; yalnızca ${(signal.crtAnchor.confirmTf ?? "15m").toUpperCase()} ChoCH/shift kapanışı bekleniyor.`;
  if (signal.crtAnchor?.setupPhase === "model") return "Model oluşuyor; entry/retest, RR veya kalite filtresi bekleniyor.";
  if (signal.governance.warnings.length) return signal.governance.warnings[0];
  if (signal.plan.planWarnings.length) return signal.plan.planWarnings[0];
  const failed = signal.decisionSummary.checklist.find((item) => item.status === "fail");
  if (failed) return failed.explanation;
  return decision === "watch" ? "Setup izlenebilir ama henüz manuel entry planı değil." : "Kalite düşük; confirmation beklenmeli.";
}

