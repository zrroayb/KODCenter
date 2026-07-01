import type { MarketSymbol, TradingSignal } from "../lib/ict/types";
import { formatPrice, formatR } from "../lib/ict/format";

export function SignalsView({
  signals,
  selectedSignalId,
  onSelectSignal,
  onSelectSymbol
}: {
  signals: TradingSignal[];
  selectedSignalId: string | null;
  onSelectSignal: (signal: TradingSignal) => void;
  onSelectSymbol: (symbol: MarketSymbol) => void;
}) {
  return (
    <article className="panel">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Sinyaller</span>
          <h2>Sinyal listesi</h2>
        </div>
        <span className="badge">{signals.length}</span>
      </header>
      <div className="signal-table">
        {signals.map((signal) => (
          <button
            className={selectedSignalId === signal.id ? "signal-row selected" : "signal-row"}
            key={signal.id}
            onClick={() => {
              onSelectSymbol(signal.symbol);
              onSelectSignal(signal);
            }}
            type="button"
          >
            <span className={`status-dot ${signal.stage}`} />
            <strong>{signal.symbol}</strong>
            <span>{signal.direction.toUpperCase()}</span>
            <span>{signal.stage}</span>
            <span>{signal.grade} · {signal.score}</span>
            <span>{formatPrice(signal.plan.entry)}</span>
            <span>{formatPrice(signal.plan.stopLoss)}</span>
            <span>{formatR(signal.plan.rr)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
