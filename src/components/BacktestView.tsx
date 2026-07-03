import { RefreshCcw } from "lucide-react";
import type { BacktestResult } from "../lib/analytics/performance";
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
  if (verdict === "tighten") return "Sıkılaştır";
  if (verdict === "keep") return "Koru";
  if (verdict === "relax") return "Gevşet";
  return "İncele";
}

export function BacktestView({ result, onRun }: { result: BacktestResult; onRun: () => void }) {
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
    ["READY alert", replay.readyAlerts],
    ["WATCH setup", replay.watchAlerts],
    ["TP / SL", `${replay.tp1Trades + replay.tp2Trades} / ${replay.stoppedTrades}`],
    ["Toplam R", `${replay.totalR.toFixed(2)}R`]
  ] : [];
  return (
    <article className="panel">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Backtest</span>
          <h2>{replay ? "Son 1 ay runtime replay" : "Strategy bazlı runtime replay"}</h2>
        </div>
        <button className="ghost-btn" onClick={onRun} type="button"><RefreshCcw size={15} /> Son 1 ayı replay et</button>
      </header>
      <div className="metric-grid">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {replay && (
        <>
          <div className="metric-grid replay-metric-grid">
            {replayMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          {replay.sampleWarning && <p className="provider-warning">{replay.sampleWarning}</p>}
          <div className="strategy-learning-list replay-symbol-list">
            <strong>Symbol bazlı sonuç</strong>
            {replay.bySymbol.map((row) => (
              <div key={row.symbol}>
                <span>{row.symbol}</span>
                <b>{row.totalR.toFixed(2)}R</b>
                <small>{row.readyAlerts} READY · {row.triggeredTrades} tetik · win {row.winRate.toFixed(1)}%</small>
              </div>
            ))}
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
          <div className="journal-entry-list replay-trade-list">
            {replay.trades.slice(0, 8).map((trade) => (
              <div key={trade.id}>
                <strong>{trade.symbol} {trade.direction.toUpperCase()} · {trade.status.toUpperCase()} · {trade.rMultiple.toFixed(2)}R</strong>
                <span>{new Date(trade.signalTime).toLocaleString()} · grade {trade.grade} · score {trade.score}</span>
                <small>Entry {formatPrice(trade.entry)} · SL {formatPrice(trade.stopLoss)} · TP1 {formatPrice(trade.target)} · {reasonText(trade.outcomeReason)} · {trade.note}</small>
              </div>
            ))}
            {!replay.trades.length && <p className="muted-note">Son 1 ayda READY trade tetiklenmedi; WATCH sayısına ve şartlara bak.</p>}
          </div>
        </>
      )}
      <div className="equity-curve">
        {result.equityCurve.map((point, index) => <span key={`${point}-${index}`} style={{ height: `${Math.max(8, 30 + point * 8)}px` }} title={`${point}R`} />)}
      </div>
    </article>
  );
}
