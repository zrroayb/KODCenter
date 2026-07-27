import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Clock3, Play, Sparkles } from "lucide-react";
import type { TradingSignal } from "../lib/ict/types";
import type { RejectedSetup } from "../lib/strategies/types";
import { buildMarketPickPayload, fetchGeminiMarketPick, type GeminiMarketPickResponse } from "../lib/gemini/marketPick";
import { formatPrice, formatR } from "../lib/ict/format";
import type { MarketDataSource } from "../lib/data/yahooProvider";
import type { DataHealthReport } from "../lib/data/dataHealth";
import { signalDecisionLabel, signalDecisionReason, signalHardInvalidReason } from "../lib/signals/signalClassification";
import { buildStructureAudit } from "../lib/signals/structureAudit";
import { closeConfirmationRequirement, entryRetestRequirement } from "../lib/signals/waitingGuidance";
import { signalConfirmTimeframe } from "../lib/charts/selectedSignal";
import { playbookShortLabel } from "../lib/strategies/playbookLabels";

function stagePriority(signal: TradingSignal) {
  if (signal.stage === "ready") return 3000;
  if (signal.stage === "watch") return 2000;
  if (signal.stage === "missed") return 500;
  return 0;
}

function sortForAction(signals: TradingSignal[]) {
  return [...signals].sort((a, b) => {
    const stageScore = stagePriority(b) - stagePriority(a);
    return stageScore || b.score - a.score || b.plan.rr - a.plan.rr;
  });
}

function simpleDirectionText(signal: TradingSignal) {
  return signal.direction === "long" ? "yukarı" : "aşağı";
}

function simpleSweepText(signal: TradingSignal) {
  const rangeTf = (signal.crtAnchor?.rangeTf ?? "4h").toUpperCase();
  return signal.direction === "long"
    ? `${rangeTf} CRT low alınsın. Mum kapanışı beklenmez.`
    : `${rangeTf} CRT high alınsın. Mum kapanışı beklenmez.`;
}

function stopSourceText(signal: TradingSignal) {
  if (signal.plan.stopSource === "sweep") return signal.direction === "short" ? "sweep high üstü" : "sweep low altı";
  if (signal.plan.stopSource === "fvg") return signal.direction === "short" ? "FVG üstü" : "FVG altı";
  if (signal.plan.stopSource === "swing") return signal.direction === "short" ? "swing high üstü" : "swing low altı";
  if (signal.plan.stopSource === "manipulation") return signal.direction === "short" ? "manipulation wick üstü" : "manipulation wick altı";
  return "volatility floor";
}

function dataHealthTitle(report: DataHealthReport) {
  if (report.status === "ok") return "Veri kullanılabilir";
  if (report.status === "warning") return "Veri uyarılı ama okunabilir";
  return "Veri zayıf, dikkat";
}

function dataHealthSummary(report: DataHealthReport) {
  if (report.status === "ok") return "Canlı veri akıyor. Sinyal kararında data tarafı ekstra engel çıkarmıyor.";
  if (report.source === "demo") return "Canlı veri alınamadığı için demo/fallback devrede. READY sinyali gelse bile gerçek işlem kararı verme.";
  return "Bazı marketlerde veri gecikmesi veya HTF yaş uyarısı var. Sinyali okuyabilirsin ama chartta teyit etmeden karar verme.";
}

export function waitingRequirements(signal: TradingSignal): string[] {
  return waitingRequirementsForMinimumRR(signal, 1.5);
}

