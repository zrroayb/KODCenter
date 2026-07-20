import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Sparkles, Trash2 } from "lucide-react";
import { BacktestView } from "./components/BacktestView";
import { BrandLogo } from "./components/BrandLogo";
import { ChartsView } from "./components/ChartsView";
import { ScannerView } from "./components/ScannerView";
import { SessionSetupsView } from "./components/SessionSetupsView";
import { SettingsView } from "./components/SettingsView";
import { NAV_ITEMS, Sidebar } from "./components/Sidebar";
import { SilverBulletSection } from "./components/SilverBulletSection";
import { createDemoMarkets } from "./data/demoData";
import { runDemoBacktest } from "./lib/backtest/backtestEngine";
import { focusChartOnSignal, type SelectedSignalState } from "./lib/charts/selectedSignal";
import { buildDataHealthReport } from "./lib/data/dataHealth";
import { loadYahooMarkets, type MarketDataLoadResult } from "./lib/data/yahooProvider";
import type { MarketContext, MarketSymbol, TradingSignal } from "./lib/ict/types";
import { buildMarketContext } from "./lib/intelligence/marketContext";
import { attachSmtDivergences } from "./lib/intelligence/smtEngine";
import { loadJournalEntries, saveJournalEntries, upsertJournalEntry } from "./lib/journal/localJournal";
import { journalSetupKey } from "./lib/journal/journalEntry";
import { journalInsights } from "./lib/journal/journalAnalyzer";
import { journalLearningInsights } from "./lib/journal/strategyLearning";
import type { JournalEntry } from "./lib/journal/types";
import { createSessionRuntimeMemory } from "./lib/memory/sessionRuntimeMemory";
import { compareSignalsByDecision, scanContexts } from "./lib/runtime/scanRuntime";
import { formatTurkeySessionTime } from "./lib/session/sessionClock";
import { buildSessionSetups } from "./lib/session/sessionConfluenceEngine";
import { buildSilverBulletSetups } from "./lib/strategies/silverBullet/silverBulletEngine";
import { loadSilverBulletLogs, loadSilverBulletSetups, reconcileSilverBulletStore } from "./lib/strategies/silverBullet/silverBulletStore";
import type { SilverBulletLog, SilverBulletSetup } from "./lib/strategies/silverBullet/types";
import { buildProfileSessionClock } from "./lib/session/sessionRangeEngine";
import { loadSessionSetupLogs, loadSessionSetups, reconcileSessionSetupStore } from "./lib/session/sessionSetupStore";
import type { SessionSetup, SessionSetupLog } from "./lib/session/types";
import { mergeReadyHoldSignals, type ReadyHoldRecord } from "./lib/signals/readyHold";
import type { RejectedSetup } from "./lib/strategies/types";
import { getStrategy, strategyRegistry } from "./lib/strategies/registry";
import {
  fetchCloudTelegramAlertHistory,
  loadTelegramAlertHistory,
  matchingSignalForAlert,
  mergeTelegramAlertHistories,
  reconcileTelegramAlertHistory,
  saveTelegramAlertHistory,
  upsertTelegramAlertRecord
} from "./lib/telegram/alertHistory";
import { telegramAlertRecordFromSignal, type TelegramAlertRecord } from "./lib/telegram/alertPayload";
import { notifyReadySignalOnce } from "./lib/telegram/readyAlert";
import { ruleAllowsContext, ruleAllowsSignal } from "./lib/userRules/applyRules";
import { queueCloudRulesSync } from "./lib/userRules/cloudRulesSync";
import { loadUserRules, saveUserRules } from "./lib/userRules/localRules";
import { MIN_VISIBLE_SIGNAL_SCORE } from "./lib/userRules/scorePolicy";
import type { UserRules } from "./lib/userRules/userRules";

export type ViewId = "dashboard" | "charts" | "scanner" | "sessionSetups" | "silverBullet" | "backtest" | "journal" | "ai" | "settings";

const VIEW_TITLES: Record<ViewId, string> = {
  charts: "Chart",
  dashboard: "Bugün",
  scanner: "Tara",
  sessionSetups: "Session",
  silverBullet: "Silver Bullet",
  backtest: "Replay",
  journal: "Notlar",
  ai: "AI",
  settings: "Ayar"
};
const AUTO_REFRESH_MS = 60_000;
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
  if (signal.governance.blockers.length === 1 && signal.plan.rr >= 1.5) return "1 adım kaldı";
  if (signal.crtAnchor?.setupPhase === "raid") return "Onay bekle";
  if (signal.crtAnchor?.setupPhase === "model") return "Planı kontrol et";
  return "Radar";
}

