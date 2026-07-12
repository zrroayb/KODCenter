import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Sparkles } from "lucide-react";
import { BacktestView } from "./components/BacktestView";
import { ChartsView } from "./components/ChartsView";
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
import { notifyCrtContextSignalOnce, notifyRaidSignalOnce, notifyReadySignalOnce } from "./lib/telegram/readyAlert";
import { ruleAllowsContext, ruleAllowsSignal } from "./lib/userRules/applyRules";
import { defaultRules } from "./lib/userRules/defaultRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./lib/userRules/scorePolicy";
import type { UserRules } from "./lib/userRules/userRules";

export type ViewId = "dashboard" | "charts" | "scanner" | "backtest" | "journal" | "ai" | "settings";

const VIEW_TITLES: Record<ViewId, string> = {
  charts: "Chart",
  dashboard: "Bugün",
  scanner: "Tara",
  backtest: "Replay",
  journal: "Notlar",
  ai: "AI",
  settings: "Ayar"
};
const AUTO_REFRESH_MS = 60_000;
const SIGNAL_STAGE_RANK: Record<TradingSignal["stage"], number> = { ready: 4, watch: 3, missed: 2, invalidated: 1 };

function compareSignalsByDecision(a: TradingSignal, b: TradingSignal) {
  return (SIGNAL_STAGE_RANK[b.stage] ?? 0) - (SIGNAL_STAGE_RANK[a.stage] ?? 0)
    || b.score - a.score
    || b.plan.rr - a.plan.rr;
}

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
  const activeSignals = rawSignals
    .filter((signal) => signal.stage !== "invalidated" && signal.stage !== "missed")
    .sort(compareSignalsByDecision);
  const visibleCandidates = activeSignals.filter((signal) => ruleAllowsSignal(signal, rules));
  const visibleSignals = visibleCandidates.slice(0, rules.maxSignalsPerScan);
  const hiddenCandidates = [
    ...activeSignals.filter((signal) => !ruleAllowsSignal(signal, rules)),
    ...visibleCandidates.slice(rules.maxSignalsPerScan)
  ];
  const seenHiddenSignals = new Set<string>();
  const hiddenSignals = hiddenCandidates
    .filter((signal) => {
      if (seenHiddenSignals.has(signal.id)) return false;
      seenHiddenSignals.add(signal.id);
      return true;
    })
    .slice(0, 24);
  const inactiveSignals = rawSignals
    .filter((signal) => signal.stage === "invalidated" || signal.stage === "missed")
    .sort(compareSignalsByDecision);
  return {
    signals: visibleSignals,
    hiddenSignals,
    inactiveSignals: inactiveSignals.slice(0, 24),
    rejected: results.flatMap((result) => result.rejectedSetups)
  };
}

function bestScanSignal(signals: TradingSignal[]): TradingSignal | undefined {
  return [...signals]
    .filter((signal) => signal.stage === "ready" || signal.stage === "watch")
    .sort(compareSignalsByDecision)[0];
}

function decisionText(signal: TradingSignal | undefined) {
  if (!signal) return "Temiz trade yok.";
  if (signal.stage === "ready") return `${signal.symbol} hazır.`;
  if (signal.stage === "watch") return `${signal.symbol} bekle.`;
  return `${signal.symbol} geçersiz.`;
}

function stageText(signal: TradingSignal) {
  if (signal.stage === "ready") return "Hazır";
  if (signal.stage === "watch") return "Bekle";
  if (signal.stage === "invalidated") return "Geçersiz";
  return "Kaçtı";
}

function aiCardHint(signal: TradingSignal, rank: number) {
  if (signal.stage === "ready" && rank === 0) return "Öncelik";
  if (signal.stage === "ready") return "Plan var";
  if (signal.score >= 75) return "Onay bekle";
  if (signal.score >= 55) return "Radar";
  return "Zayıf";
}

