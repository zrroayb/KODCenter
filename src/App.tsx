import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartsView } from "./components/ChartsView";
import { RecordsView } from "./components/RecordsView";
import { ScannerView } from "./components/ScannerView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { createDemoMarkets } from "./data/demoData";
import { runDemoBacktest } from "./lib/backtest/backtestEngine";
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
import { notifyReadySignalOnce } from "./lib/telegram/readyAlert";
import { ruleAllowsContext, ruleAllowsSignal } from "./lib/userRules/applyRules";
import { defaultRules } from "./lib/userRules/defaultRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./lib/userRules/scorePolicy";
import type { UserRules } from "./lib/userRules/userRules";

export type ViewId = "scanner" | "charts" | "records" | "settings";

const VIEW_TITLES: Record<ViewId, string> = {
  scanner: "Bugün ne var?",
  charts: "Chart",
  records: "Kayıtlar",
  settings: "Ayarlar"
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
  const [activeView, setActiveView] = useState<ViewId>("scanner");
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
    setBacktestResult(strategy.backtest({
      contexts,
      settings: {
        ...strategy.defaultSettings,
        minimumRR: rules.minimumRR,
        stopProfile: rules.stopProfile,
        useExecutionCosts: rules.useExecutionCosts,
        slippageStress: rules.slippageStress
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
    <div className="app-shell">
      <Sidebar activeView={activeView} onChange={setActiveView} />
      <main className="workspace">
        <header className={activeView === "charts" ? "topbar compact" : "topbar"}>
          <div className="topbar-title">
            <span className="eyebrow">Tradebot</span>
            <h1>{VIEW_TITLES[activeView]}</h1>
            {activeView !== "charts" && (
              <div className="topbar-meta" aria-label="Piyasa özeti">
                <span>{activeSymbol}</span>
                <span>{readyCount} ready</span>
                <span>{watchCount} watch</span>
                <span>{selectedSignal ? `${selectedSignal.symbol} ${selectedSignal.direction.toUpperCase()}` : "Sinyal seçili değil"}</span>
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
            {activeView !== "charts" && <span className="market-universe">{markets.map((market) => market.symbol).join(" · ")}</span>}
          </div>
        </header>
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
        {activeView === "records" && (
          <RecordsView
            signals={visibleSignals}
            inactiveSignals={inactiveSignals}
            selectedSignalId={selectedSignalState.selectedSignalId}
            rejectedSetups={rejectedSetups}
            backtestResult={backtestResult}
            memory={memory}
            journalEntries={journalEntries}
            onRunBacktest={runBacktest}
            onSelectSignal={selectSignal}
            onSelectSymbol={setActiveSymbol}
          />
        )}
        {activeView === "settings" && <SettingsView strategies={strategyRegistry} rules={rules} memory={memory} onRulesChange={setRules} />}
        <footer className="safety-note">
          Bu araç market analizi ve eğitim/araştırma içindir. Finansal tavsiye vermez ve işlem açmaz.
        </footer>
      </main>
    </div>
  );
}
