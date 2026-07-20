import type { TradingSignal } from "../ict/types";

export type SignalDecisionClass = "tradeable" | "watch" | "wait" | "invalid" | "inactive";
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

export function signalLifecycleState(signal: TradingSignal): SignalLifecycleState {
  // The stage IS the verdict: a watch setup whose hypothetical plan grazed the stop zone is
  // not "stopped" — only a real confirmed-entry invalidation earns this box.
  if (signal.stage === "invalidated") {
    return {
      status: "invalidated",
      label: "STOP OLDU",
      nextAction: "Bu setup kapanmış. Yeni CRT range, Yeni sweep/manipulation ve ChoCH bekle.",
      severity: "danger"
    };
  }

  if (signal.stage === "missed") {
    return {
      status: "missed",
      label: "KAÇTI",
      nextAction: "Fiyat hedefe gitmiş veya entry kaçmış. Kovalamadan yeni model bekle.",
      severity: "muted"
    };
  }

  const hardInvalidReason = signalHardInvalidReason(signal);
  if (hardInvalidReason) {
    return {
      status: "blocked",
      label: "GEÇERSİZ",
      nextAction: hardInvalidReason,
      severity: "danger"
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
    if (signal.crtAnchor?.setupPhase === "context") {
      return {
        status: "watch",
        label: "BAĞLAM",
        nextAction: "CRT yön/range var. Önce raid/manipulation, sonra ChoCH/Just bekle.",
        severity: "watch"
      };
    }
    if (signal.crtAnchor?.setupPhase === "raid") {
      return {
        status: "close-wait",
        label: "RAID VAR",
        nextAction: `CRT high/low alındı. Yalnızca ${(signal.crtAnchor.confirmTf ?? "15m").toUpperCase()} ChoCH/shift kapanışı bekleniyor.`,
        severity: "watch"
      };
    }
    return {
      status: "close-wait",
      label: "KAPANIŞ BEKLE",
      nextAction: "ChoCH/Just mum kapanışı netleşmeden entry yok.",
      severity: "watch"
    };
  }

  if (signal.plan.entryStatus === "pending") {
    return {
      status: "entry-wait",
      label: "ENTRY BEKLE",
      nextAction: "Fiyat entry kutusuna/retest seviyesine dokunsun. Mitigation mum kapanışı şart değil; ChoCH/Just ayrı teyit.",
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