function shortReason(text: string | undefined, fallback = "Bekle"): string {
  const clean = (text ?? fallback)
    .replace(/^AI:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = clean.toLocaleLowerCase("tr-TR");
  if (lower.includes("turtle soup") || lower.includes("purge") || lower.includes("sweep")) return "Likidite alındı, onay bekle.";
  if (lower.includes("raid")) return "Raid var, onay bekle.";
  if (lower.includes("dealing range") || lower.includes("premium") || lower.includes("discount")) return "Bölge uygun değil.";
  if (lower.includes("htf") || lower.includes("anlatı")) return "Üst zaman ters.";
  if (lower.includes("killzone") || lower.includes("session")) return "Saat zayıf.";
  if (lower.includes("choch") || lower.includes("mss") || lower.includes("kapan")) return "Kapanış onayı yok.";
  if (lower.includes("rr") || lower.includes("risk")) return "RR yetmiyor.";
  if (lower.includes("anchor") || lower.includes("key seviye")) return "Key seviye yok.";
  if (lower.includes("poi") || lower.includes("entry") || lower.includes("giriş")) return "Giriş alanı bekle.";
  return clean.length > 46 ? `${clean.slice(0, 43)}...` : clean;
}

function signalReason(signal: TradingSignal): string {
  return shortReason(
    signal.stage === "ready"
      ? signal.decisionSummary.shortSummary
      : signal.plan.planWarnings[0] ?? signal.governance.blockers[0] ?? signal.decisionSummary.shortSummary,
    signal.stage === "ready" ? "Plan hazır" : "Onay bekle"
  );
}

function rankedDecisionSignals(signals: TradingSignal[]) {
  return [...signals]
    .filter((signal) => signal.stage === "ready" || signal.stage === "watch")
    .sort(compareSignalsByDecision);
}

function FinanceDashboard({
  signals,
  hiddenSignals,
  rejectedSetups,
  backtestResult,
  journalEntries,
  dataHealth,
  sessionName,
  onOpenChart,
  onRunScan,
  onRunBacktest
}: {
  signals: TradingSignal[];
  hiddenSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  backtestResult: ReturnType<typeof runDemoBacktest>;
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
  const ranked = rankedDecisionSignals(signals).slice(0, 5);
  const lowQualitySignals = rankedDecisionSignals(hiddenSignals).slice(0, 5);
  const nearMisses = [...rejectedSetups].sort((a, b) => b.score - a.score).slice(0, 5);
  const displayedCount = ranked.length || lowQualitySignals.length || nearMisses.length;
  return (
    <section className="finance-dashboard simple-dashboard">
      <article className={`panel decision-hero simple-hero ${best?.stage ?? "empty"}`}>
        <div>
          <span className="eyebrow">Karar</span>
          <h2>{decisionText(best)}</h2>
          <p>{best ? signalReason(best) : "Zorlamıyoruz. Net setup gelince burada çıkar."}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-btn" onClick={best ? () => onOpenChart(best) : onRunScan} type="button">
            <Sparkles size={16} /> {best ? "Aç" : "Tara"}
          </button>
          <button className="ghost-btn" onClick={onRunBacktest} type="button">Replay</button>
        </div>
      </article>

      <div className="decision-board">
        <article className="panel decision-list-card">
          <header>
            <div>
              <span className="eyebrow">Radar</span>
              <h2>{ranked.length ? `En iyi ${displayedCount}` : displayedCount ? `${displayedCount} yakın aday` : "Aday yok"}</h2>
            </div>
            <button className="ghost-btn" type="button" onClick={onRunScan}>Tara</button>
          </header>
          <div className="decision-signal-list">
            {ranked.map((signal, index) => (
              <button className={`decision-signal-card ${signal.stage}`} key={signal.id} type="button" onClick={() => onOpenChart(signal)}>
                <span className="decision-rank">{index + 1}</span>
                <span className="decision-main">
                  <strong>{signal.symbol}</strong>
                  <small>{signal.direction.toUpperCase()} · {aiCardHint(signal, index)}</small>
                </span>
                <span className="decision-meta">
                  <strong>{signal.score}</strong>
                  <small>{signal.grade} · {stageText(signal)}</small>
                </span>
                <span className="decision-reason">{signalReason(signal)}</span>
              </button>
            ))}
            {!ranked.length && (
              lowQualitySignals.length ? lowQualitySignals.map((signal, index) => (
                <button className={`decision-signal-card low-quality ${signal.stage}`} key={signal.id} type="button" onClick={() => onOpenChart(signal)}>
                  <span className="decision-rank">{index + 1}</span>
                  <span className="decision-main">
                    <strong>{signal.symbol}</strong>
                    <small>{signal.direction.toUpperCase()} · Düşük ihtimal</small>
                  </span>
                  <span className="decision-meta">
                    <strong>{signal.score}</strong>
                    <small>{signal.grade} · Açılabilir</small>
                  </span>
                  <span className="decision-reason">{signalReason(signal)}</span>
                </button>
              )) : nearMisses.length ? nearMisses.map((setup, index) => (
                <div className="decision-signal-card rejected" key={`${setup.symbol}-${setup.reason}-${index}`}>
                  <span className="decision-rank">{index + 1}</span>
                  <span className="decision-main">
                    <strong>{setup.symbol}</strong>
                    <small>Bekle</small>
                  </span>
                  <span className="decision-meta">
                    <strong>{setup.score}</strong>
                    <small>Aday</small>
                  </span>
                  <span className="decision-reason">{shortReason(setup.reason)}</span>
                </div>
              )) : (
                <div className="empty-decision-state">
                  <strong>Bekle.</strong>
                  <span>Net CRT setup gelince burada görünür.</span>
                </div>
              )
            )}
          </div>
        </article>

        <aside className="dashboard-brief">
          <article className="metric-card calm-card">
            <span>Sinyal</span>
            <strong>{ready} / {watch}</strong>
            <small>ready / watch</small>
          </article>
          <article className="metric-card calm-card">
            <span>Veri</span>
            <strong>{dataHealth.status}</strong>
            <small>{sessionName}</small>
          </article>
          <article className="metric-card calm-card">
            <span>Replay</span>
            <strong>{backtestResult.profitFactor.toFixed(2)} PF</strong>
            <small>{backtestResult.totalTrades} işlem</small>
          </article>
          <article className="metric-card calm-card">
            <span>Not</span>
            <strong>{journalEntries.length}</strong>
            <small>lokal</small>
          </article>
        </aside>
      </div>
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
  const [hiddenSignals, setHiddenSignals] = useState<TradingSignal[]>(initial.hiddenSignals);
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
  const chartSignals = useMemo(() => [...visibleSignals, ...hiddenSignals], [hiddenSignals, visibleSignals]);
  const selectableSignals = useMemo(() => [...chartSignals, ...inactiveSignals], [chartSignals, inactiveSignals]);
  const selectedSignal = selectableSignals.find((signal) => signal.id === selectedSignalState.selectedSignalId) ?? null;
  const readyCount = visibleSignals.filter((signal) => signal.stage === "ready").length;
  const watchCount = visibleSignals.filter((signal) => signal.stage === "watch").length;
  const sessionClock = useMemo(() => buildSessionClock(clockNow), [clockNow]);
  const nextSessionStart = useMemo(
    () => formatTurkeySessionTime(sessionClock.nextStartsAt),
    [sessionClock.nextStartsAt]
  );
  const secondsToAutoRefresh = Math.max(0, Math.ceil((dataState.loadedAt + AUTO_REFRESH_MS - clockNow) / 1000));
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
    setHiddenSignals(result.hiddenSignals);
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
    for (const signal of visibleSignals.filter((item) => item.stage === "watch" && !item.crtAnchor?.raidActive)) {
      void notifyCrtContextSignalOnce(signal).then((result) => {
        if (result.status === "error") {
          console.warn("Telegram CRT context alert failed", result.error);
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
    setHiddenSignals(result.hiddenSignals);
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

  const refreshAndScan = async () => {
    await refreshMarketData({ background: hasLoadedDataRef.current });
    runScan();
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

  // Picking a pair from the chart rail switches to it and auto-opens its most tradeable setup
  // (live READY beats watch, higher score breaks ties) so the "en mantıklı CRT" shows at once.
  const selectSymbolBest = (symbol: MarketSymbol) => {
    setActiveSymbol(symbol);
    const best = chartSignals
      .filter((signal) => signal.symbol === symbol)
      .sort(compareSignalsByDecision)[0];
    if (best) {
      setSelectedSignalState((current) => ({
        selectedSignalId: best.id,
        focusedTimeRange: focusChartOnSignal(best),
        showSelectedSignalOnly: current.showSelectedSignalOnly
      }));
    } else {
      setSelectedSignalState((current) => ({ ...current, selectedSignalId: null, focusedTimeRange: undefined }));
    }
  };

  const saveSignalJournal = (signal: TradingSignal, patch: Partial<JournalEntry>) => {
    setJournalEntries((current) => upsertJournalEntry(current, signal, patch));
  };

  const selectAdjacentSignal = (step: 1 | -1) => {
    if (!chartSignals.length) return;
    const currentIndex = selectedSignal ? chartSignals.findIndex((signal) => signal.id === selectedSignal.id) : -1;
    const nextIndex = (currentIndex + step + chartSignals.length) % chartSignals.length;
    selectSignal(chartSignals[nextIndex]);
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
        </header>
        <main className="workspace">
          <header className={activeView === "charts" ? "topbar compact" : "topbar"}>
            <div className="topbar-title">
              <h1>{VIEW_TITLES[activeView]}</h1>
              {activeView !== "charts" && (
                <div className="topbar-meta" aria-label="Piyasa özeti">
                  <span>{activeSymbol}</span>
                  <span>{readyCount}R / {watchCount}W</span>
                </div>
              )}
            </div>
            <div className="topbar-actions">
            <div className={`session-clock ${sessionClock.activeSession === "Outside" ? "outside" : "active"}`} aria-label="Session durumu">
              <strong>{sessionClock.activeSession}</strong>
              <small>→ {sessionClock.display} · {nextSessionStart}</small>
            </div>
            <span className={`data-source-badge ${dataState.source}`}>
              {dataLoading ? "Yükleniyor" : dataRefreshing ? "Güncelleniyor" : dataState.source === "yahoo-live" ? "Yahoo" : dataState.source === "mixed" ? "Karma" : "Demo"}
            </span>
            <span className={`auto-refresh-badge ${dataRefreshing ? "refreshing" : ""}`} title="Sayfa açıkken canlı veri otomatik yenilenir.">
              <strong>{dataRefreshing ? "şimdi" : `${secondsToAutoRefresh}s`}</strong>
            </span>
            <button className="ghost-btn" onClick={() => void refreshMarketData()} type="button" disabled={dataLoading || dataRefreshing}>
              Yenile
            </button>
          </div>
        </header>
        {activeView === "dashboard" && (
          <FinanceDashboard
            signals={visibleSignals}
            hiddenSignals={hiddenSignals}
            rejectedSetups={rejectedSetups}
            backtestResult={backtestResult}
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
            lowQualitySignals={hiddenSignals}
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
            signals={chartSignals}
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
            symbols={markets.map((market) => market.symbol)}
            activeSymbol={activeSymbol}
            onSelectSymbol={(symbol) => selectSymbolBest(symbol as MarketSymbol)}
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
            signals={[...chartSignals, ...inactiveSignals]}
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
      <button
        className="quick-action-fab"
        type="button"
        aria-label="Veriyi yenile ve tara"
        title="Veriyi yenile ve tara"
        onClick={() => void refreshAndScan()}
        disabled={dataLoading || dataRefreshing}
      >
        <Plus size={20} />
        <span>{dataLoading || dataRefreshing ? "…" : "Tara"}</span>
      </button>
      </div>
    </div>
  );
}