export function waitingRequirementsForMinimumRR(signal: TradingSignal, minimumRR: number): string[] {
  if (signal.stage === "ready") return ["Plan hazır: giriş, stop ve hedef belli."];
  if (signal.stage === "invalidated") return ["Bu fikir bozuldu. Kovalamadan yeni setup bekle."];
  if (signal.stage === "missed") {
    const entryMissed = signal.plan.planWarnings.find((warning) => warning.includes("Entry kaçtı"));
    return [entryMissed ?? "Fiyat hedefe gitmiş veya entry kaçmış. Geç kalındı, yeni giriş bekle."];
  }
  const hardInvalid = signalHardInvalidReason(signal);
  if (hardInvalid) return [hardInvalid];
  const confTf = signalConfirmTimeframe(signal);
  const needs: string[] = [];
  const closeRequirement = closeConfirmationRequirement(signal);
  const retestRequirement = entryRetestRequirement(signal);
  const passedLabels = new Set(signal.decisionSummary.checklist.filter((item) => item.status === "pass").map((item) => item.label));
  if (signal.crtAnchor?.originClosed === false) {
    needs.push(`${(signal.crtAnchor.rangeTf ?? "4h").toUpperCase()} CRT range mumu kapansın.`);
  }
  if (!passedLabels.has("Manipulation")) {
    needs.push(simpleSweepText(signal));
  }
  if (!signal.plan.entryModel.cisdConfirmed) {
    needs.push(closeRequirement
      ? `${closeRequirement.label} kapanmalı. ${closeRequirement.reason}`
      : `${confTf} mum ${simpleDirectionText(signal)} tarafa iç yapıyı kırarak kapanmalı.`);
  }
  if (signal.plan.entryModel.cisdConfirmed && signal.plan.entryStatus !== "confirmed") {
    needs.push(retestRequirement ?? "Dağılım kapanışı onaylansın; sonra giriş planı aktif olsun.");
  }
  if (signal.plan.executionCosts.stress !== "off" && signal.plan.grossRR >= minimumRR && signal.plan.rr < minimumRR) {
    needs.push(`Spread/slippage fazla. Kağıt üstünde ${formatR(signal.plan.grossRR)}, gerçek hesapta ${formatR(signal.plan.rr)}.`);
  }
  if (signal.plan.rr < minimumRR) {
    needs.push(`Kazanç mesafesi yetmiyor. En az ${formatR(minimumRR)} lazım, şu an ${formatR(signal.plan.rr)}.`);
  }
  if (signal.actionWindow.status === "expired" || signal.actionWindow.status === "inactive") {
    needs.push(signal.actionWindow.summary);
  }
  for (const blocker of signal.governance.blockers) {
    if (blocker.includes("Manipulation") || blocker.includes("ChoCH") || blocker.includes("RR minimum")) continue;
    needs.push(blocker);
  }
  return Array.from(new Set(needs)).slice(0, 3);
}

