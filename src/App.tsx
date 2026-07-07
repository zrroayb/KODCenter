import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Bot, Moon, Plus, Search, Sparkles, UserCircle } from "lucide-react";
import { BacktestView } from "./components/BacktestView";
import { ChartsView } from "./components/ChartsView";
import { DashboardView } from "./components/DashboardView";
import { ScannerView } from "./components/ScannerView";
import { SettingsView } from "./components/SettingsView";
import { NAV_ITEMS, Sidebar } from "./components/Sidebar";
import { createDemoMarkets } from "./data/demoData";
import { runDemoBacktest } from "./lib/backtest/backtestEngine";
import { runMonthlyRuntimeReplay } from "./lib/backtest/runtimeReplay";
import { focusChartOnSignal, type SelectedSignalState } from "./lib/charts/selectedSignal";
import { buildDataHealthReport } from "./lib/data/dataHealth";
import { loadYahooMarkets, type MarketDataLoadResult } from "./lib/data/yahooProvider";
import type { MarketContext, MarketSymbol, TradingSignal } from "./lib/ict/types";
import { buildMarketContext } from "./lib/intelligence/marketContext";
import { attachSmtDivergences } from "./lib/intelligence/smtEngine";
import { loadJournalEntries, saveJournalEntries, upsertJournalEntry } from "./lib/journal/localJournal";
import type { JournalEntry } from "./lib/journal/types";
import { createSessionRuntimeMemory } from "./lib/memory/sessionRuntimeMemory";
import { buildSessionClock, formatTurkeySessionTime } from "./lib/session/sessionClock";
import { mergeReadyHoldSignals, type ReadyHoldRecord } from "./lib/signals/readyHold";
import type { RejectedSetup } from "./lib/strategies/types";
import { getStrategy, strategyRegistry } from "./lib/strategies/registry";
import { notifyRaidSignalOnce, notifyReadySignalOnce } from "./lib/telegram/readyAlert";
import { ruleAllowsContext, ruleAllowsSignal } from "./lib/userRules/applyRules";
import { defaultRules } from "./lib/userRules/defaultRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./lib/userRules/scorePolicy";
import type { UserRules } from "./lib/userRules/userRules";

export type ViewId = "dashboard" | "charts" | "scanner" | "backtest" | "journal" | "ai" | "settings";

const VIEW_TITLES: Record<ViewId, string> = {
  charts: "Chart",
  dashboard: "Dashboard",
  scanner: "Scanner",
  backtest: "Backtest",
  journal: "Journal",
  ai: "AI",
  settings: "Settings"
};
const AUTO_REFRESH_MS = 60_000;

function scanContexts(contexts: MarketContext[], strategyId: string, rules: UserRules) {
  const strategy = getStrategy(strategyId);
  const results = contexts
    .filter((context) => ruleAllowsContext(context, rules))
    .map((context) => strategy.scan({
      context,
      settings: {
        ...strategy.defaultSettings,
        minimumRR: rules.minimumRR,
        stopProfile: rules.stopProfile,
        useExecutionCosts: rules.useExecutionCosts,
        slippageStress: rules.slippageStress,
        partialTpEnabled: rules.partialTpEnabled,
        moveToBreakevenAtR: rules.moveToBreakevenAtR,
        maxDailyRiskPct: rules.maxDailyRiskPct,
        avoidNews: rules.avoidNews
      }
    }));
  const rawSignals = results.flatMap((result) => result.signals);
  return {
    signals: rawSignals
      .filter((signal) => ruleAllowsSignal(signal, rules))
      .slice(0, rules.maxSignalsPerScan),
    inactiveSignals: rawSignals
      .filter((signal) => signal.stage === "invalidated" || signal.stage === "missed")
      .slice(0, 24),
    rejected: results.flatMap((result) => result.rejectedSetups)
  };
}

function bestScanSignal(signals: TradingSignal[]): TradingSignal | undefined {
  return [...signals]
    .filter((signal) => signal.stage === "ready" || signal.stage === "watch")
    .sort((a, b) => {
      const stageScore = (b.stage === "ready" ? 1000 : 0) - (a.stage === "ready" ? 1000 : 0);
      return stageScore || b.score - a.score;
    })[0];
}

function decisionText(signal: TradingSignal | undefined) {
  if (!signal) return "No active trade. Wait for a clean CRT setup.";
  if (signal.stage === "ready") return `${signal.symbol} ${signal.direction.toUpperCase()} is ready. Entry, stop and DOL are defined.`;
  if (signal.stage === "watch") return `${signal.symbol} ${signal.direction.toUpperCase()} is on watch. Wait for confirmation before taking action.`;
  return `${signal.symbol} is no longer actionable. Wait for a fresh setup.`;
}

