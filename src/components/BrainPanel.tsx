import type { MarketContext, TradingSignal } from "../lib/ict/types";

export function BrainPanel({ signal, context, compact = false }: { signal?: TradingSignal; context: MarketContext; compact?: boolean }) {
  const summary = signal?.decisionSummary;
  return (
    <article className={compact ? "panel brain-panel compact" : "panel brain-panel"}>
      <header className="panel-head">
        <div>
          <span className="eyebrow">Financial Brain</span>
          <h2>Karar özeti</h2>
        </div>
        <span className="badge">{summary ? `${summary.confidence}/100` : "Setup yok"}</span>
      </header>
      <section className="brain-read">
        <span>Market Okuması</span>
        <strong>{summary?.shortSummary ?? `${context.symbol}: Daily ${context.bias.daily}, H4 ${context.bias.h4}.`}</strong>
        <p>{summary?.fullReasoning ?? "Karar özeti üretmek için scanner çalıştır."}</p>
      </section>
      <div className="brain-columns">
        <section>
          <h3>Checklist</h3>
          <div className="checklist">
            {(summary?.checklist ?? []).map((item) => (
              <div className={item.status} key={item.label}>
                <b>{item.status.toUpperCase()}</b>
                <span>{item.label}</span>
                <small>{item.explanation}</small>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>Neden fail olabilir</h3>
          <ul className="warning-list">{(summary?.warnings ?? ["Henüz uyarı yok."]).map((warning) => <li key={warning}>{warning}</li>)}</ul>
          <h3>Invalidation</h3>
          <ul className="warning-list">{(summary?.invalidation ?? ["Invalidation henüz map edilmedi."]).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>
    </article>
  );
}
