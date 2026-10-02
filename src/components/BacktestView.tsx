import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { BacktestResult } from "../lib/analytics/performance";
import { fetchGeminiReplayReview, type GeminiReplayReviewResponse } from "../lib/gemini/replayReview";
import { formatPrice } from "../lib/ict/format";
import { playbookLabel } from "../lib/strategies/playbookLabels";

function reasonText(reason: string) {
  if (reason === "clean-model") return "Temiz model";
  if (reason === "dol-be") return "DOL tam çıkış (EQ'da BE)";
  if (reason === "eq-full") return "EQ tam çıkış";
  if (reason === "eq-then-be") return "EQ sonra BE";
  if (reason === "dol-missed") return "DOL gelmedi";
  if (reason === "stop-too-tight") return "Stop / risk problemi";
  if (reason === "no-follow-through") return "Momentum EQ'ya taşımadı";
  if (reason === "be-scratch") return "BE scratch (0R)";
  if (reason === "event-risk") return "Event riski";
  if (reason === "range-chop") return "Range / chop";
  if (reason === "htf-conflict") return "HTF ters";
  if (reason === "partial-htf-conflict") return "HTF kısmi ters (D veya 4H)";
  if (reason === "entry-not-filled") return "Entry dolmadı";
  if (reason === "entry-expired") return "Retest emri zaman aşımı";
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

function managementVerdictText(item: { live: boolean; verdict: string; deltaR: number }) {
  if (item.live) return "Canlı model";
  if (item.verdict === "needs-data") return "Az veri";
  if (item.verdict === "better") return `Daha iyi (+${item.deltaR.toFixed(2)}R)`;
  if (item.verdict === "worse") return `Daha kötü (${item.deltaR.toFixed(2)}R)`;
  return "Benzer";
}

function plainAiCommentary(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim();
}

export function BacktestView({ result, onRun, loading = false, strategyId = "crt" }: { result: BacktestResult; onRun: (strategyId?: string) => void; loading?: boolean; strategyId?: string }) {
  const [aiReview, setAiReview] = useState<GeminiReplayReviewResponse>({ status: "disabled", reason: "Henüz yorum alınmadı." });
  const [aiLoading, setAiLoading] = useState(false);
  const replay = result.replay;
  const minimumReliableSample = 20;
  const sampleReliable = Boolean(replay && replay.triggeredTrades >= minimumReliableSample);
  const metrics = replay ? [
    ["Ölçülen trade", `${replay.triggeredTrades}`],
    ["Expectancy", `${replay.expectancyR.toFixed(2)}R`],
    ["Profit factor", result.profitFactor.toFixed(2)],
    ["Max drawdown", `${result.maxDrawdown.toFixed(2)}R`],
    ["Win rate", `${result.winRate.toFixed(1)}%`],
    ["Veri güveni", sampleReliable ? "Ölçülebilir" : "Ön sonuç"]
  ] : [
    ["Toplam işlem", result.totalTrades],
    ["Win rate", `${result.winRate.toFixed(1)}%`],
    ["Ortalama RR", result.averageRR.toFixed(2)],
    ["Profit factor", result.profitFactor.toFixed(2)],
    ["Max drawdown", `${result.maxDrawdown.toFixed(2)}R`],
    ["En iyi symbol", result.bestSymbol]
  ];
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
          <span className={`eyebrow playbook-eyebrow ${strategyId}`}>{playbookLabel(strategyId)} · Backtest</span>
          <h2>{replay ? "Son 1 ay runtime replay" : "Strategy bazlı runtime replay"}</h2>
        </div>
        <div className="panel-actions">
          {replay && <button className="ghost-btn" onClick={runAiReview} type="button" disabled={aiLoading}>{aiLoading ? "Gemini okuyor" : "AI replay yorumu"}</button>}
          <button className="ghost-btn" onClick={() => onRun()} type="button" disabled={loading}><RefreshCcw className={loading ? "spin" : ""} size={15} /> {loading ? "Replay çalışıyor" : "Son 1 ayı replay et"}</button>
        </div>
      </header>
      <div className="metric-grid">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {replay && (
        <>
          <div className={`replay-confidence-strip ${sampleReliable ? "reliable" : "building"}`}>
            <strong>{sampleReliable ? "Örneklem yeterli" : `Ön sonuç · ${replay.triggeredTrades}/${minimumReliableSample}`}</strong>
            <span>{sampleReliable ? "Kural karşılaştırmaları değerlendirilebilir." : "Bu veriyle sembol kapatılmaz veya strateji kuralı değiştirilmez."}</span>
          </div>
          <div className="replay-run-strip" aria-label="Replay çalışma özeti">
            <span><strong>{replay.availableDays.toFixed(0)} gün</strong> pencere</span>
            <span><strong>{replay.liveReadyEntries}</strong> READY</span>
            <span><strong>{replay.watchAlerts}</strong> WATCH</span>
            <span><strong>{replay.tp1Trades + replay.tp2Trades}/{replay.stoppedTrades}</strong> hedef/stop</span>
            <span><strong>{replay.totalR.toFixed(2)}R</strong> toplam</span>
          </div>
          {replay.sampleWarning && <p className="provider-warning">{replay.sampleWarning}</p>}
          <div className="strategy-learning-list replay-ai-review">
            <strong>AI replay yorumu</strong>
            {aiReview.commentary
              ? <p>{plainAiCommentary(aiReview.commentary)}</p>
              : <p className="muted-note">{aiReview.reason ?? "Son 1 ayı replay et, sonra Geminiye yorumlat."}</p>}
          </div>
          <div className="exit-compare">
            <strong>Çıkış modeli karşılaştırması</strong>
            <small className="exit-compare__lead">Aynı girişler, aynı mumlar — sadece çıkış kuralı farklı.</small>
            {replay.exitSample?.archived && (
              <small className="exit-compare__lead">
                Örnek: bu tarayıcıda biriken {replay.exitSample.trades} kapanmış işlem
                {replay.exitSample.since ? ` (${new Date(replay.exitSample.since).toLocaleDateString("tr-TR")} itibarıyla)` : ""} — tek replay'in 60 günlük sınırı aşıldı.
              </small>
            )}
            {replay.managementDecision && (
              <div className={`exit-compare__decision ${replay.managementDecision.ready ? "ready" : "building"}`}>
                <div className="exit-compare__progress" aria-label="Karar için örnek">
                  <span style={{ width: `${Math.min(100, (replay.managementDecision.sample / replay.managementDecision.required) * 100)}%` }} />
                </div>
                <b>{replay.managementDecision.sample}/{replay.managementDecision.required} işlem</b>
                <p>{replay.managementDecision.summary}</p>
              </div>
            )}
            {(replay.managementScenarios ?? []).length > 0 ? (
              <div className="exit-compare__table" role="table">
                <div className="exit-compare__row head" role="row">
                  <span role="columnheader">Model</span>
                  <span role="columnheader">Beklenti</span>
                  <span role="columnheader">Toplam</span>
                  <span role="columnheader">Kazanç / BE / Kayıp</span>
                  <span role="columnheader">Max DD</span>
                  <span role="columnheader">En iyi gün payı</span>
                  <span role="columnheader">Günlük σ</span>
                </div>
                {(replay.managementScenarios ?? []).map((item) => {
                  const decision = replay.managementDecision;
                  return (
                    <div key={item.id} className={`exit-compare__row${item.live ? " live" : ""}`} role="row">
                      <span role="cell" className="exit-compare__name">
                        <b>{item.label}</b>
                        <small>{item.description}</small>
                        <span className="exit-compare__tags">
                          {item.live && <em className="tag live">canlı</em>}
                          {decision?.bestExpectancyId === item.id && <em className="tag best">en yüksek beklenti</em>}
                          {decision?.mostConsistentId === item.id && <em className="tag steady">en tutarlı</em>}
                          {!item.live && item.verdict !== "needs-data" && <em className={`tag ${item.verdict}`}>{managementVerdictText(item)}</em>}
                        </span>
                      </span>
                      <span role="cell" data-label="Beklenti">{item.expectancyR.toFixed(2)}R</span>
                      <span role="cell" data-label="Toplam">{item.totalR.toFixed(2)}R</span>
                      <span role="cell" data-label="Kazanç / BE / Kayıp">%{item.winRate.toFixed(0)} / %{item.scratchRate.toFixed(0)} / %{item.lossRate.toFixed(0)}</span>
                      <span role="cell" data-label="Max DD">{item.maxDrawdown.toFixed(2)}R</span>
                      <span role="cell" data-label="En iyi gün payı">{typeof item.bestDayShare === "number" ? `%${Math.round(item.bestDayShare * 100)}` : "—"}</span>
                      <span role="cell" data-label="Günlük σ">{item.dailyStdR.toFixed(2)}R</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted-note">Karşılaştırma için tetiklenen CRT işlemi yok.</p>
            )}
            <small className="exit-compare__note">En iyi gün payı = en iyi günün R'ı / toplam R. Funded consistency kuralında düşük olan iyidir. Günlük σ düşükse günler daha dengelidir.</small>
          </div>
          <details className="replay-deep-dive">
            <summary>Detaylı replay analizi</summary>
            <div className="replay-deep-dive-body">
          <div className="strategy-learning-list replay-diagnosis-list">
            <strong>Replay teşhisi</strong>
            {replay.replayDiagnosis.map((item) => (
              <div key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="strategy-learning-list replay-filter-list">
            <strong>Filtre denemesi</strong>
            {replay.filterScenarios.map((item) => (
              <div key={item.id}>
                <span>{item.label}</span>
                <b>{verdictText(item.verdict)} · {item.expectancyR.toFixed(2)}R · PF {item.profitFactor.toFixed(2)}</b>
                <small>{item.triggered}/{item.sample} tetik · WR {item.winRate.toFixed(1)}% · DD {item.maxDrawdown.toFixed(2)}R · {item.description}</small>
              </div>
            ))}
          </div>
          <div className="strategy-learning-list replay-review-measurements">
            <strong>30+ işlem incelemesi ölçümleri</strong>
            {replay.reviewMeasurements ? (
              <>
                <div>
                  <span>EQ-RR (EQ = stop'un BE'ye çekildiği ara adım; çıkış DOL'da)</span>
                  <b>ort. {replay.reviewMeasurements.eqRr.mean.toFixed(2)}R · {replay.reviewMeasurements.eqRr.sample} işlem</b>
                  <small>{replay.reviewMeasurements.eqRr.below1} işlem &lt;1R · {replay.reviewMeasurements.eqRr.below1_5} işlem &lt;1.5R — EQ çok yakınsa stop erken BE'ye gelir, scratch artar.</small>
                </div>
                {replay.reviewMeasurements.unfilled && (
                  <div>
                    <span>Dolmayan girişlerin bıraktığı para</span>
                    <b>{replay.reviewMeasurements.unfilled.count} emir dolmadı · karşı-olgu {replay.reviewMeasurements.unfilled.cfTotalR.toFixed(2)}R</b>
                    <small>{replay.reviewMeasurements.unfilled.withCounterfactual} ölçülebilir · ort. {replay.reviewMeasurements.unfilled.cfAvgR.toFixed(2)}R · {replay.reviewMeasurements.unfilled.cfWins} kazanan — retest beklerken kaçan işlemler kapanıştan girilseydi.</small>
                  </div>
                )}
                {(replay.trackingScenarios ?? []).map((item) => (
                  <div key={item.id}>
                    <span>{item.label}</span>
                    <b>{item.triggered}/{item.sample} tetik · {item.expectancyR.toFixed(2)}R/işlem · PF {item.profitFactor.toFixed(2)}</b>
                    <small>toplam {item.totalR.toFixed(2)}R · WR {item.winRate.toFixed(1)}% — {item.description}</small>
                  </div>
                ))}
                {replay.reviewMeasurements.clusterDays.slice(0, 5).map((group) => (
                  <div key={`${group.day}-${group.cluster}-${group.exposure}`}>
                    <span>Küme günü · {group.day} · {group.cluster} ({group.exposure})</span>
                    <b>{group.trades} işlem aynı yönde · {group.totalR.toFixed(2)}R</b>
                    <small>{group.symbols.join(", ")} — korele risk tek -2R freniyle taşındı.</small>
                  </div>
                ))}
                {!replay.reviewMeasurements.clusterDays.length && (
                  <div><span>Küme günü</span><b>yok</b><small>Aynı gün aynı yönde ≥2 korele işlem oluşmadı.</small></div>
                )}
                {replay.reviewMeasurements.gradeBuckets.map((bucket) => (
                  <div key={`grade-${bucket.grade}`}>
                    <span>Grade {bucket.grade}</span>
                    <b>{bucket.trades} işlem · {bucket.expectancyR.toFixed(2)}R/işlem</b>
                    <small>toplam {bucket.totalR.toFixed(2)}R — sizing eğrisi doğrulaması.</small>
                  </div>
                ))}
                {replay.reviewMeasurements.killzoneBuckets.map((bucket) => (
                  <div key={`kz-${bucket.session}`}>
                    <span>Killzone {bucket.session}</span>
                    <b>{bucket.trades} işlem · {bucket.expectancyR.toFixed(2)}R/işlem</b>
                    <small>toplam {bucket.totalR.toFixed(2)}R — konfluens-değil-veto kararının katkısı.</small>
                  </div>
                ))}
              </>
            ) : <p className="muted-note">Replay çalıştırınca ölçümler burada birikir.</p>}
          </div>
          <div className="strategy-learning-list replay-symbol-list">
            <strong>Symbol bazlı sonuç</strong>
            {replay.bySymbol.map((row) => (
              <div key={row.symbol}>
                <span>{row.symbol}</span>
                <b>{row.watchAlerts} WATCH · {row.readyAlerts} replay entry</b>
                <small>{row.triggeredTrades} tetik · {row.totalR.toFixed(2)}R · ort. kalite {row.avgScore.toFixed(0)} · win {row.winRate.toFixed(1)}%</small>
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
                <strong>{trade.symbol} {trade.direction.toUpperCase()} · READY · {trade.status.toUpperCase()} · {trade.rMultiple.toFixed(2)}R</strong>
                <span>{new Date(trade.signalTime).toLocaleString()} · {trade.entrySource}/{trade.entryStatus} · {trade.sessionReference ?? "NONE"}→{trade.sessionTrigger ?? trade.session} · PD {trade.premiumDiscount} · HTF {trade.dailyBias}/{trade.h4Bias}</span>
                <small>MFE {trade.maxFavorableR.toFixed(2)}R · MAE {trade.maxAdverseR.toFixed(2)}R · RR {trade.rr.toFixed(2)} · {reasonText(trade.outcomeReason)}</small>
                <small>{trade.diagnosis}</small>
              </div>
            ))}
            {!replay.failureCases.length && <p className="muted-note">Negatif örnek yok; daha uzun pencereyle doğrula.</p>}
          </div>
          <div className="journal-entry-list replay-trade-list">
            {replay.trades.slice(0, 8).map((trade) => (
              <div key={trade.id}>
                <strong>{trade.symbol} {trade.direction.toUpperCase()} · LIVE READY · {trade.status.toUpperCase()} · {trade.rMultiple.toFixed(2)}R</strong>
                <span>{new Date(trade.signalTime).toLocaleString()} · kalite {trade.grade}/{trade.score} · {trade.entrySource}/{trade.stopSource}</span>
                <small>Entry {formatPrice(trade.entry)} · SL {formatPrice(trade.stopLoss)} · DOL {formatPrice(trade.target)} · MFE {trade.maxFavorableR.toFixed(2)}R · MAE {trade.maxAdverseR.toFixed(2)}R · {reasonText(trade.outcomeReason)} · {trade.note}</small>
              </div>
            ))}
            {!replay.trades.length && <p className="muted-note">Son 1 ayda replay entry tetiklenmedi; WATCH sayısına ve şartlara bak.</p>}
          </div>
          <div className="journal-entry-list replay-candidate-list">
            <strong>Aylık setup akışı</strong>
            {replay.candidates.slice(0, 18).map((candidate) => (
              <div key={candidate.id}>
                <strong>{candidate.symbol} {candidate.direction.toUpperCase()} · {candidate.stage.toUpperCase()} · Kalite {candidate.grade}/{candidate.score}</strong>
                <span>{new Date(candidate.signalTime).toLocaleString()} · {candidate.entrySource}/{candidate.entryStatus} · {candidate.sessionReference ?? "NONE"}→{candidate.sessionTrigger ?? "OUTSIDE"} · {candidate.governance}/{candidate.actionWindow}</span>
                {candidate.entryStatus === "fallback"
                  ? <small>Henüz plan yok · {candidate.decision}</small>
                  : <small>Entry {formatPrice(candidate.entry)} · SL {formatPrice(candidate.stopLoss)} · DOL {formatPrice(candidate.target)} · RR {candidate.rr.toFixed(2)} · {candidate.decision}</small>}
                {candidate.reasons.length > 0 && <small>Eksik: {candidate.reasons.slice(0, 3).join(" · ")}</small>}
              </div>
            ))}
            {!replay.candidates.length && <p className="muted-note">Replay scan çalıştı ama aday kaydı yok. Bu durumda veri warmup veya rule filtreleri çok sıkı olabilir.</p>}
          </div>
            </div>
          </details>
        </>
      )}
      <div className="equity-curve">
        {result.equityCurve.map((point, index) => <span key={`${point}-${index}`} style={{ height: `${Math.max(8, 30 + point * 8)}px` }} title={`${point}R`} />)}
      </div>
    </article>
  );
}
