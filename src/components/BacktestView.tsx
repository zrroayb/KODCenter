import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { BacktestResult } from "../lib/analytics/performance";
import { fetchGeminiReplayReview, type GeminiReplayReviewResponse } from "../lib/gemini/replayReview";
import { formatPrice } from "../lib/ict/format";

function reasonText(reason: string) {
  if (reason === "clean-model") return "Temiz model";
  if (reason === "stop-too-tight") return "Stop / risk problemi";
  if (reason === "event-risk") return "Event riski";
  if (reason === "range-chop") return "Range / chop";
  if (reason === "htf-conflict") return "HTF ters";
  if (reason === "entry-not-filled") return "Entry dolmadı";
  if (reason === "expired") return "Süre doldu";
  return "Bilinmeyen";
}

function verdictText(verdict: string) {
  if (verdict === "edge") return "Edge";
  if (verdict === "avoid") return "Uzak dur";
  if (verdict === "neutral") return "Nötr";
  if (verdict === "needs-data") return "Az veri";
  if (verdict === "tighten") return "Sıkılaştır";
  if (verdict === "keep") return "Koru";
  if (verdict === "relax") return "Gevşet";
  return "İncele";
}

export function BacktestView({ result, onRun }: { result: BacktestResult; onRun: () => void }) {
  const [aiReview, setAiReview] = useState<GeminiReplayReviewResponse>({ status: "disabled", reason: "Henüz yorum alınmadı." });
  const [aiLoading, setAiLoading] = useState(false);
  const replay = result.replay;
  const metrics = [
    [replay ? "Tetiklenen trade" : "Toplam işlem", result.totalTrades],
    ["Win rate", `${result.winRate.toFixed(1)}%`],
    [replay ? "Expectancy" : "Ortalama RR", replay ? `${replay.expectancyR.toFixed(2)}R` : result.averageRR.toFixed(2)],
    ["Profit factor", result.profitFactor.toFixed(2)],
    ["Max drawdown", `${result.maxDrawdown.toFixed(2)}R`],
    ["En iyi symbol", result.bestSymbol]
  ];
  const replayMetrics = replay ? [
    ["Pencere", `${replay.availableDays.toFixed(1)} / ${replay.windowDays} gün · ${replay.scanEveryCandles}x15m`],
    ["Runtime scan", replay.scannedWindows],
    ["Replay entry", replay.readyAlerts],
    ["Live / promoted", `${replay.liveReadyEntries} / ${replay.watchPromotedEntries}`],
    ["WATCH setup", replay.watchAlerts],
    ["TP / SL", `${replay.tp1Trades + replay.tp2Trades} / ${replay.stoppedTrades}`],
    ["Toplam R", `${replay.totalR.toFixed(2)}R`]
  ] : [];
  const runAiReview = async () => {
    if (!replay || aiLoading) return;
    setAiLoading(true);
    setAiReview({ status: "disabled", reason: "Gemini replay datasını okuyor." });
    try {
      setAiReview(await fetchGeminiReplayReview(result));
    } finally {
      setAiLoading(false);
    }
  };
  return (
    <article className="panel">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Backtest</span>
          <h2>{replay ? "Son 1 ay runtime replay" : "Strategy bazlı runtime replay"}</h2>
        </div>
        <div className="panel-actions">
          {replay && <button className="ghost-btn" onClick={runAiReview} type="button" disabled={aiLoading}>{aiLoading ? "Gemini okuyor" : "AI replay yorumu"}</button>}
          <button className="ghost-btn" onClick={onRun} type="button"><RefreshCcw size={15} /> Son 1 ayı replay et</button>
        </div>
      </header>
      <div className="metric-grid">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {replay && (
        <>
          <div className="metric-grid replay-metric-grid">
            {replayMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          {replay.sampleWarning && <p className="provider-warning">{replay.sampleWarning}</p>}
          <div className="strategy-learning-list replay-ai-review">
            <strong>AI replay yorumu</strong>
            {aiReview.commentary
              ? <p>{aiReview.commentary}</p>
              : <p className="muted-note">{aiReview.reason ?? "Son 1 ayı replay et, sonra Geminiye yorumlat."}</p>}
          </div>
          <div className="strategy-learning-list replay-diagnosis-list">
            <strong>Replay teşhisi</strong>
            {replay.replayDiagnosis.map((item) => (
              <div key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="strategy-learning-list replay-symbol-list">
            <strong>Symbol bazlı sonuç</strong>
            {replay.bySymbol.map((row) => (
              <div key={row.symbol}>
                <span>{row.symbol}</span>
                <b>{row.watchAlerts} WATCH · {row.readyAlerts} replay entry</b>
                <small>{row.triggeredTrades} tetik · {row.totalR.toFixed(2)}R · avg score {row.avgScore.toFixed(0)} · win {row.winRate.toFixed(1)}%</small>
              </div>
            ))}
            {!replay.bySymbol.length && <p className="muted-note">Bu ay hiç setup adayı oluşmadı; veri/saat aralığı veya strateji filtresi kontrol edilmeli.</p>}
          </div>
          <div className="strategy-learning-list replay-breakdown-list">
            <strong>Setup kırılımı</strong>
            {replay.setupBreakdowns.slice(0, 10).map((item) => (
              <div key={item.key}>
                <span>{item.label}</span>
                <b>{verdictText(item.verdict)} · {item.expectancyR.toFixed(2)}R · WR {item.winRate.toFixed(1)}%</b>
                <small>{item.sample} örnek · MFE {item.avgMfeR.toFixed(2)}R · MAE {item.avgMaeR.toFixed(2)}R · {item.note}</small>
              </div>
            ))}
            {!replay.setupBreakdowns.length && <p className="muted-note">Kırılım için yeterli replay trade yok.</p>}
          </div>
          <div className="strategy-learning-list replay-calibration-list">
            <strong>Kalibrasyon önerisi</strong>
            {replay.calibration.map((item) => (
              <div key={`${item.label}-${item.value}-${item.verdict}`}>
                <span>{item.label}</span>
                <b>{verdictText(item.verdict)} · {item.value}</b>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
          <div className="strategy-learning-list replay-watch-reason-list">
            <strong>WATCH neden kaldı?</strong>
            {replay.watchReasonSummary.map((item) => (
              <div key={item.reason}>
                <span>{item.reason}</span>
                <b>{item.count} WATCH</b>
                <small>Bu madde çok tekrar ediyorsa entry şartı fazla sıkı, veri kötü ya da chart gerçekten hazır değil.</small>
              </div>
            ))}
            {!replay.watchReasonSummary.length && <p className="muted-note">WATCH sebebi yok; replay entry listesine bak.</p>}
          </div>
          <div className="strategy-learning-list replay-failure-list">
            <strong>Neden patladı / neden dolmadı?</strong>
            {replay.failureReasons.slice(0, 6).map((item) => (
              <div key={item.reason}>
                <span>{reasonText(item.reason)}</span>
                <b>{item.count} kez · {item.totalR.toFixed(2)}R</b>
                <small>Bu sebep artıyorsa ilgili filtre READY yerine WATCH olmalı.</small>
              </div>
            ))}
            {!replay.failureReasons.length && <p className="muted-note">Kayıp sebebi yok; ya trade yok ya da sonuçlar pozitif.</p>}
          </div>
          <div className="journal-entry-list replay-failure-case-list">
            <strong>Patlayan örnekler</strong>
            {replay.failureCases.slice(0, 8).map((trade) => (
              <div key={trade.id}>
                <strong>{trade.symbol} {trade.direction.toUpperCase()} · {trade.origin === "live-ready" ? "LIVE" : "WATCH→ENTRY"} · {trade.status.toUpperCase()} · {trade.rMultiple.toFixed(2)}R</strong>
                <span>{new Date(trade.signalTime).toLocaleString()} · {trade.entrySource}/{trade.entryStatus} · {trade.session} · PD {trade.premiumDiscount} · HTF {trade.dailyBias}/{trade.h4Bias}</span>
                <small>MFE {trade.maxFavorableR.toFixed(2)}R · MAE {trade.maxAdverseR.toFixed(2)}R · RR {trade.rr.toFixed(2)} · {reasonText(trade.outcomeReason)}</small>
                <small>{trade.diagnosis}</small>
              </div>
            ))}
            {!replay.failureCases.length && <p className="muted-note">Negatif örnek yok; daha uzun pencereyle doğrula.</p>}
          </div>
          <div className="journal-entry-list replay-trade-list">
            {replay.trades.slice(0, 8).map((trade) => (
              <div key={trade.id}>
                <strong>{trade.symbol} {trade.direction.toUpperCase()} · {trade.origin === "live-ready" ? "LIVE READY" : "WATCH PROMOTED"} · {trade.status.toUpperCase()} · {trade.rMultiple.toFixed(2)}R</strong>
                <span>{new Date(trade.signalTime).toLocaleString()} · grade {trade.grade} · score {trade.score} · {trade.entrySource}/{trade.stopSource}</span>
                <small>Entry {formatPrice(trade.entry)} · SL {formatPrice(trade.stopLoss)} · TP1 {formatPrice(trade.target)} · MFE {trade.maxFavorableR.toFixed(2)}R · MAE {trade.maxAdverseR.toFixed(2)}R · {reasonText(trade.outcomeReason)} · {trade.note}</small>
              </div>
            ))}
            {!replay.trades.length && <p className="muted-note">Son 1 ayda replay entry tetiklenmedi; WATCH sayısına ve şartlara bak.</p>}
          </div>
          <div className="journal-entry-list replay-candidate-list">
            <strong>Aylık setup akışı</strong>
            {replay.candidates.slice(0, 18).map((candidate) => (
              <div key={candidate.id}>
                <strong>{candidate.symbol} {candidate.direction.toUpperCase()} · {candidate.stage.toUpperCase()} · {candidate.grade} · Score {candidate.score}</strong>
                <span>{new Date(candidate.signalTime).toLocaleString()} · {candidate.entrySource}/{candidate.entryStatus} · RR {candidate.rr.toFixed(2)} · {candidate.governance}/{candidate.actionWindow}</span>
                <small>Entry {formatPrice(candidate.entry)} · SL {formatPrice(candidate.stopLoss)} · TP1 {formatPrice(candidate.target)} · {candidate.decision}</small>
                {candidate.reasons.length > 0 && <small>Eksik: {candidate.reasons.slice(0, 3).join(" · ")}</small>}
              </div>
            ))}
            {!replay.candidates.length && <p className="muted-note">Replay scan çalıştı ama aday kaydı yok. Bu durumda veri warmup veya rule filtreleri çok sıkı olabilir.</p>}
          </div>
        </>
      )}
      <div className="equity-curve">
        {result.equityCurve.map((point, index) => <span key={`${point}-${index}`} style={{ height: `${Math.max(8, 30 + point * 8)}px` }} title={`${point}R`} />)}
      </div>
    </article>
  );
}
