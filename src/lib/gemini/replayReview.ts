import type { BacktestResult, RuntimeReplaySummary } from "../analytics/performance";

const MIN_REPLAY_RULE_TRADES = 20;
const MIN_REPLAY_BUCKET_TRADES = 8;

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
  filterScenarios: RuntimeReplaySummary["filterScenarios"];
  managementScenarios: RuntimeReplaySummary["managementScenarios"];
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

const REASON_LABELS: Record<string, string> = {
  "clean-model": "temiz model",
  "eq-then-be": "EQ sonrası BE",
  "dol-missed": "DOL gelmedi",
  "stop-too-tight": "stop gürültü bandında",
  "no-follow-through": "momentum EQ'ya taşımadı",
  "be-scratch": "BE scratch (0R)",
  "event-risk": "event riski",
  "range-chop": "range/chop rejimi",
  "htf-conflict": "HTF tam ters",
  "partial-htf-conflict": "HTF kısmi ters",
  "entry-not-filled": "entry dolmadı",
  "entry-expired": "retest emri zaman aşımı",
  expired: "süre doldu",
  unknown: "sınıflandırılamadı"
};

function localReplayReview(payload: GeminiReplayReviewPayload, reason?: string): GeminiReplayReviewResponse {
  // Mentor rules: small samples get no verdict and no rule changes; losers are named concretely.
  const triggered = payload.totals.triggeredTrades;
  const smallSample = triggered < MIN_REPLAY_RULE_TRADES;
  const karar = triggered === 0
    ? "Karar: Tetiklenen trade yok; disiplin kapıları çalışıyor, hüküm için veri yok."
    : smallSample
      ? `Karar: ${triggered} trade istatistik değildir; expectancy ${payload.totals.expectancyR.toFixed(2)}R / PF ${payload.totals.profitFactor.toFixed(2)} sayısal olarak kötü ama örneklem hüküm vermeye yetmez.`
      : `Karar: Replay edge ${payload.totals.expectancyR >= 0 ? "pozitif" : "negatif"}; expectancy ${payload.totals.expectancyR.toFixed(2)}R, PF ${payload.totals.profitFactor.toFixed(2)} (${triggered} trade).`;

  const caseLine = payload.failureCases.slice(0, 2)
    .map((item) => `${item.symbol} ${item.direction} (${REASON_LABELS[item.outcomeReason] ?? item.outcomeReason}${typeof item.maxFavorableR === "number" ? ` maxFav ${item.maxFavorableR.toFixed(2)}R` : ""})`)
    .join(", ");
  const topFailure = payload.failureReasons[0];
  const anaSorun = caseLine
    ? `Ana sorun: kaybedenler ${caseLine}; live READY ${payload.totals.liveReadyEntries}, WATCH-promoted ${payload.totals.watchPromotedEntries}.`
    : topFailure
      ? `Ana sorun: ${REASON_LABELS[topFailure.reason] ?? topFailure.reason} ${topFailure.count} kez / ${topFailure.totalR.toFixed(2)}R.`
      : "Ana sorun: kayıp bucket'ı yok.";

  const worst = payload.setupBreakdowns.find((item) => item.verdict === "avoid" && item.triggered >= MIN_REPLAY_BUCKET_TRADES);
  // Management counterfactuals are measured in the replay itself: same entries, same
  // candles, only the exit rule differs — report the comparison instead of asking for it.
  const model = payload.managementScenarios.find((item) => item.id === "model");
  const betterMgmt = [...payload.managementScenarios]
    .filter((item) => item.verdict === "better")
    .sort((a, b) => b.deltaR - a.deltaR)[0];
  const mgmtLine = model && payload.managementScenarios.length
    ? betterMgmt
      ? `Yönetim ölçümü: "${betterMgmt.label}" mevcut modeli geçiyor (${betterMgmt.expectancyR.toFixed(2)}R vs ${model.expectancyR.toFixed(2)}R, Δ${betterMgmt.deltaR >= 0 ? "+" : ""}${betterMgmt.deltaR.toFixed(2)}R, ${betterMgmt.trades} trade).`
      : `Yönetim ölçümü: BE/partial varyantları mevcut modeli geçemedi (model ${model.expectancyR.toFixed(2)}R); yönetim suçlu değil.`
    : "";
  const degistir = smallSample
    ? "Değiştir: Hiçbir şey — bu örneklemle kural değiştirmek overfit olur; aynı kurallarla veri biriktir."
    : worst
      ? `Değiştir: ${worst.label} koşulunu READY'den WATCH'a indir (${worst.expectancyR.toFixed(2)}R, ${worst.triggered} trade).`
      : betterMgmt
        ? `Değiştir: yönetimi "${betterMgmt.label}" varyantına kaydırmayı düşün (Δ${betterMgmt.deltaR >= 0 ? "+" : ""}${betterMgmt.deltaR.toFixed(2)}R); önce bir replay penceresi daha doğrula.`
        : "Değiştir: Tek bir setup bucket'ı suçlu değil; yönetim ölçümü de modeli aklıyor, aynı kurallarla devam.";

  const bestFilter = payload.filterScenarios.find((item) => item.verdict === "edge" && item.triggered >= MIN_REPLAY_BUCKET_TRADES);
  const sonraki = bestFilter
    ? `Sonraki test: ${bestFilter.label} filtresini öne al (${bestFilter.expectancyR.toFixed(2)}R, PF ${bestFilter.profitFactor.toFixed(2)}).`
    : `Sonraki test: ${smallSample ? "1-2 hafta daha canlı veri biriktirip aynı replay'i tekrar çalıştır." : "live READY / HTF uyumlu / session içi filtrelerini ayrı ayrı ölç."}`;

  return {
    status: "fallback",
    model: "local-fallback",
    reason,
    commentary: [karar, anaSorun, mgmtLine, degistir, sonraki].filter(Boolean).join("\n")
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
    filterScenarios: replay.filterScenarios.slice(0, 8),
    managementScenarios: replay.managementScenarios ?? [],
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
  if (payload.totals.triggeredTrades < MIN_REPLAY_RULE_TRADES) {
    return localReplayReview(payload, `Minimum örneklem ${MIN_REPLAY_RULE_TRADES} tetiklenen trade.`);
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
