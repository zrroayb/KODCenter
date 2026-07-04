import type { BacktestResult, RuntimeReplaySummary } from "../analytics/performance";

export type GeminiReplayReviewPayload = {
  strategyId: string;
  windowDays: number;
  availableDays: number;
  scannedWindows: number;
  totals: {
    trades: number;
    triggeredTrades: number;
    winRate: number;
    profitFactor: number;
    expectancyR: number;
    totalR: number;
    maxDrawdownR: number;
    readyEntries: number;
    watchSetups: number;
    liveReadyEntries: number;
    watchPromotedEntries: number;
    tp: number;
    stopped: number;
    notTriggered: number;
    open: number;
  };
  bySymbol: RuntimeReplaySummary["bySymbol"];
  calibration: RuntimeReplaySummary["calibration"];
  setupBreakdowns: RuntimeReplaySummary["setupBreakdowns"];
  failureReasons: RuntimeReplaySummary["failureReasons"];
  failureCases: RuntimeReplaySummary["failureCases"];
  watchReasonSummary: RuntimeReplaySummary["watchReasonSummary"];
  replayDiagnosis: RuntimeReplaySummary["replayDiagnosis"];
  sampleWarning?: string;
};

export type GeminiReplayReviewResponse = {
  status: "ready" | "fallback" | "disabled" | "error";
  commentary?: string;
  model?: string;
  reason?: string;
  error?: string;
};

function localReplayReview(payload: GeminiReplayReviewPayload, reason?: string): GeminiReplayReviewResponse {
  const worst = payload.setupBreakdowns.find((item) => item.verdict === "avoid");
  const topFailure = payload.failureReasons[0];
  const promotedNote = payload.totals.watchPromotedEntries > payload.totals.liveReadyEntries
    ? `Replay'in çoğu WATCH-promoted: ${payload.totals.watchPromotedEntries}/${payload.totals.readyEntries}.`
    : `Live READY örneği ${payload.totals.liveReadyEntries}.`;
  return {
    status: "fallback",
    model: "local-fallback",
    reason,
    commentary: [
      `Karar: Sistem şu an pozitif edge göstermiyor; expectancy ${payload.totals.expectancyR.toFixed(2)}R, PF ${payload.totals.profitFactor.toFixed(2)}.`,
      `Ana sorun: ${topFailure ? `${topFailure.reason} ${topFailure.count} kez / ${topFailure.totalR.toFixed(2)}R` : "net kayıp bucket'ı yok"}. ${promotedNote}`,
      `Değiştir: ${worst ? `${worst.label} koşulunu READY'den WATCH'a indir (${worst.expectancyR.toFixed(2)}R).` : "önce live READY ile WATCH-promoted istatistiğini ayrı oku."}`,
      "Sonraki test: minimum 30 gün daha veriyle sadece live READY, HTF uyumlu, PD doğru ve session içi setup'ı ölç."
    ].join("\n")
  };
}

export function buildGeminiReplayReviewPayload(result: BacktestResult): GeminiReplayReviewPayload | null {
  const replay = result.replay;
  if (!replay) return null;
  return {
    strategyId: replay.strategyId,
    windowDays: replay.windowDays,
    availableDays: replay.availableDays,
    scannedWindows: replay.scannedWindows,
    totals: {
      trades: result.totalTrades,
      triggeredTrades: replay.triggeredTrades,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      expectancyR: replay.expectancyR,
      totalR: replay.totalR,
      maxDrawdownR: result.maxDrawdown,
      readyEntries: replay.readyAlerts,
      watchSetups: replay.watchAlerts,
      liveReadyEntries: replay.liveReadyEntries,
      watchPromotedEntries: replay.watchPromotedEntries,
      tp: replay.tp1Trades + replay.tp2Trades,
      stopped: replay.stoppedTrades,
      notTriggered: replay.notTriggered,
      open: replay.openTrades
    },
    bySymbol: replay.bySymbol.slice(0, 8),
    calibration: replay.calibration.slice(0, 10),
    setupBreakdowns: replay.setupBreakdowns.slice(0, 14),
    failureReasons: replay.failureReasons.slice(0, 8),
    failureCases: replay.failureCases.slice(0, 12),
    watchReasonSummary: replay.watchReasonSummary.slice(0, 8),
    replayDiagnosis: replay.replayDiagnosis,
    sampleWarning: replay.sampleWarning
  };
}

export async function fetchGeminiReplayReview(result: BacktestResult): Promise<GeminiReplayReviewResponse> {
  const payload = buildGeminiReplayReviewPayload(result);
  if (!payload) {
    return { status: "disabled", reason: "Replay sonucu yok; önce son 1 ay replay çalıştır." };
  }
  try {
    const response = await fetch("/api/gemini/replay-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const review = await response.json().catch(() => ({
      status: "error",
      error: "Gemini replay yorumu okunamadı."
    })) as GeminiReplayReviewResponse;
    if (review.status === "error") return localReplayReview(payload, review.error ?? review.reason);
    if (review.status === "disabled") return localReplayReview(payload, review.reason);
    return review;
  } catch (error) {
    return localReplayReview(payload, error instanceof Error ? error.message : String(error));
  }
}
