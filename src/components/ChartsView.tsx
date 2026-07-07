import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DemoMarket } from "../data/demoData";
import type { FocusedTimeRange } from "../lib/charts/selectedSignal";
import type { Candle, MarketContext, TradingSignal } from "../lib/ict/types";
import { formatPrice } from "../lib/ict/format";
import type { JournalEntry } from "../lib/journal/types";
import { CandleChart } from "./CandleChart";
import { SignalDetailsPanel } from "./SignalDetailsPanel";

type ChartTab = "m15" | "h1" | "h4" | "daily" | "weekly";

const CHART_TABS: Array<{ id: ChartTab; label: string; caption: string; mode: "execution" | "confirmation" | "context" | "daily" }> = [
  { id: "m15", label: "15m", caption: "execution", mode: "execution" },
  { id: "h1", label: "1h", caption: "confirmation", mode: "confirmation" },
  { id: "h4", label: "4h", caption: "CRT Range", mode: "context" },
  { id: "daily", label: "1D", caption: "DOL", mode: "daily" },
  { id: "weekly", label: "1W", caption: "CRT", mode: "daily" }
];

function candlesForTab(market: DemoMarket, tab: ChartTab): Candle[] {
  if (tab === "m15") return market.timeframes.m15;
  if (tab === "h1") return market.timeframes.h1;
  if (tab === "h4") return market.timeframes.h4;
  if (tab === "weekly") return market.timeframes.weekly;
  return market.timeframes.daily;
}

function MarketContextPanel({ context, signals }: { context: MarketContext; signals: TradingSignal[] }) {
  const activeKillzone = context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const ready = signals.filter((signal) => signal.stage === "ready").length;
  const smt = context.smtDivergences[0];
  return (
    <aside className="panel market-context-panel">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Market Özeti</span>
          <h2>{context.symbol}</h2>
        </div>
        <span className="badge">{context.crt.selectedBias.direction}</span>
      </header>
      <div className="detail-grid">
        <div><span>Monthly</span><strong>{context.bias.monthly}</strong></div>
        <div><span>Weekly</span><strong>{context.bias.weekly}</strong></div>
        <div><span>Daily</span><strong>{context.bias.daily}</strong></div>
        <div><span>H4</span><strong>{context.bias.h4}</strong></div>
        <div><span>DOL</span><strong>{formatPrice(context.crt.selectedBias.drawLevel)}</strong></div>
        <div><span>PD Zone</span><strong>{context.premiumDiscount.zone}</strong></div>
        <div><span>Killzone</span><strong>{activeKillzone}</strong></div>
        <div><span>SMT</span><strong>{smt ? `${smt.direction} vs ${smt.partner}` : "yok"}</strong></div>
        <div><span>Sinyal</span><strong>{signals.length} / {ready} ready</strong></div>
        <div><span>Rejim</span><strong>{context.regime.type}</strong></div>
        <div><span>Event</span><strong>{context.eventRisk.level}</strong></div>
        <div><span>Veri güveni</span><strong>{context.dataConfidence.grade} · {context.dataConfidence.score}</strong></div>
      </div>
      <section className="details-section">
        <h3>CRT Range</h3>
        <p>High {formatPrice(context.crt.activeRange.high)} · EQ {formatPrice(context.crt.activeRange.midpoint)} · Low {formatPrice(context.crt.activeRange.low)}</p>
        <p>{context.crt.selectedBias.summary}</p>
        <p>{context.regime.summary}</p>
        <p>{context.eventRisk.summary}</p>
      </section>
    </aside>
  );
}

export function ChartsView({
  market,
  context,
  signals,
  selectedSignal,
  journalEntry,
  focusedTimeRange,
  showSignalMarkers,
  onSelectSignal,
  onClearSelection,
  onNextSignal,
  onPreviousSignal,
  onToggleSignalMarkers,
  onSaveJournal
}: {
  market: DemoMarket;
  context: MarketContext;
  signals: TradingSignal[];
  selectedSignal?: TradingSignal | null;
  journalEntry?: JournalEntry;
  focusedTimeRange?: FocusedTimeRange;
  showSignalMarkers: boolean;
  onSelectSignal: (signal: TradingSignal) => void;
  onClearSelection: () => void;
  onNextSignal: () => void;
  onPreviousSignal: () => void;
  onToggleSignalMarkers: (show: boolean) => void;
  onSaveJournal: (signal: TradingSignal, patch: Partial<JournalEntry>) => void;
}) {
  const [activeTab, setActiveTab] = useState<ChartTab>("m15");
  const symbolSignals = useMemo(() => signals.filter((signal) => signal.symbol === market.symbol), [market.symbol, signals]);
  const activeSelectedSignal = selectedSignal?.symbol === market.symbol ? selectedSignal : null;
  const tab = CHART_TABS.find((item) => item.id === activeTab) ?? CHART_TABS[0];
  const activeFocus = activeSelectedSignal && activeTab === "m15" ? focusedTimeRange : undefined;

  return (
    <section className={activeSelectedSignal ? "charts-workspace with-selection" : "charts-workspace single-chart-mode"}>
      <div className="charts-main">
        <header className="chart-toolbar">
          <div>
            <h2>{market.symbol}</h2>
          </div>
          <div className="chart-actions">
            <label className="marker-toggle"><input type="checkbox" checked={showSignalMarkers} onChange={(event) => onToggleSignalMarkers(event.target.checked)} /> Marker</label>
            <button className="ghost-btn icon-action" onClick={onPreviousSignal} type="button" disabled={!signals.length} aria-label="Önceki sinyal" title="Önceki"><ChevronLeft size={16} /></button>
            <button className="ghost-btn icon-action" onClick={onNextSignal} type="button" disabled={!signals.length} aria-label="Sonraki sinyal" title="Sonraki"><ChevronRight size={16} /></button>
            <button className="ghost-btn icon-action" onClick={onClearSelection} type="button" disabled={!activeSelectedSignal} aria-label="Seçimi temizle" title="Temizle"><X size={16} /></button>
          </div>
        </header>
        <div className="timeframe-tabs" role="tablist" aria-label="Chart timeframe">
          {CHART_TABS.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)} type="button">
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </button>
          ))}
        </div>
        <CandleChart
          candles={candlesForTab(market, activeTab)}
          title={`${market.symbol} · ${tab.label} ${tab.caption}`}
          mode={tab.mode}
          range={activeSelectedSignal?.crtAnchor
            ? {
                high: activeSelectedSignal.crtAnchor.rangeHigh,
                low: activeSelectedSignal.crtAnchor.rangeLow,
                midpoint: (activeSelectedSignal.crtAnchor.rangeHigh + activeSelectedSignal.crtAnchor.rangeLow) / 2,
                source: `CRT ${activeSelectedSignal.crtAnchor.rangeTf} range`
              }
            : context.crt.activeRange}
          context={context}
          signals={symbolSignals}
          selectedSignal={activeSelectedSignal}
          focusedTimeRange={activeFocus}
          showSignalMarkers={showSignalMarkers && activeTab === "m15"}
          onSelectSignal={onSelectSignal}
        />
      </div>
      <div className={activeSelectedSignal ? "selection-dock" : "selection-dock context-strip"}>
        {activeSelectedSignal ? (
          <SignalDetailsPanel signal={activeSelectedSignal} journalEntry={journalEntry} onClear={onClearSelection} onSaveJournal={onSaveJournal} />
        ) : (
          <MarketContextPanel context={context} signals={symbolSignals} />
        )}
      </div>
    </section>
  );
}
