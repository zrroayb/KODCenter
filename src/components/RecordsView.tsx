import { BacktestView } from "./BacktestView";
import { DashboardView } from "./DashboardView";
import { SignalsView } from "./SignalsView";
import type { BacktestResult } from "../lib/analytics/performance";
import type { MarketSymbol, TradingSignal } from "../lib/ict/types";
import { journalInsights } from "../lib/journal/journalAnalyzer";
import type { JournalEntry } from "../lib/journal/types";
import type { RuntimeMarketMemory } from "../lib/memory/marketMemory";
import type { RejectedSetup } from "../lib/strategies/types";

function actionText(entry: JournalEntry) {
  if (entry.tradeAction === "taken") return "ALINDI";
  if (entry.tradeAction === "skipped") return "PAS";
  if (entry.tradeAction === "missed") return "KAÇTI";
  return "İZLEME";
}

function JournalPanel({ entries }: { entries: JournalEntry[] }) {
  const insights = journalInsights(entries);
  return (
    <article className="panel wide">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Local Journal</span>
          <h2>Notlardan strateji okuması</h2>
        </div>
        <span className="badge">{entries.length}</span>
      </header>
      <div className="metric-grid">
        {insights.map((insight) => (
          <div key={insight.label}>
            <span>{insight.label}</span>
            <strong>{insight.value}</strong>
            <small>{insight.detail}</small>
          </div>
        ))}
      </div>
      <div className="journal-entry-list">
        {entries.slice(0, 8).map((entry) => (
          <div key={entry.tradeId}>
            <strong>{entry.symbol} {entry.direction.toUpperCase()} · {actionText(entry)} · {entry.result ?? "open"}</strong>
            <span>{entry.notes || entry.outcomeNote || entry.mistake || "Not yok"}</span>
            <small>
              {new Date(entry.updatedAt).toLocaleString()} · {entry.executionQuality ?? "kalite yok"}
              {typeof entry.actualEntry === "number" ? ` · entry ${entry.actualEntry}` : ""}
              {typeof entry.actualExit === "number" ? ` · exit ${entry.actualExit}` : ""}
              {typeof entry.rMultiple === "number" ? ` · ${entry.rMultiple.toFixed(2)}R` : ""}
            </small>
          </div>
        ))}
        {!entries.length && <p className="muted-note">Chart detayındaki Local Journal alanından not kaydet.</p>}
      </div>
    </article>
  );
}

export function RecordsView({
  signals,
  inactiveSignals,
  selectedSignalId,
  rejectedSetups,
  backtestResult,
  memory,
  journalEntries,
  onRunBacktest,
  onSelectSignal,
  onSelectSymbol
}: {
  signals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  selectedSignalId: string | null;
  rejectedSetups: RejectedSetup[];
  backtestResult: BacktestResult;
  memory: RuntimeMarketMemory;
  journalEntries: JournalEntry[];
  onRunBacktest: () => void;
  onSelectSignal: (signal: TradingSignal) => void;
  onSelectSymbol: (symbol: MarketSymbol) => void;
}) {
  return (
    <section className="records-layout">
      <SignalsView
        signals={signals}
        selectedSignalId={selectedSignalId}
        onSelectSignal={onSelectSignal}
        onSelectSymbol={onSelectSymbol}
      />
      <DashboardView
        signals={signals}
        inactiveSignals={inactiveSignals}
        rejectedSetups={rejectedSetups}
        backtestResult={backtestResult}
        memory={memory}
      />
      <JournalPanel entries={journalEntries} />
      <BacktestView result={backtestResult} onRun={onRunBacktest} />
    </section>
  );
}
