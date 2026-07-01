import { RefreshCcw } from "lucide-react";
import type { BacktestResult } from "../lib/analytics/performance";

export function BacktestView({ result, onRun }: { result: BacktestResult; onRun: () => void }) {
  const metrics = [
    ["Toplam işlem", result.totalTrades],
    ["Win rate", `${result.winRate.toFixed(1)}%`],
    ["Ortalama RR", result.averageRR.toFixed(2)],
    ["Profit factor", result.profitFactor.toFixed(2)],
    ["Max drawdown", `${result.maxDrawdown.toFixed(2)}R`],
    ["En iyi symbol", result.bestSymbol]
  ];
  return (
    <article className="panel">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Backtest</span>
          <h2>Strategy bazlı runtime replay</h2>
        </div>
        <button className="ghost-btn" onClick={onRun} type="button"><RefreshCcw size={15} /> Çalıştır</button>
      </header>
      <div className="metric-grid">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="equity-curve">
        {result.equityCurve.map((point, index) => <span key={`${point}-${index}`} style={{ height: `${Math.max(8, 30 + point * 8)}px` }} title={`${point}R`} />)}
      </div>
    </article>
  );
}
