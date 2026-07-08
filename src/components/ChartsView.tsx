import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DemoMarket } from "../data/demoData";
import { signalConfirmTimeframe, type FocusedTimeRange } from "../lib/charts/selectedSignal";
import type { Candle, MarketContext, Timeframe, TradingSignal } from "../lib/ict/types";
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

const TAB_TIMEFRAME: Record<ChartTab, Timeframe> = { m15: "15m", h1: "1h", h4: "4h", daily: "1d", weekly: "1w" };

// The tab a signal's setup structure belongs on: its confirmation timeframe (4H anchor ->
// 15m, 1D -> 1H, 1W -> 4H). ChoCH/POI/manipulation indices only make sense there.
function confirmTabFor(signal: TradingSignal): ChartTab {
  const tf = signalConfirmTimeframe(signal);
  return tf === "4h" ? "h4" : tf === "1h" ? "h1" : "m15";
}

const ANCHOR_TAB: Record<string, ChartTab> = { "4h": "h4", "1d": "daily", "1w": "weekly" };

// CRT lives on 4h/1d/1w depending on the setup. When a signal is selected, label the tab that
// actually holds ITS range candle as "CRT Range" and its confirmation tab as "Confirmation",
// instead of the static "4h = CRT / 1D = DOL" assumption.
function captionFor(item: { id: ChartTab; caption: string }, signal: TradingSignal | null): string {
  if (!signal?.crtAnchor) return item.caption;
  if (ANCHOR_TAB[signal.crtAnchor.rangeTf] === item.id) return "CRT Range";
  if (confirmTabFor(signal) === item.id) return "Confirmation";
  return item.caption;
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
  const selectedConfirmTab = activeSelectedSignal ? confirmTabFor(activeSelectedSignal) : null;
  // Selecting a signal jumps to ITS confirmation tab: a 1D-anchor setup opens on the 1H
  // chart where its ChoCH/manipulation structure actually lives, not on a generic 15m view.
  useEffect(() => {
    if (selectedConfirmTab) setActiveTab(selectedConfirmTab);
  }, [activeSelectedSignal?.id, selectedConfirmTab]);
  const tab = CHART_TABS.find((item) => item.id === activeTab) ?? CHART_TABS[0];
  const activeFocus = activeSelectedSignal && activeTab === selectedConfirmTab ? focusedTimeRange : undefined;
  // Each signal's chip belongs on its own confirmation tab; a 1D anchor's marker on the m15
  // chart would sit on an unrelated candle.
  const markerSignals = useMemo(() => symbolSignals.filter((signal) => confirmTabFor(signal) === activeTab), [symbolSignals, activeTab]);

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
              <span>{captionFor(item, activeSelectedSignal)}</span>
            </button>
          ))}
        </div>
        <CandleChart
          candles={candlesForTab(market, activeTab)}
          title={`${market.symbol} · ${tab.label} ${captionFor(tab, activeSelectedSignal)}`}
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
          signals={markerSignals}
          selectedSignal={activeSelectedSignal}
          focusedTimeRange={activeFocus}
          showSignalMarkers={showSignalMarkers}
          chartTimeframe={TAB_TIMEFRAME[activeTab]}
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
