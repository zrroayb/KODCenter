import type { TradingSignal } from "../ict/types";

export type SignalDecisionClass = "tradeable" | "watch" | "wait" | "inactive";
export type SignalLifecycleStatus =
  | "ready-locked"
  | "ready"
  | "entry-wait"
  | "close-wait"
  | "session-wait"
  | "blocked"
  | "expired"
  | "invalidated"
  | "missed"
  | "watch";

export type SignalLifecycleState = {
  status: SignalLifecycleStatus;
  label: string;
  nextAction: string;
  severity: "good" | "watch" | "danger" | "muted";
};

export function signalDecisionClass(signal: TradingSignal): SignalDecisionClass {
  if (signal.stage === "invalidated" || signal.stage === "missed") return "inactive";
  if (signal.governance.status === "block") return "wait";
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
  if (signal.governance.blockers.length) return signal.governance.blockers[0];
  if (signal.governance.warnings.length) return signal.governance.warnings[0];
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

export function signalLifecycleState(signal: TradingSignal): SignalLifecycleState {
  if (signal.stage === "invalidated" || signal.outcome.status === "stopped") {
    return {
      status: "invalidated",
      label: "STOP OLDU",
      nextAction: "Bu setup kapanmış. Yeni sweep/MSS dizilimi bekle.",
      severity: "danger"
    };
  }

  if (signal.stage === "missed" || signal.outcome.status === "missed") {
    return {
      status: "missed",
      label: "KAÇTI",
      nextAction: "Fiyat hedefe gitmiş veya entry kaçmış. Kovalamadan yeni model bekle.",
      severity: "muted"
    };
  }

  if (signal.actionWindow.status === "expired" || signal.actionWindow.status === "inactive") {
    return {
      status: "expired",
      label: "SÜRESİ DOLDU",
      nextAction: "Eski planı alma. Yeni retest, yeni kapanış veya yeni likidite süpürmesi bekle.",
      severity: "muted"
    };
  }

  if (signal.governance.status === "block") {
    return {
      status: "blocked",
      label: "ALMA",
      nextAction: signal.governance.blockers[0] ?? "Blok sebebi çözülmeden manuel işleme dönme.",
      severity: "danger"
    };
  }

  if (signal.stage === "ready" && signal.actionWindow.status === "valid") {
    return {
      status: "ready-locked",
      label: "READY KİLİTLİ",
      nextAction: "Plan canlı: sadece entry, stop ve TP seviyelerine göre yönet.",
      severity: "good"
    };
  }

  if (signal.stage === "ready") {
    return {
      status: "ready",
      label: "READY",
      nextAction: "Plan hazır ama zaman penceresini ve event riskini son kez kontrol et.",
      severity: "good"
    };
  }

  if (!signal.plan.entryModel.cisdConfirmed) {
    return {
      status: "close-wait",
      label: "KAPANIŞ BEKLE",
      nextAction: "Yön değişimi mum kapanışıyla netleşmeden entry yok.",
      severity: "watch"
    };
  }

  if (!signal.plan.entryModel.retested || signal.plan.entryStatus === "pending") {
    return {
      status: "entry-wait",
      label: "ENTRY BEKLE",
      nextAction: "Fiyat entry kutusuna/retest seviyesine gelsin, sonra kapanışla onaylasın.",
      severity: "watch"
    };
  }

  if (signal.context.eventRisk.level !== "clear") {
    return {
      status: "session-wait",
      label: "RİSKLİ SAAT",
      nextAction: signal.context.eventRisk.summary,
      severity: "watch"
    };
  }

  return {
    status: "watch",
    label: "İZLE",
    nextAction: signal.plan.planWarnings[0] ?? signal.governance.warnings[0] ?? "Setup izleniyor; READY olmadan manuel trade yok.",
    severity: "watch"
  };
}
