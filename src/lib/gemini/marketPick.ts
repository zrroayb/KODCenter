import type { TradingSignal } from "../ict/types";
import { formatPrice, formatR } from "../ict/format";

export type MarketPickCandidate = {
  id: string;
  symbol: string;
  direction: string;
  stage: string;
  grade: string;
  score: number;
  rr: number;
  anchor?: string;
  entry: number;
  stopLoss: number;
  targets: number[];
  summary: string;
  governance: string;
  blockers: string[];
  warnings: string[];
};

export type GeminiMarketPickPayload = {
  generatedAt: number;
  dataSource: string;
  marketCount: number;
  candidates: MarketPickCandidate[];
};

export type GeminiMarketPickResponse = {
  status: "ready" | "fallback" | "disabled" | "error";
  commentary?: string;
  model?: string;
  reason?: string;
  error?: string;
};

function stageRank(stage: string): number {
  return stage === "ready" ? 3 : stage === "watch" ? 2 : 0;
}

export function rankSignalsForPick(signals: TradingSignal[]): TradingSignal[] {
  return [...signals]
    .filter((signal) => signal.stage === "ready" || signal.stage === "watch")
    .sort((a, b) =>
      stageRank(b.stage) - stageRank(a.stage)
      || b.score - a.score
      || b.plan.rr - a.plan.rr);
}

export function buildMarketPickPayload(signals: TradingSignal[], dataSource: string, marketCount: number): GeminiMarketPickPayload {
  const candidates = rankSignalsForPick(signals).slice(0, 6).map((signal): MarketPickCandidate => ({
    id: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    stage: signal.stage,
    grade: signal.grade,
    score: signal.score,
    rr: Number(signal.plan.rr.toFixed(2)),
    anchor: signal.crtAnchor ? `${signal.crtAnchor.rangeTf} range / ${signal.crtAnchor.confirmTf} confirm` : undefined,
    entry: signal.plan.entry,
    stopLoss: signal.plan.stopLoss,
    targets: signal.plan.targets.slice(0, 2),
    summary: signal.decisionSummary.shortSummary,
    governance: signal.governance.status,
    blockers: signal.governance.blockers.slice(0, 3),
    warnings: signal.governance.warnings.slice(0, 2)
  }));
  return { generatedAt: Date.now(), dataSource, marketCount, candidates };
}

// The desk-view fallback is deliberately opinionated: name ONE pick, say why it beats the
// runner-up, and say what would flip the call — never a neutral list of everything.
export function localMarketPick(payload: GeminiMarketPickPayload, reason?: string): GeminiMarketPickResponse {
  const demoNote = payload.dataSource === "demo"
    ? " (Dikkat: veri demo fallback — canlı veri gelmeden gerçek karar verme.)"
    : "";
  if (!payload.candidates.length) {
    return {
      status: "fallback",
      model: "local-fallback",
      reason,
      commentary: `Masa görüşü: Bugün ${payload.marketCount} market tarandı, alınabilir aday yok. Bence hiçbir şey alma — setup'sız işlem aramak kural değil dürtüdür; yeni raid bekle.${demoNote}`
    };
  }
  const [pick, second] = payload.candidates;
  const lines: string[] = [];
  const pickBlocker = pick.blockers[0];
  if (pick.stage === "ready" && !pick.blockers.length) {
    lines.push(`Masa görüşü: Bence ${pick.symbol} ${pick.direction.toUpperCase()} alınır — READY, ${pick.grade} / skor ${pick.score}, RR ${formatR(pick.rr)}${pick.anchor ? `, ${pick.anchor}` : ""}. Entry ${formatPrice(pick.entry)}, stop ${formatPrice(pick.stopLoss)}.`);
  } else {
    lines.push(`Masa görüşü: En mantıklı aday ${pick.symbol} ${pick.direction.toUpperCase()} (${pick.stage.toUpperCase()}, ${pick.grade} / skor ${pick.score}, RR ${formatR(pick.rr)}) ama henüz alınmaz${pickBlocker ? `: ${pickBlocker}` : "; onay bekleniyor."}`);
  }
  if (second) {
    const gap = pick.score - second.score;
    const secondWhy = second.blockers[0]
      ? second.blockers[0]
      : gap >= 8
        ? `skoru belirgin düşük (${second.score} vs ${pick.score})`
        : `RR daha zayıf (${formatR(second.rr)} vs ${formatR(pick.rr)})`;
    lines.push(`${second.symbol} ${second.direction.toUpperCase()} ikinci sırada; onu tercih etmezdim çünkü ${secondWhy}.`);
  }
  if (pick.stage !== "ready" || pick.blockers.length) {
    lines.push("Kararı çevirecek şey: konfirmasyon kapanışı gelirse al, stop seviyesi bozulursa unut.");
  }
  return {
    status: "fallback",
    model: "local-fallback",
    reason,
    commentary: lines.join(" ") + demoNote
  };
}

export async function fetchGeminiMarketPick(payload: GeminiMarketPickPayload): Promise<GeminiMarketPickResponse> {
  try {
    const response = await fetch("/api/gemini/market-pick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const review = await response.json().catch(() => ({
      status: "error",
      error: "Gemini masa görüşü okunamadı."
    })) as GeminiMarketPickResponse;
    if (review.status === "error") return localMarketPick(payload, review.error ?? review.reason);
    if (review.status === "disabled") return localMarketPick(payload, review.reason);
    return review;
  } catch (error) {
    return localMarketPick(payload, error instanceof Error ? error.message : String(error));
  }
}
