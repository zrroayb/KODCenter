import type { BacktestResult } from "../lib/analytics/performance";
import type { RuntimeMarketMemory } from "../lib/memory/marketMemory";
import type { RejectedSetup } from "../lib/strategies/types";
import type { TradingSignal } from "../lib/ict/types";

export function DashboardView({
  signals,
  inactiveSignals,
  rejectedSetups,
  backtestResult,
  memory
}: {
  signals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  backtestResult: BacktestResult;
  memory: RuntimeMarketMemory;
}) {
  const ready = signals.filter((signal) => signal.stage === "ready");
  const avgQuality = signals.length ? signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length : 0;
  const best = [...signals].sort((a, b) => b.score - a.score)[0];
  const worst = [...signals].sort((a, b) => a.score - b.score)[0];
  const riskWarnings = signals.flatMap((signal) => signal.riskWarnings);
  const stats = [
    ["Market Bias", memory.latestBias],
    ["En iyi aktif setup", best ? `${best.symbol} ${best.direction}` : "Yok"],
    ["Bulunan sinyal", signals.length],
    ["Geçmiş setup", inactiveSignals.length],
    ["Elendi", rejectedSetups.length],
    ["Ortalama quality", avgQuality.toFixed(1)],
    ["En iyi symbol", best?.symbol ?? "—"],
    ["En zayıf symbol", worst?.symbol ?? "—"],
    ["Ready plan", ready.length],
    ["Risk uyarısı", riskWarnings.length]
  ];
  return (
    <section className="dashboard-grid">
      {stats.map(([label, value]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      <article className="panel wide">
        <header className="panel-head"><h2>Backtest Özeti</h2><span className="badge">Runtime</span></header>
        <p>{backtestResult.totalTrades} model trades · WR {backtestResult.winRate.toFixed(1)}% · PF {backtestResult.profitFactor.toFixed(2)} · DD {backtestResult.maxDrawdown.toFixed(2)}R</p>
      </article>
      <article className="panel wide">
        <header className="panel-head"><h2>Risk Uyarıları</h2><span className="badge">{riskWarnings.length}</span></header>
        {riskWarnings.length ? <ul className="warning-list">{riskWarnings.slice(0, 6).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : <p>Aktif risk uyarısı yok.</p>}
      </article>
    </section>
  );
}