function FinanceDashboard({
  signals,
  inactiveSignals,
  rejectedSetups,
  backtestResult,
  memory,
  journalEntries,
  dataHealth,
  sessionName,
  onOpenChart,
  onRunScan,
  onRunBacktest
}: {
  signals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  backtestResult: ReturnType<typeof runDemoBacktest>;
  memory: ReturnType<typeof createSessionRuntimeMemory>;
  journalEntries: JournalEntry[];
  dataHealth: ReturnType<typeof buildDataHealthReport>;
  sessionName: string;
  onOpenChart: (signal: TradingSignal) => void;
  onRunScan: () => void;
  onRunBacktest: () => void;
}) {
  const best = bestScanSignal(signals);
  const ready = signals.filter((signal) => signal.stage === "ready").length;
  const watch = signals.filter((signal) => signal.stage === "watch").length;
  const recentJournal = journalEntries[0];
  const recentInactive = inactiveSignals[0];
  return (
    <section className="finance-dashboard">
      <article className="panel decision-hero">
        <div>
          <span className="eyebrow">AI Market Outlook</span>
          <h2>{decisionText(best)}</h2>
          <p>{best ? best.decisionSummary.shortSummary : "Scanner will surface only the cleanest decision candidates."}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-btn" onClick={best ? () => onOpenChart(best) : onRunScan} type="button">
            <Sparkles size={16} /> {best ? "Open setup" : "Run scanner"}
          </button>
          <button className="ghost-btn" onClick={onRunBacktest} type="button">Replay month</button>
        </div>
      </article>
      <div className="finance-card-grid">
        <article className="metric-card calm-card">
          <span>Today's Performance</span>
          <strong>{backtestResult.totalTrades}</strong>
          <small>model trades · PF {backtestResult.profitFactor.toFixed(2)}</small>
        </article>
        <article className="metric-card calm-card">
          <span>Scanner Alerts</span>
          <strong>{ready} / {watch}</strong>
          <small>ready / watch · {rejectedSetups.length} rejected</small>
        </article>
        <article className="metric-card calm-card">
          <span>Watchlist</span>
          <strong>{memory.activeSymbol}</strong>
          <small>{sessionName} · data {dataHealth.status}</small>
        </article>
        <article className="metric-card calm-card">
          <span>Recent Trades</span>
          <strong>{journalEntries.length}</strong>
          <small>{recentJournal ? `${recentJournal.symbol} ${recentJournal.direction}` : "no approved trades yet"}</small>
        </article>
        <article className="panel ai-snapshot-card">
          <span className="eyebrow">Scanner Summary</span>
          <h2>{best ? `${best.symbol} ${best.direction.toUpperCase()} · ${best.stage.toUpperCase()}` : "Nothing urgent"}</h2>
          <p>{best ? best.governance.summary : recentInactive?.decisionSummary.shortSummary ?? "No clean active setup is currently asking for attention."}</p>
        </article>
        <article className="panel ai-snapshot-card">
          <span className="eyebrow">Economic Calendar</span>
          <h2>{signals[0]?.context.eventRisk.level ?? "clear"}</h2>
          <p>{signals[0]?.context.eventRisk.summary ?? "No active event warning in the current workspace."}</p>
        </article>
      </div>
      <DashboardView
        signals={signals}
        inactiveSignals={inactiveSignals}
        rejectedSetups={rejectedSetups}
        backtestResult={backtestResult}
        memory={memory}
      />
    </section>
  );
}