function shortReason(text: string | undefined, fallback = "Bekle"): string {
  const clean = (text ?? fallback)
    .replace(/^AI:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = clean.toLocaleLowerCase("tr-TR");
  if (lower.includes("uzak") || lower.includes("kovalanmaz")) return "Giriş kaçtı; kovalama.";
  if (lower.includes("retest")) return "POI dönüşü yalnızca kalite bonusu.";
  if (lower.includes("minimumun altında")) return "RR yetersiz.";
  if (lower.includes("shift") && lower.includes("fvg")) return "Shift var; o harekete ait FVG yok.";
  if (lower.includes("origin mumu henüz kapanmadı")) return "CRT mumu kapanmadı.";
  if (lower.includes("turtle soup") || lower.includes("purge") || lower.includes("sweep")) return "Likidite alındı, onay bekle.";
  if (lower.includes("raid")) return "Raid var, onay bekle.";
  if (lower.includes("dealing range") || lower.includes("premium") || lower.includes("discount")) return "Bölge uygun değil.";
  if (lower.includes("htf") || lower.includes("anlatı")) return "Üst zaman ters.";
  if (lower.includes("killzone") || lower.includes("session")) return "Saat zayıf.";
  if (lower.includes("choch") || lower.includes("mss") || lower.includes("kapan")) return "Kapanış onayı yok.";
  if (lower.includes("rr") || lower.includes("risk")) return "RR yetmiyor.";
  if (lower.includes("anchor") || lower.includes("key seviye")) return "Key seviye yok.";
  if (lower.includes("poi")) return "POI yalnızca kalite notu.";
  if (lower.includes("entry") || lower.includes("giriş")) return "Plan geometrisi uygun değil.";
  return clean.length > 46 ? `${clean.slice(0, 43)}...` : clean;
}

function signalReason(signal: TradingSignal): string {
  if (signal.stage === "ready") return "Giriş, stop ve DOL hazır.";
  const blocker = signal.governance.blockers[0];
  const lower = blocker?.toLocaleLowerCase("tr-TR") ?? "";
  if (lower.includes("uzak") || lower.includes("kovalanmaz")) return "Giriş kaçtı; bu hareket kovalanmaz.";
  if (lower.includes("manipulation")) return "CRT kenarı sweep edilip range içine dönmeli.";
  if (lower.includes("minimumun altında")) return `RR ${signal.plan.rr.toFixed(2)}; işlem için yetersiz.`;
  if (lower.includes("shift") && lower.includes("fvg")) return "Shift var; o harekete ait FVG yok.";
  if (lower.includes("choch")) return `${signal.timeframe} ChoCH kapanışı bekleniyor.`;
  return shortReason(blocker ?? signal.plan.planWarnings[0] ?? signal.decisionSummary.shortSummary, "Onay bekle");
}

function rankedDecisionSignals(signals: TradingSignal[]) {
  return [...signals]
    .filter((signal) => signal.stage === "ready" || signal.stage === "watch")
    .sort(compareSignalsByDecision);
}

function alertStageText(record: TelegramAlertRecord) {
  if (record.currentStage === "ready") return "Aktif";
  if (record.currentStage === "watch") return "Şimdi bekle";
  if (record.currentStage === "missed") return "Kaçtı";
  if (record.currentStage === "invalidated") return "Geçersiz";
  return "Gönderildi";
}

function alertPrice(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

export function FinanceDashboard({
  signals,
  hiddenSignals,
  rejectedSetups,
  backtestResult,
  journalEntries,
  dataHealth,
  sessionName,
  telegramAlerts,
  onOpenChart,
  onOpenTelegramAlert,
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
  telegramAlerts: TelegramAlertRecord[];
  onOpenChart: (signal: TradingSignal) => void;
  onOpenTelegramAlert: (record: TelegramAlertRecord) => void;
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

      {telegramAlerts.length > 0 && (
        <article className="panel telegram-alert-panel">
          <header>
            <div>
              <span className="eyebrow">Telegram</span>
              <h2>Son uyarılar</h2>
            </div>
            <small>24 saat</small>
          </header>
          <div className="telegram-alert-list">
            {telegramAlerts.slice(0, 3).map((record) => (
              <button
                className={`telegram-alert-row ${record.currentStage ?? "sent"}`}
                key={record.dedupeKey}
                onClick={() => onOpenTelegramAlert(record)}
                type="button"
              >
                <span className="telegram-alert-market">
                  <strong>{record.symbol} {record.direction.toUpperCase()}</strong>
                  <small>{new Date(record.sentAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</small>
                </span>
                <span className="telegram-alert-plan">
                  Giriş {alertPrice(record.entry)} · SL {alertPrice(record.stopLoss)} · TP {alertPrice(record.targets[0])}
                </span>
                <span className="telegram-alert-score">{record.grade} · 1:{record.rr.toFixed(2)}</span>
                <span className="telegram-alert-status">{alertStageText(record)}</span>
              </button>
            ))}
          </div>
        </article>
      )}

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
                  <strong>{signal.grade}</strong>
                  <small>{signal.score} kalite · {stageText(signal)}</small>
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
                    <small>{signal.direction.toUpperCase()} · Erken aday</small>
                  </span>
                  <span className="decision-meta">
                    <strong>{signal.grade}</strong>
                    <small>{signal.score} kalite · İzle</small>
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
                    <small>kalite · aday</small>
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
          {ranked.length > 0 && lowQualitySignals.length > 0 && (
            <details className="compact-details low-quality-details">
              <summary>Erken adaylar ({lowQualitySignals.length})</summary>
              <div className="decision-signal-list">
                {lowQualitySignals.map((signal) => (
                  <button className={`decision-signal-card low-quality ${signal.stage}`} key={signal.id} type="button" onClick={() => onOpenChart(signal)}>
                    <span className="decision-rank">?</span>
                    <span className="decision-main">
                      <strong>{signal.symbol}</strong>
                      <small>{signal.direction.toUpperCase()} · Erken aday</small>
                    </span>
                    <span className="decision-meta">
                      <strong>{signal.grade}</strong>
                      <small>{signal.score} kalite · İzle</small>
                    </span>
                    <span className="decision-reason">{signalReason(signal)}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
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

function JournalView({ entries, signals, onSelectSignal, onDelete }: { entries: JournalEntry[]; signals: TradingSignal[]; onSelectSignal: (signal: TradingSignal) => void; onDelete: (tradeId: string) => void }) {
  const insights = journalInsights(entries);
  const learning = journalLearningInsights(entries, signals);
  const actionText = (entry: JournalEntry) => {
    if (entry.result === "loss") return "STOP OLDU";
    if (entry.tradeAction === "taken") return "ALDIM";
    if (entry.tradeAction === "skipped") return "ALMADIM";
    if (entry.tradeAction === "missed") return "KAÇTI";
    return "İZLİYORUM";
  };
  return (
    <section className="journal-page">
      <article className="panel decision-hero compact-hero">
        <div>
          <span className="eyebrow">Notlar</span>
          <h2>{entries.length ? `${entries.length} işlem notu` : "Henüz işlem notu yok."}</h2>
          <p>Karar, uygulama ve sonucu aynı yerde tut.</p>
        </div>
      </article>
      {entries.length > 0 && (
        <article className="panel journal-memory-panel">
          <header className="panel-head">
            <div><span className="eyebrow">Strateji hafızası</span><h2>Gerçek kararların</h2></div>
            <span className="badge">lokal</span>
          </header>
          <div className="journal-memory-grid">
            {insights.slice(0, 4).map((insight) => (
              <div key={insight.label}><span>{insight.label}</span><strong>{insight.value}</strong><small>{insight.detail}</small></div>
            ))}
          </div>
          <details className="compact-details">
            <summary>Genel özeleştiri için biriken bulgular</summary>
            <div className="strategy-learning-list">
              {learning.map((insight) => <div key={`${insight.label}-${insight.value}`}><span>{insight.label}</span><b>{insight.value}</b><small>{insight.detail}</small></div>)}
            </div>
          </details>
        </article>
      )}
      <div className="journal-card-grid">
        {entries.map((entry) => {
          const signal = signals.find((item) => item.id === entry.tradeId)
            ?? signals.find((item) => entry.setupKey && journalSetupKey(item) === entry.setupKey);
          const snapshot = entry.latestSignalSnapshot ?? entry.signalSnapshot;
          return (
            <article className="panel journal-trade-card" key={entry.tradeId}>
              <div className="journal-thumb">{entry.symbol.slice(0, 3)}</div>
              <div>
                <span className={`eyebrow journal-action ${entry.result ?? "open"}`}>{actionText(entry)}</span>
                <h2>{entry.symbol} {entry.direction.toUpperCase()}</h2>
                <p>{entry.notes || entry.outcomeNote || entry.mistake || "Not eklenmedi."}</p>
              </div>
              <div className="journal-stat-row">
                <span>Sonuç <strong>{entry.result === "loss" ? "Stop" : entry.result ?? "açık"}</strong></span>
                <span>R <strong>{entry.rMultiple?.toFixed(2) ?? "—"}</strong></span>
                <span>Kalite <strong>{snapshot ? `${snapshot.grade} · ${snapshot.score}` : "—"}</strong></span>
              </div>
              <small className="journal-plan-line">
                Plan {entry.entry ?? "—"} / SL {entry.stopLoss ?? "—"} / DOL {entry.target ?? "—"}
                {snapshot ? ` · ${snapshot.rangeTf?.toUpperCase() ?? "CRT"} → ${snapshot.confirmTf.toUpperCase()} · ${snapshot.premiumDiscount}` : ""}
                {entry.history?.length ? ` · ${entry.history.length} kayıt adımı` : ""}
              </small>
              <div className="journal-card-actions">
                {signal && <button className="ghost-btn" onClick={() => onSelectSignal(signal)} type="button">Chartı aç</button>}
                <button className="icon-btn" aria-label={`${entry.symbol} journal kaydını sil`} title="Kaydı sil" onClick={() => onDelete(entry.tradeId)} type="button"><Trash2 size={15} /></button>
              </div>
            </article>
          );
        })}
        {!entries.length && (
          <article className="panel empty-state-card">
            <h2>Not yok</h2>
            <p>Charttaki işlem panelinden bir karar kaydet.</p>
          </article>
        )}
      </div>
    </section>
  );
}

function AiWorkspace({ signal, signals, journalEntries }: { signal: TradingSignal | null; signals: TradingSignal[]; journalEntries: JournalEntry[] }) {
  const best = signal ?? bestScanSignal(signals) ?? null;
  const prompts = ["Neye bakmalıyım?", "Son işlemimi incele", "Taramayı özetle", "Setupı geliştir"];
  const [selectedPrompt, setSelectedPrompt] = useState(prompts[0]);
  const promptAnswer = selectedPrompt === "Son işlemimi incele"
    ? journalEntries.length ? `Son ${journalEntries.length} not kayıtlı. En son kararda plan ile gerçek giriş/çıkışı kıyasla.` : "İncelenecek işlem notu yok."
    : selectedPrompt === "Taramayı özetle"
      ? signals.length ? `${signals.length} aktif aday var. Öncelik ${best?.symbol ?? "yok"}; ${best ? signalReason(best) : "bekle"}` : "Aktif aday yok."
      : selectedPrompt === "Setupı geliştir"
        ? best ? `Önce mevcut eksiği tamamla: ${signalReason(best)} Stop ve DOL değişmeden yeni entry üretme.` : "Geliştirilecek aktif setup yok."
        : best ? `${best.symbol} ${best.direction.toUpperCase()}: ${signalReason(best)}` : "Şu an zorlanacak bir setup yok.";
  return (
    <section className="ai-workspace">
      <article className="ai-chat-shell">
        <header>
          <span className="brand-mark soft"><Bot size={20} /></span>
          <div>
            <span className="eyebrow">Finance AI</span>
            <h2>CRT karar koçu</h2>
          </div>
        </header>
        <div className="message-stack">
          <div className="message assistant">
            <strong>Piyasa okuması</strong>
            <p>{best ? best.decisionSummary.fullReasoning : "Şu an işlem gerektiren aktif setup yok."}</p>
          </div>
          <div className="message assistant">
            <strong>{selectedPrompt}</strong>
            <p>{promptAnswer}</p>
          </div>
        </div>
        <div className="suggested-prompts">
          {prompts.map((prompt) => <button className={selectedPrompt === prompt ? "active" : ""} key={prompt} onClick={() => setSelectedPrompt(prompt)} type="button">{prompt}</button>)}
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
    errors: [],
    background: false
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
  const [rules, setRules] = useState<UserRules>(() => loadUserRules());
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
  const [sessionSetups, setSessionSetups] = useState<SessionSetup[]>(() => loadSessionSetups());
  const [sessionSetupLogs, setSessionSetupLogs] = useState<SessionSetupLog[]>(() => loadSessionSetupLogs());
  const [silverBulletSetups, setSilverBulletSetups] = useState<SilverBulletSetup[]>(() => loadSilverBulletSetups());
  const [silverBulletLogs, setSilverBulletLogs] = useState<SilverBulletLog[]>(() => loadSilverBulletLogs());
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => loadJournalEntries());
  const [telegramAlerts, setTelegramAlerts] = useState<TelegramAlertRecord[]>(() => loadTelegramAlertHistory());
  const [lastScanTime, setLastScanTime] = useState(Date.now());
  const [clockNow, setClockNow] = useState(Date.now());
  const [backtestResult, setBacktestResult] = useState(runDemoBacktest(contexts));
  const [backtestLoading, setBacktestLoading] = useState(false);
  const replayWorkerRef = useRef<Worker | null>(null);
  const [memory, setMemory] = useState(() => createSessionRuntimeMemory(activeSymbol));
  const readyHoldRef = useRef<Record<string, ReadyHoldRecord>>({});
  const activeContext = contexts.find((context) => context.symbol === activeSymbol) ?? contexts[0];
  const activeMarket = markets.find((market) => market.symbol === activeSymbol) ?? markets[0];
  const dataHealth = useMemo(() => buildDataHealthReport(markets, dataState), [dataState, markets]);
  const visibleSignals = useMemo(() => signals.filter((signal) => ruleAllowsSignal(signal, rules)), [rules, signals]);
  const chartSignals = useMemo(() => [...visibleSignals, ...hiddenSignals], [hiddenSignals, visibleSignals]);
  const detectedSessionSetups = useMemo(
    () => buildSessionSetups({ contexts, signals: [...chartSignals, ...inactiveSignals], now: lastScanTime }),
    [chartSignals, contexts, inactiveSignals, lastScanTime]
  );
  const detectedSilverBulletSetups = useMemo(
    () => buildSilverBulletSetups({ contexts, now: lastScanTime }),
    [contexts, lastScanTime]
  );
  const selectableSignals = useMemo(() => [...chartSignals, ...inactiveSignals], [chartSignals, inactiveSignals]);
  const allRuntimeSignals = useMemo(
    () => [...signals, ...hiddenSignals, ...inactiveSignals],
    [hiddenSignals, inactiveSignals, signals]
  );
  const selectedSignal = selectableSignals.find((signal) => signal.id === selectedSignalState.selectedSignalId) ?? null;
  const readyCount = visibleSignals.filter((signal) => signal.stage === "ready").length;
  const watchCount = visibleSignals.filter((signal) => signal.stage === "watch").length;
  const sessionClock = useMemo(() => buildProfileSessionClock(activeSymbol, clockNow), [activeSymbol, clockNow]);
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

  useEffect(() => {
    saveUserRules(rules);
    queueCloudRulesSync(rules);
  }, [rules]);

  useEffect(() => () => replayWorkerRef.current?.terminate(), []);

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
        errors: result.errors,
        background: result.background,
        oldestLoadedAt: result.oldestLoadedAt
      });
    } catch (error) {
      setMarkets(demoMarkets);
      setDataState({
        source: "demo",
        feedMode: "demo",
        loadedAt: Date.now(),
        errors: [error instanceof Error ? error.message : String(error)],
        background: false
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
    setTelegramAlerts((current) => {
      const next = reconcileTelegramAlertHistory(current, allRuntimeSignals);
      return saveTelegramAlertHistory(next);
    });
  }, [allRuntimeSignals]);

  useEffect(() => {
    let active = true;
    void fetchCloudTelegramAlertHistory().then((cloudAlerts) => {
      if (!active || !cloudAlerts.length) return;
      setTelegramAlerts((current) => saveTelegramAlertHistory(
        reconcileTelegramAlertHistory(mergeTelegramAlertHistories(current, cloudAlerts), allRuntimeSignals)
      ));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const reconciled = reconcileSessionSetupStore(sessionSetups, detectedSessionSetups, sessionSetupLogs);
    const setupChanged = JSON.stringify(reconciled.setups) !== JSON.stringify(sessionSetups);
    const logChanged = JSON.stringify(reconciled.logs) !== JSON.stringify(sessionSetupLogs);
    if (setupChanged) setSessionSetups(reconciled.setups);
    if (logChanged) setSessionSetupLogs(reconciled.logs);
  }, [detectedSessionSetups, sessionSetupLogs, sessionSetups]);

  useEffect(() => {
    const reconciled = reconcileSilverBulletStore(silverBulletSetups, detectedSilverBulletSetups, silverBulletLogs);
    const setupChanged = JSON.stringify(reconciled.setups) !== JSON.stringify(silverBulletSetups);
    const logChanged = JSON.stringify(reconciled.logs) !== JSON.stringify(silverBulletLogs);
    if (setupChanged) setSilverBulletSetups(reconciled.setups);
    if (logChanged) setSilverBulletLogs(reconciled.logs);
  }, [detectedSilverBulletSetups, silverBulletLogs, silverBulletSetups]);

  useEffect(() => {
    if (dataLoading || dataState.background) return;
    for (const signal of visibleSignals.filter((item) => item.stage === "ready")) {
      void notifyReadySignalOnce(signal).then((result) => {
        if (result.status === "sent") {
          const record = telegramAlertRecordFromSignal(signal);
          setTelegramAlerts((current) => saveTelegramAlertHistory(
            upsertTelegramAlertRecord(current, record)
          ));
        }
        if (result.status === "error") {
          console.warn("Telegram ready alert failed", result.error);
        }
      });
    }
  }, [dataLoading, dataState.background, visibleSignals, lastScanTime]);

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
    replayWorkerRef.current?.terminate();
    const worker = new Worker(new URL("./workers/replay.worker.ts", import.meta.url), { type: "module" });
    replayWorkerRef.current = worker;
    setBacktestLoading(true);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: typeof backtestResult; error?: string }>) => {
      if (event.data.ok && event.data.result) setBacktestResult(event.data.result);
      else console.warn("Replay worker failed", event.data.error);
      setBacktestLoading(false);
      worker.terminate();
      if (replayWorkerRef.current === worker) replayWorkerRef.current = null;
    };
    worker.onerror = (event) => {
      console.warn("Replay worker failed", event.message);
      setBacktestLoading(false);
      worker.terminate();
      if (replayWorkerRef.current === worker) replayWorkerRef.current = null;
    };
    worker.postMessage({
      markets,
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
    });
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

  const openTelegramAlert = (record: TelegramAlertRecord) => {
    const signal = matchingSignalForAlert(record, selectableSignals);
    if (signal) {
      selectSignal(signal);
      return;
    }
    const market = markets.find((item) => item.symbol === record.symbol);
    if (market) setActiveSymbol(market.symbol);
    clearSelection();
    setActiveView("charts");
  };

  const openSessionSignal = (signalId: string) => {
    const signal = selectableSignals.find((item) => item.id === signalId);
    if (signal) selectSignal(signal);
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

  const deleteJournalEntry = (tradeId: string) => {
    setJournalEntries((current) => current.filter((entry) => entry.tradeId !== tradeId));
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
            <BrandLogo />
          </div>
          {/* The sidebar is hidden under 900px and the tabbar has no room for these,
              so they would otherwise be unreachable on mobile. */}
          <nav className="topnav-secondary-nav" aria-label="Ek gezinme">
            {NAV_ITEMS.filter((item) => !item.mobile).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  aria-label={`${item.label} ${item.caption}`}
                  className={activeView === item.id ? "active" : ""}
                  onClick={() => setActiveView(item.id)}
                  type="button"
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </nav>
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
              {dataLoading
                ? "Yükleniyor"
                : dataRefreshing
                  ? "Güncelleniyor"
                  : dataState.background
                    ? "Canlı bot"
                    : dataState.source === "yahoo-live"
                    ? "Yahoo proxy"
                      : dataState.source === "mixed"
                        ? "Karma"
                        : "Demo"}
            </span>
            <span
              className={`auto-refresh-badge ${dataRefreshing ? "refreshing" : ""}`}
              title={dataState.background ? "Cloudflare botu sayfa kapalıyken de tarar." : "Sayfa açıkken canlı veri otomatik yenilenir."}
            >
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
            telegramAlerts={telegramAlerts}
            onOpenChart={selectSignal}
            onOpenTelegramAlert={openTelegramAlert}
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
        {activeView === "sessionSetups" && (
          <SessionSetupsView logs={sessionSetupLogs} onOpenSignal={openSessionSignal} setups={sessionSetups} />
        )}
        {activeView === "silverBullet" && (
          <SilverBulletSection logs={silverBulletLogs} setups={silverBulletSetups} />
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
            <BacktestView result={backtestResult} onRun={runBacktest} loading={backtestLoading} />
          </section>
        )}
        {activeView === "journal" && (
          <JournalView
            entries={journalEntries}
            signals={[...chartSignals, ...inactiveSignals]}
            onSelectSignal={selectSignal}
            onDelete={deleteJournalEntry}
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