function DataHealthPanel({ report }: { report: DataHealthReport }) {
  const newestIssues = report.issues.slice(0, 4);
  return (
    <article className={`panel data-health-panel ${report.status}`}>
      <header className="panel-head">
        <div>
          <span className="eyebrow">Veri durumu</span>
          <h2>{dataHealthTitle(report)}</h2>
        </div>
        <span className="badge">{report.source}</span>
      </header>
      <p className="data-health-readable">{dataHealthSummary(report)}</p>
      {newestIssues.length > 0 && (
        <ul className="data-health-simple-list">
          {newestIssues.slice(0, 2).map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <details className="compact-details data-health-details">
        <summary>Teknik veri detayları</summary>
        <div className="data-health-grid">
          {report.rows.map((row) => (
            <div key={row.symbol}>
              <strong>{row.symbol}</strong>
              <span>
                {row.source} · {row.feedMode} · exec lag {Number.isFinite(row.executionLagMinutes) ? `${row.executionLagMinutes} dk` : "yok"} · HTF yaş {Number.isFinite(row.htfAgeMinutes) ? `${row.htfAgeMinutes} dk` : "yok"} · 1D yaş {Number.isFinite(row.dailyAgeMinutes) ? `${row.dailyAgeMinutes} dk` : "yok"}
              </span>
              <small>5m {row.counts.m5} · 15m {row.counts.m15} · 1h {row.counts.h1} · 4h {row.counts.h4} · 1D {row.counts.daily} · 1W {row.counts.weekly} · 1M {row.counts.monthly}</small>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

export function ScannerView({
  marketCount,
  signals,
  lowQualitySignals,
  inactiveSignals,
  rejectedSetups,
  selectedSignalId,
  lastScanTime,
  dataSource,
  dataLoading,
  dataErrors,
  dataHealth,
  minimumRR,
  onScan,
  onSelectSignal
}: {
  marketCount: number;
  signals: TradingSignal[];
  lowQualitySignals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  selectedSignalId: string | null;
  lastScanTime: number;
  dataSource: MarketDataSource;
  dataLoading: boolean;
  dataErrors: string[];
  dataHealth: DataHealthReport;
  minimumRR: number;
  onScan: () => void;
  onSelectSignal: (signal: TradingSignal) => void;
}) {
  const sortedSignals = dataLoading ? [] : sortForAction(signals);
  // İki playbook ayrı gösterilir (owner: "reversal vs continuation ayrı, aynı sinyali iki kez gösterme").
  // Continuation kendi bölümünü GÖRÜNÜR + GİZLİ havuzun birleşiminden çeker; böylece CRT'nin yüksek-RR
  // watch'ları görünür cap'i doldursa bile trend-devamı setup'ları asla ekrandan düşmez.
  const seenPool = new Set<string>();
  const dedupedPool = [...signals, ...lowQualitySignals].filter((signal) => {
    if (seenPool.has(signal.id)) return false;
    seenPool.add(signal.id);
    return true;
  });
  const continuationSignals = dataLoading
    ? []
    : sortForAction(dedupedPool.filter((signal) => signal.strategyId === "trend-continuation")).slice(0, 8);
  // Chop (zıt raid çakışması) sembollerini tek satıra indir: iki competing sinyal yerine bir
  // "chop, dur" satırı. Chop olmayanlar normal gösterilir.
  const reversalRaw = signals.filter((signal) => signal.strategyId !== "trend-continuation");
  const seenChopSymbols = new Set<string>();
  const reversalSignals = reversalRaw.filter((signal) => {
    if (!signal.chopConflict) return true;
    if (seenChopSymbols.has(signal.symbol)) return false;
    seenChopSymbols.add(signal.symbol);
    return true;
  });
  const sortedLowQualitySignals = dataLoading
    ? []
    : sortForAction(lowQualitySignals.filter((signal) => signal.strategyId !== "trend-continuation")).slice(0, 8);
  const best = sortedSignals.find((signal) => signal.stage === "ready" || signal.stage === "watch");
  // Desk view: the moment the scan lands, the AI reads the whole board and names ONE pick
  // ("bence şunu al, şu daha zayıf çünkü ...") — re-generated only when the board changes.
  const [deskView, setDeskView] = useState<GeminiMarketPickResponse | null>(null);
  const [deskLoading, setDeskLoading] = useState(false);
  const deskKey = `${lastScanTime}:${dataSource}:${signals.map((signal) => `${signal.id}-${signal.stage}`).join(",")}`;
  const lastDeskKey = useRef("");
  useEffect(() => {
    if (dataLoading || lastDeskKey.current === deskKey) return;
    lastDeskKey.current = deskKey;
    let cancelled = false;
    setDeskLoading(true);
    fetchGeminiMarketPick(buildMarketPickPayload(signals, dataSource, marketCount))
      .then((view) => {
        if (!cancelled) setDeskView(view);
      })
      .finally(() => {
        if (!cancelled) setDeskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deskKey, dataLoading, signals, dataSource, marketCount]);
  const latestInactive = inactiveSignals[0];
  const readySignals = signals.filter((signal) => signal.stage === "ready");
  const actionState = dataLoading
    ? "loading"
    : !best
      ? "empty"
      : best.stage === "ready"
        ? "tradeable"
        : "watch";
  const actionIcon = actionState === "tradeable" ? <CircleCheck size={20} /> : actionState === "watch" || actionState === "loading" ? <Clock3 size={20} /> : <CircleAlert size={20} />;
  const actionTitle =
    actionState === "loading"
      ? "Veri yükleniyor"
      : actionState === "tradeable"
        ? "İşlem adayı var"
        : actionState === "watch"
          ? "Şu an alınacak trade yok"
          : "Şu an işlem yok";
  const actionReason = best
    ? best.stage === "ready"
      ? best.decisionSummary.shortSummary
      : signalDecisionReason(best)
      : latestInactive?.stage === "invalidated"
        ? "Son görünen setup stop/invalidation gördü; yeni setup bekleniyor."
        : latestInactive?.stage === "missed"
          ? signalDecisionReason(latestInactive)
        : "Kurallara göre güvenli aday yok. Bekle, zorlamıyoruz.";
  const bestRequirements = best ? waitingRequirementsForMinimumRR(best, minimumRR) : [];
  const bestAudit = best ? buildStructureAudit(best) : null;
  const simpleRequirements = bestRequirements.slice(0, 3);
  const dataLabel = dataLoading
    ? "Yükleniyor"
    : dataSource === "yahoo-live"
      ? "Yahoo proxy"
      : dataSource === "mixed"
        ? "Live + fallback"
        : "Demo fallback";
  return (
    <section className="view-grid">
      <article className={`panel trade-now-panel ${actionState}`}>
        <header className="trade-now-head">
          <span>{actionIcon}</span>
          <div>
            <span className="eyebrow">Tek bakış</span>
            <h2>{actionTitle}</h2>
          </div>
        </header>
        {best ? (
          <>
            <div className="trade-now-main">
              <strong>{best.symbol} · {best.direction.toUpperCase()}</strong>
              <span>{bestAudit?.headline ?? signalDecisionLabel(best)} · Kalite {best.grade}/{best.score}</span>
            </div>
            <div className="simple-plan-grid">
              <div><span>Entry</span><strong>{formatPrice(best.plan.entry)}</strong></div>
              <div><span>SL</span><strong>{formatPrice(best.plan.stopLoss)}</strong></div>
              <div><span>EQ/TP1</span><strong>{formatPrice(best.plan.targets[0])}</strong></div>
              <div><span>EQ RR</span><strong>{formatR(best.plan.managementRR ?? 0)}</strong></div>
              <div><span>DOL RR</span><strong>{formatR(best.plan.rr)}</strong></div>
            </div>
            <section className="simple-structure-box">
              <strong>Yapı okuması</strong>
              <p>{bestAudit?.decision ?? actionReason}</p>
              <div>
                {(bestAudit?.items ?? []).slice(0, 4).map((item) => (
                  <span className={`structure-chip ${item.status}`} key={item.label}>{item.label}</span>
                ))}
              </div>
            </section>
            {(best.governance.blockers.length > 0 || best.governance.warnings.length > 0) && (
              <div className="requirements-box governance-box">
                <strong>Risk masası notu</strong>
                <ul>
                  {[...best.governance.blockers, ...best.governance.warnings].slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {best.stage !== "ready" && simpleRequirements.length > 0 && (
              <div className="requirements-box">
                <strong>Ne bekliyoruz?</strong>
                <ul>
                  {simpleRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
                </ul>
              </div>
            )}
            <details className="trade-technical-details">
              <summary>Teknik detay</summary>
              <div className="trade-plan-grid">
                <div><span>Entry model</span><strong>{best.plan.entrySource}</strong></div>
                <div><span>Gross RR</span><strong>{formatR(best.plan.grossRR)}</strong></div>
                <div><span>Friction</span><strong>{best.plan.executionCosts.stress === "off" ? "kapalı" : formatPrice(best.plan.executionCosts.total)}</strong></div>
                <div><span>Stop nedeni</span><strong>{stopSourceText(best)}</strong></div>
                <div><span>Risk</span><strong>{formatPrice(best.plan.riskDistance)}</strong></div>
                <div><span>Rejim</span><strong>{best.context.regime.type}</strong></div>
                <div><span>Veri güveni</span><strong>{best.context.dataConfidence.grade} · {best.context.dataConfidence.score}</strong></div>
                <div><span>Event</span><strong>{best.context.eventRisk.level}</strong></div>
                <div><span>Window</span><strong>{best.actionWindow.status}</strong></div>
                <div><span>Replay</span><strong>{best.outcome.status}</strong></div>
                <div><span>Governance</span><strong>{best.governance.status}</strong></div>
              </div>
              {bestRequirements.length > simpleRequirements.length && (
                <ul className="technical-requirements">
                  {bestRequirements.slice(simpleRequirements.length).map((requirement) => <li key={requirement}>{requirement}</li>)}
                </ul>
              )}
            </details>
            <button className="ghost-btn trade-now-button" onClick={() => onSelectSignal(best)} type="button">
              Chartta aç <ArrowRight size={16} />
            </button>
          </>
        ) : (
          <p className="trade-now-reason">{dataLoading ? "Canlı veriler geldikten sonra en iyi aday burada görünecek." : actionReason}</p>
        )}
      </article>
      <article className={`panel market-pick-panel ${deskView?.status ?? "loading"}`}>
        <header className="panel-head">
          <div>
            <span className="eyebrow">AI</span>
            <h2><Sparkles size={15} /> Masa görüşü</h2>
          </div>
          <span className="badge">{deskLoading ? "yazıyor…" : deskView?.status === "ready" ? deskView.model ?? "Gemini" : "lokal analiz"}</span>
        </header>
        <p className="market-pick-text">
          {deskLoading && !deskView
            ? "AI masaya bakıyor; adaylar kıyaslanıyor…"
            : deskView?.commentary ?? "Tarama sonucu geldiğinde masa görüşü burada olacak."}
        </p>
      </article>
      <article className="panel hero-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">Scanner</span>
            <h2>Market radar</h2>
          </div>
          <button className="primary-btn" onClick={onScan} type="button" disabled={dataLoading}>
            <Play size={16} /> {dataLoading ? "Veri yükleniyor" : "Tara"}
          </button>
        </header>
        <div className="scan-summary">
          <div><span>Son tarama</span><strong>{new Date(lastScanTime).toLocaleTimeString()}</strong></div>
          <div><span>Market</span><strong>{marketCount}</strong></div>
          <div><span>Veri</span><strong>{dataLabel}</strong></div>
          <div><span>Sinyal</span><strong>{signals.length} / {readySignals.length} ready</strong></div>
          <div><span>Geçmiş</span><strong>{inactiveSignals.length}</strong></div>
        </div>
        {dataErrors.length > 0 && (
          <div className={`provider-warning ${dataSource}`}>
            <strong>Veri uyarısı</strong>
            {dataErrors.slice(0, 4).map((error) => <span key={error}>{error}</span>)}
          </div>
        )}
        {(best ?? latestInactive) && (
          <div className={`decision-strip ${(best ?? latestInactive)?.stage}`}>
            <strong>{best ? signalDecisionLabel(best) : "GEÇMİŞ"} · {(best ?? latestInactive)?.direction.toUpperCase()} {(best ?? latestInactive)?.stage.toUpperCase()}{(best ?? latestInactive) && <span className={`playbook-tag ${(best ?? latestInactive)!.strategyId}`}>{playbookShortLabel((best ?? latestInactive)!.strategyId)}</span>}{(best ?? latestInactive)?.counterTrend && <span className="counter-trend-tag">trende karşı</span>}</strong>
            <span>
              {best
                ? `Entry ${formatPrice(best.plan.entry)} · SL ${formatPrice(best.plan.stopLoss)} · Net RR ${formatR(best.plan.rr)} · Stop ${stopSourceText(best)}`
                : "Aktif trade adayı değil; stop/missed durumunda yeni setup beklenir."}
            </span>
          </div>
        )}
      </article>
      <article className="panel">
        <header className="panel-head"><h2>CRT Reversal <span className="playbook-tag crt">Reversal</span></h2><span className="badge">{reversalSignals.length}</span></header>
        <div className="scan-signal-list">
          {reversalSignals.map((signal) => (
            <button
              className={selectedSignalId === signal.id ? "scan-signal-card selected" : "scan-signal-card"}
              key={signal.id}
              onClick={() => onSelectSignal(signal)}
              type="button"
            >
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol}{signal.chopConflict ? "" : ` ${signal.direction.toUpperCase()}`} <span className={`playbook-tag ${signal.strategyId}`}>{playbookShortLabel(signal.strategyId)}</span>{signal.chopConflict ? <span className="chop-tag">chop · dur</span> : signal.counterTrend && <span className="counter-trend-tag">trende karşı</span>}</strong>
              {signal.chopConflict ? (
                <>
                  <b className="chop-note">Zıt yönlü raid</b>
                  <small>Üst timeframe'lerde long ve short raid çakışıyor; yön yok, LTF onayı gelene kadar bekle.</small>
                </>
              ) : (
                <>
                  <b>Kalite {signal.grade}/{signal.score}</b>
                  <small>{signalDecisionLabel(signal)} · {signal.stage.toUpperCase()} · Entry {formatPrice(signal.plan.entry)} · Net RR {formatR(signal.plan.rr)}</small>
                  {signal.stage !== "ready" && (
                    <em>Ne olmalı? {waitingRequirementsForMinimumRR(signal, minimumRR).slice(0, 2).join(" · ") || "Daha temiz confirmation bekleniyor."}</em>
                  )}
                </>
              )}
            </button>
          ))}
          {!reversalSignals.length && <p className="muted-note">Mevcut runtime kurallarına uyan görünür reversal sinyali yok.</p>}
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Trend Continuation <span className="playbook-tag trend-continuation">Continuation</span></h2><span className="badge">{continuationSignals.length}</span></header>
        <div className="scan-signal-list">
          {continuationSignals.map((signal) => (
            <button
              className={selectedSignalId === signal.id ? "scan-signal-card selected" : "scan-signal-card"}
              key={signal.id}
              onClick={() => onSelectSignal(signal)}
              type="button"
            >
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol} {signal.direction.toUpperCase()} <span className={`playbook-tag ${signal.strategyId}`}>{playbookShortLabel(signal.strategyId)}</span></strong>
              <b>Kalite {signal.grade}/{signal.score}</b>
              <small>{signalDecisionLabel(signal)} · {signal.stage.toUpperCase()} · Entry {formatPrice(signal.plan.entry)} · Net RR {formatR(signal.plan.rr)}</small>
              {signal.stage !== "ready" && (
                <em>Ne olmalı? {waitingRequirementsForMinimumRR(signal, minimumRR).slice(0, 2).join(" · ") || "HTF trend + kabullü breakout + pullback bekleniyor."}</em>
              )}
            </button>
          ))}
          {!continuationSignals.length && <p className="muted-note">Şu an trend-devamı setup'ı yok; HTF trend + kabullü breakout (BOS) + pullback FVG/OB retest bekleniyor.</p>}
        </div>
      </article>
      <details className="scanner-more">
        <summary>Geçmiş, veri ve erken adaylar</summary>
        <div className="scanner-more-body">
      <article className="panel">
        <header className="panel-head"><h2>Geçmiş / bozulmuş setup</h2><span className="badge">{inactiveSignals.length}</span></header>
        <div className="scan-signal-list">
          {inactiveSignals.slice(0, 8).map((signal) => (
            <button className="scan-signal-card inactive" key={signal.id} onClick={() => onSelectSignal(signal)} type="button">
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol} {signal.direction.toUpperCase()}</strong>
              <b>{signal.stage.toUpperCase()}</b>
              <small>{signalDecisionReason(signal)}</small>
                <em>Entry {formatPrice(signal.plan.entry)} · SL {formatPrice(signal.plan.stopLoss)} · EQ {formatPrice(signal.plan.targets[0])} · DOL {formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}</em>
            </button>
          ))}
          {!inactiveSignals.length && <p className="muted-note">Stop olmuş veya missed setup yok.</p>}
        </div>
      </article>
      <DataHealthPanel report={dataHealth} />
      <article className="panel wide">
        <header className="panel-head"><h2>Erken aday / elendi</h2><span className="badge">{sortedLowQualitySignals.length + rejectedSetups.length}</span></header>
        <div className="scan-signal-list">
          {sortedLowQualitySignals.map((signal) => (
            <button
              className={selectedSignalId === signal.id ? "scan-signal-card low-quality selected" : "scan-signal-card low-quality"}
              key={signal.id}
              onClick={() => onSelectSignal(signal)}
              type="button"
            >
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol} {signal.direction.toUpperCase()} <span className={`playbook-tag ${signal.strategyId}`}>{playbookShortLabel(signal.strategyId)}</span></strong>
              <b>Kalite {signal.grade}/{signal.score}</b>
              <small>Erken aday · {signalDecisionLabel(signal)} · Net RR {formatR(signal.plan.rr)}</small>
              <em>{signalDecisionReason(signal)}</em>
            </button>
          ))}
        </div>
        <div className="list-stack compact-list">
          {rejectedSetups.slice(0, Math.max(0, 8 - sortedLowQualitySignals.length)).map((item) => (
            <div className="row-item" key={`${item.symbol}-${item.reason}`}>
              <strong>{item.symbol}</strong>
              <span>{item.reason}</span>
              <b>{item.score}</b>
            </div>
          ))}
          {!sortedLowQualitySignals.length && !rejectedSetups.length && <p className="muted-note">Erken aday yok.</p>}
        </div>
      </article>
        </div>
      </details>
    </section>
  );
}