function JournalView({ entries, signals, onSelectSignal }: { entries: JournalEntry[]; signals: TradingSignal[]; onSelectSignal: (signal: TradingSignal) => void }) {
  return (
    <section className="journal-page">
      <article className="panel decision-hero compact-hero">
        <div>
          <span className="eyebrow">Journal</span>
          <h2>{entries.length ? `${entries.length} local trade notes` : "Approved trades will live here."}</h2>
          <p>Each card keeps the decision, execution note and outcome together for later review.</p>
        </div>
      </article>
      <div className="journal-card-grid">
        {entries.map((entry) => {
          const signal = signals.find((item) => item.id === entry.tradeId);
          return (
            <article className="panel journal-trade-card" key={entry.tradeId}>
              <div className="journal-thumb">{entry.symbol.slice(0, 3)}</div>
              <div>
                <span className="eyebrow">{entry.tradeAction ?? "watch"}</span>
                <h2>{entry.symbol} {entry.direction.toUpperCase()}</h2>
                <p>{entry.notes || entry.outcomeNote || entry.mistake || "No note yet."}</p>
              </div>
              <div className="journal-stat-row">
                <span>RR <strong>{entry.rMultiple?.toFixed(2) ?? "open"}</strong></span>
                <span>Result <strong>{entry.result ?? "open"}</strong></span>
                <span>Emotion <strong>{entry.emotion ?? "—"}</strong></span>
              </div>
              {signal && <button className="ghost-btn" onClick={() => onSelectSignal(signal)} type="button">Open chart</button>}
            </article>
          );
        })}
        {!entries.length && (
          <article className="panel empty-state-card">
            <h2>No journal cards yet</h2>
            <p>Approve or note a setup from the chart detail panel and it will appear here.</p>
          </article>
        )}
      </div>
    </section>
  );
}

function AiWorkspace({ signal, signals, journalEntries }: { signal: TradingSignal | null; signals: TradingSignal[]; journalEntries: JournalEntry[] }) {
  const best = signal ?? bestScanSignal(signals) ?? null;
  const prompts = ["What deserves attention?", "Review my last trade", "Summarize scanner", "Improve this setup"];
  return (
    <section className="ai-workspace">
      <article className="ai-chat-shell">
        <header>
          <span className="brand-mark soft"><Bot size={20} /></span>
          <div>
            <span className="eyebrow">Finance AI</span>
            <h2>Decision coach</h2>
          </div>
        </header>
        <div className="message-stack">
          <div className="message assistant">
            <strong>Market read</strong>
            <p>{best ? best.decisionSummary.fullReasoning : "No active setup is demanding action right now."}</p>
          </div>
          <div className="message assistant">
            <strong>Journal memory</strong>
            <p>{journalEntries.length ? `${journalEntries.length} local notes are available for review.` : "No approved trade notes yet."}</p>
          </div>
        </div>
        <div className="suggested-prompts">
          {prompts.map((prompt) => <button key={prompt} type="button">{prompt}</button>)}
        </div>
      </article>
    </section>
  );
}

export default function App() {
  const demoMarkets = useMemo(() => createDemoMarkets(), []);
  const [markets, setMarkets] = useState(demoMarkets);
  const [dataState, setDataState] = useState<Omit<MarketDataLoadResult, "markets">>({
    source: "demo",
    feedMode: "demo",
    loadedAt: Date.now(),
    errors: []
  });
  const [dataLoading, setDataLoading] = useState(true);
  const [dataRefreshing, setDataRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const hasLoadedDataRef = useRef(false);
  const contexts = useMemo(
    () => attachSmtDivergences(markets.map((market) => buildMarketContext(market.symbol, market.timeframes))),
    [markets]
  );
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [activeSymbol, setActiveSymbol] = useState<MarketSymbol>("XAUUSD");
  const [strategyId] = useState(strategyRegistry[0].id);
  const [rules, setRules] = useState<UserRules>(defaultRules);
  const [selectedSignalState, setSelectedSignalState] = useState<SelectedSignalState>({
    selectedSignalId: null,
    showSelectedSignalOnly: true
  });
  const [showSignalMarkers, setShowSignalMarkers] = useState(true);
  const initial = useMemo(() => scanContexts(contexts, strategyId, rules), [contexts, strategyId, rules]);
  const [signals, setSignals] = useState<TradingSignal[]>(initial.signals);
  const [inactiveSignals, setInactiveSignals] = useState<TradingSignal[]>(initial.inactiveSignals);
  const [rejectedSetups, setRejectedSetups] = useState<RejectedSetup[]>(initial.rejected);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => loadJournalEntries());
  const [lastScanTime, setLastScanTime] = useState(Date.now());
  const [clockNow, setClockNow] = useState(Date.now());
  const [backtestResult, setBacktestResult] = useState(runDemoBacktest(contexts));
  const [memory, setMemory] = useState(() => createSessionRuntimeMemory(activeSymbol));
  const readyHoldRef = useRef<Record<string, ReadyHoldRecord>>({});
  const activeContext = contexts.find((context) => context.symbol === activeSymbol) ?? contexts[0];
  const activeMarket = markets.find((market) => market.symbol === activeSymbol) ?? markets[0];
  const dataHealth = useMemo(() => buildDataHealthReport(markets, dataState), [dataState, markets]);
  const visibleSignals = useMemo(() => signals.filter((signal) => ruleAllowsSignal(signal, rules)), [rules, signals]);
  const selectableSignals = useMemo(() => [...visibleSignals, ...inactiveSignals], [inactiveSignals, visibleSignals]);
  const selectedSignal = selectableSignals.find((signal) => signal.id === selectedSignalState.selectedSignalId) ?? null;
  const readyCount = visibleSignals.filter((signal) => signal.stage === "ready").length;
  const watchCount = visibleSignals.filter((signal) => signal.stage === "watch").length;
  const sessionClock = useMemo(() => buildSessionClock(clockNow), [clockNow]);
  const nextSessionStart = useMemo(
    () => formatTurkeySessionTime(sessionClock.nextStartsAt),
    [sessionClock.nextStartsAt]
  );
  const secondsToAutoRefresh = Math.max(0, Math.ceil((dataState.loadedAt + AUTO_REFRESH_MS - clockNow) / 1000));
  const lastDataRefreshLabel = useMemo(
    () => new Date(dataState.loadedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [dataState.loadedAt]
  );

  useEffect(() => {
    setRules((current) => current.minimumScore < MIN_VISIBLE_SIGNAL_SCORE
      ? { ...current, minimumScore: MIN_VISIBLE_SIGNAL_SCORE }
      : current);
  }, []);

  const refreshMarketData = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const shouldStayVisible = background && hasLoadedDataRef.current;
    if (shouldStayVisible) {
      setDataRefreshing(true);
    } else {
      setDataLoading(true);
    }
    try {
      const result = await loadYahooMarkets();
      setMarkets(result.markets);
      setDataState({
        source: result.source,
        feedMode: result.feedMode,
        loadedAt: result.loadedAt,
        errors: result.errors
      });
    } catch (error) {
      setMarkets(demoMarkets);
      setDataState({
        source: "demo",
        feedMode: "demo",
        loadedAt: Date.now(),
        errors: [error instanceof Error ? error.message : String(error)]
      });
    } finally {
      hasLoadedDataRef.current = true;
      setDataLoading(false);
      setDataRefreshing(false);
      refreshInFlightRef.current = false;
    }
  }, [demoMarkets]);

  useEffect(() => {
    void refreshMarketData();
  }, [refreshMarketData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshMarketData({ background: true });
    };
    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible" && Date.now() - dataState.loadedAt >= AUTO_REFRESH_MS) {
        refreshIfVisible();
      }
    };

    const intervalId = window.setInterval(refreshIfVisible, AUTO_REFRESH_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      window.clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [dataState.loadedAt, refreshMarketData]);

  useEffect(() => {
    const result = scanContexts(contexts, strategyId, rules);
    const scanTime = Date.now();
    const held = mergeReadyHoldSignals(result.signals, readyHoldRef.current, scanTime);
    readyHoldRef.current = held.records;
    setSignals(held.signals);
    setInactiveSignals(result.inactiveSignals);
    setRejectedSetups(result.rejected);
    setLastScanTime(scanTime);
  }, [contexts, rules, strategyId]);

  useEffect(() => {
    saveJournalEntries(journalEntries);
  }, [journalEntries]);

  useEffect(() => {
    if (dataLoading) return;
    for (const signal of visibleSignals.filter((item) => item.stage === "ready")) {
      void notifyReadySignalOnce(signal).then((result) => {
        if (result.status === "error") {
          console.warn("Telegram ready alert failed", result.error);
        }
      });
    }
    for (const signal of visibleSignals.filter((item) => item.stage === "watch" && item.crtAnchor?.raidActive)) {
      void notifyRaidSignalOnce(signal).then((result) => {
        if (result.status === "error") {
          console.warn("Telegram raid alert failed", result.error);
        }
      });
    }
  }, [dataLoading, visibleSignals, lastScanTime]);

  useEffect(() => {
    setSelectedSignalState((current) => {
      if (!current.selectedSignalId) return current;
      return selectableSignals.some((signal) => signal.id === current.selectedSignalId)
        ? current
        : { selectedSignalId: null, showSelectedSignalOnly: current.showSelectedSignalOnly };
    });
  }, [selectableSignals]);

  const runScan = () => {
    const result = scanContexts(contexts, strategyId, rules);
    const scanTime = Date.now();
    const held = mergeReadyHoldSignals(result.signals, readyHoldRef.current, scanTime);
    readyHoldRef.current = held.records;
    setSignals(held.signals);
    setInactiveSignals(result.inactiveSignals);
    setRejectedSetups(result.rejected);
    setLastScanTime(scanTime);
    setMemory((current) => ({
      ...current,
      scanHistory: [
        {
          time: scanTime,
          symbol: "ALL",
          strategyId,
          readySignals: held.signals.filter((signal) => signal.stage === "ready").length,
          rejectedSetups: result.rejected.length
        },
        ...current.scanHistory
      ].slice(0, 20)
    }));
    const firstSignal = bestScanSignal(held.signals);
    if (firstSignal) {
      setActiveSymbol(firstSignal.symbol);
      setSelectedSignalState((current) => ({
        selectedSignalId: firstSignal.id,
        focusedTimeRange: focusChartOnSignal(firstSignal),
        showSelectedSignalOnly: current.showSelectedSignalOnly
      }));
    } else {
      clearSelection();
    }
  };

  const runBacktest = () => {
    const strategy = getStrategy(strategyId);
    setBacktestResult(runMonthlyRuntimeReplay({
      markets,
      strategy,
      settings: {
        ...strategy.defaultSettings,
        minimumRR: rules.minimumRR,
        stopProfile: rules.stopProfile,
        useExecutionCosts: rules.useExecutionCosts,
        slippageStress: rules.slippageStress,
        partialTpEnabled: rules.partialTpEnabled,
        moveToBreakevenAtR: rules.moveToBreakevenAtR,
        maxDailyRiskPct: rules.maxDailyRiskPct,
        avoidNews: rules.avoidNews
      }
    }));
  };

  const clearSelection = () => {
    setSelectedSignalState((current) => ({
      selectedSignalId: null,
      showSelectedSignalOnly: current.showSelectedSignalOnly
    }));
  };

  const selectSignal = (signal: TradingSignal) => {
    setActiveSymbol(signal.symbol);
    setSelectedSignalState((current) => ({
      selectedSignalId: signal.id,
      focusedTimeRange: focusChartOnSignal(signal),
      showSelectedSignalOnly: current.showSelectedSignalOnly
    }));
    setActiveView("charts");
  };

  const saveSignalJournal = (signal: TradingSignal, patch: Partial<JournalEntry>) => {
    setJournalEntries((current) => upsertJournalEntry(current, signal, patch));
  };

  const selectAdjacentSignal = (step: 1 | -1) => {
    if (!visibleSignals.length) return;
    const currentIndex = selectedSignal ? visibleSignals.findIndex((signal) => signal.id === selectedSignal.id) : -1;
    const nextIndex = (currentIndex + step + visibleSignals.length) % visibleSignals.length;
    selectSignal(visibleSignals[nextIndex]);
  };

  useEffect(() => {
    setMemory((current) => ({
      ...current,
      activeSymbol,
      lastScanTime,
      latestBias: activeContext.bias.h4,
      previousBias: current.latestBias !== activeContext.bias.h4 ? current.latestBias : current.previousBias,
      recentSignals: visibleSignals,
      rejectedSetups,
      liquidityMap: activeContext.liquidityPools
    }));
  }, [activeContext, activeSymbol, lastScanTime, rejectedSetups, visibleSignals]);

  return (
    <div className={`app-shell view-${activeView}`}>
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <div className="app-main">
        <header className="finance-topnav">
          <div className="topnav-brand">
            <span className="brand-mark"><Sparkles size={20} /></span>
            <div>
              <strong>Finance AI</strong>
              <span>Decision workspace</span>
            </div>
          </div>
          <label className="topnav-search">
            <Search size={16} />
            <input readOnly aria-label="Search workspace" placeholder="Search markets, trades, notes" />
          </label>
          <div className="topnav-actions">
            <button className="icon-btn" type="button" aria-label="Notifications" title="Notifications"><Bell size={17} /></button>
            <button className="icon-btn" type="button" aria-label="Theme" title="Theme"><Moon size={17} /></button>
            <button className="profile-chip" type="button" aria-label="Profile"><UserCircle size={18} /><span>Ayberk</span></button>
          </div>
        </header>
        <main className="workspace">
          <header className={activeView === "charts" ? "topbar compact" : "topbar"}>
            <div className="topbar-title">
              <span className="eyebrow">Finance AI</span>
              <h1>{VIEW_TITLES[activeView]}</h1>
              {activeView !== "charts" && (
                <div className="topbar-meta" aria-label="Piyasa özeti">
                  <span>{activeSymbol}</span>
                  <span>{readyCount} ready</span>
                  <span>{watchCount} watch</span>
                  <span>{selectedSignal ? `${selectedSignal.symbol} ${selectedSignal.direction.toUpperCase()}` : "No active selection"}</span>
                </div>
              )}
            </div>
            <div className="topbar-actions">
            <div className={`session-clock ${sessionClock.activeSession === "Outside" ? "outside" : "active"}`} aria-label="Session durumu">
              <span>Session</span>
              <strong>{sessionClock.activeSession}</strong>
              <small>Sıradaki {sessionClock.display} · TR {nextSessionStart}</small>
            </div>
            <span className={`data-source-badge ${dataState.source}`}>
              {dataLoading ? "Veri yükleniyor" : dataRefreshing ? "Veri güncelleniyor" : dataState.source === "yahoo-live" ? "Yahoo live" : dataState.source === "mixed" ? "Yahoo + demo" : "Demo fallback"}
            </span>
            <span className={`auto-refresh-badge ${dataRefreshing ? "refreshing" : ""}`} title="Sayfa açıkken canlı veri otomatik yenilenir.">
              <span>Oto veri</span>
              <strong>{dataRefreshing ? "şimdi" : `${secondsToAutoRefresh}s`}</strong>
              <small>son {lastDataRefreshLabel}</small>
            </span>
            <button className="ghost-btn" onClick={() => void refreshMarketData()} type="button" disabled={dataLoading || dataRefreshing}>
              Veriyi yenile
            </button>
            {activeView !== "charts" && <span className="market-universe">{markets.length} market izleniyor</span>}
          </div>
        </header>
        {activeView === "dashboard" && (
          <FinanceDashboard
            signals={visibleSignals}
            inactiveSignals={inactiveSignals}
            rejectedSetups={rejectedSetups}
            backtestResult={backtestResult}
            memory={memory}
            journalEntries={journalEntries}
            dataHealth={dataHealth}
            sessionName={sessionClock.activeSession}
            onOpenChart={selectSignal}
            onRunScan={runScan}
            onRunBacktest={runBacktest}
          />
        )}
        {activeView === "scanner" && (
          <ScannerView
            marketCount={contexts.length}
            signals={visibleSignals}
            inactiveSignals={inactiveSignals}
            rejectedSetups={rejectedSetups}
            selectedSignalId={selectedSignalState.selectedSignalId}
            lastScanTime={lastScanTime}
            dataSource={dataState.source}
            dataLoading={dataLoading}
            dataErrors={dataState.errors}
            dataHealth={dataHealth}
            minimumRR={rules.minimumRR}
            onScan={runScan}
            onSelectSignal={selectSignal}
          />
        )}
        {activeView === "charts" && (
          <ChartsView
            market={activeMarket}
            context={activeContext}
            signals={visibleSignals}
            selectedSignal={selectedSignal}
            journalEntry={selectedSignal ? journalEntries.find((entry) => entry.tradeId === selectedSignal.id) : undefined}
            focusedTimeRange={selectedSignalState.focusedTimeRange}
            showSignalMarkers={showSignalMarkers}
            onSelectSignal={selectSignal}
            onClearSelection={clearSelection}
            onNextSignal={() => selectAdjacentSignal(1)}
            onPreviousSignal={() => selectAdjacentSignal(-1)}
            onToggleSignalMarkers={setShowSignalMarkers}
            onSaveJournal={saveSignalJournal}
          />
        )}
        {activeView === "backtest" && (
          <section className="analytics-page">
            <BacktestView result={backtestResult} onRun={runBacktest} />
          </section>
        )}
        {activeView === "journal" && (
          <JournalView
            entries={journalEntries}
            signals={[...visibleSignals, ...inactiveSignals]}
            onSelectSignal={selectSignal}
          />
        )}
        {activeView === "ai" && <AiWorkspace signal={selectedSignal} signals={visibleSignals} journalEntries={journalEntries} />}
        {activeView === "settings" && <SettingsView strategies={strategyRegistry} rules={rules} memory={memory} onRulesChange={setRules} />}
        <footer className="safety-note">
          Bu araç market analizi ve eğitim/araştırma içindir. Finansal tavsiye vermez ve işlem açmaz.
        </footer>
      </main>
      <nav className="mobile-tabbar" aria-label="Mobile navigation">
        {NAV_ITEMS.filter((item) => item.mobile).map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => setActiveView(item.id)} type="button">
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="quick-action-fab" type="button" aria-label="Quick action" title="Quick action">
        <Plus size={20} />
        <span>Quick</span>
      </button>
      </div>
    </div>
  );
}
