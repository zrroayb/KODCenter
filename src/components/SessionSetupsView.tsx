import { useEffect, useMemo, useState } from "react";
import { Brain, Clock3, Eye, Filter, Route, Sparkles } from "lucide-react";
import { fetchSessionAnalysis, type SessionAnalysisResponse } from "../lib/session/sessionAnalysis";
import { buildSessionStatistics } from "../lib/session/sessionConfluenceEngine";
import type { SessionSetup, SessionSetupLifecycle, SessionSetupLog } from "../lib/session/types";
import type { SilverBulletLog, SilverBulletSetup } from "../lib/strategies/silverBullet/types";
import { SilverBulletSection } from "./SilverBulletSection";

type SessionTab = "live" | "developing" | "confirmed" | "history";

const CONFIRMED: SessionSetupLifecycle[] = ["CONFIRMED", "ACTIVE", "TARGET_1_REACHED", "TARGET_2_REACHED", "COMPLETED"];
const TERMINAL: SessionSetupLifecycle[] = ["INVALIDATED", "LATE", "EXPIRED", "COMPLETED"];

function shortModel(model: string): string {
  return model
    .replace("ASIA_RANGE_LONDON_", "Asia → London · ")
    .replace("LONDON_RANGE_NY_", "London → NY · ")
    .replace("LONDON_EXPANSION_NY_", "London → NY · ")
    .replace("PREV_HTF_", "HTF · ")
    .replace("PDH_SESSION_", "PDH · ")
    .replace("PDL_SESSION_", "PDL · ")
    .replace("_BULLISH_CRT", " bullish")
    .replace("_BEARISH_CRT", " bearish")
    .replace("_BULLISH_CONTINUATION", " bullish devam")
    .replace("_BEARISH_CONTINUATION", " bearish devam")
    .replace(/_/g, " ");
}

function lifecycleLabel(status: SessionSetupLifecycle): string {
  if (status === "CONFIRMED" || status === "ACTIVE") return "Hazır";
  if (status === "WAITING_FOR_SWEEP") return "Sweep bekle";
  if (status === "WAITING_FOR_RECLAIM") return "İçeri dönüş bekle";
  if (status === "WAITING_FOR_DISPLACEMENT") return "Displacement bekle";
  if (status === "WAITING_FOR_LTF_CONFIRMATION") return "LTF onay bekle";
  if (status === "INVALIDATED") return "Geçersiz";
  if (status === "EXPIRED") return "Süresi bitti";
  if (status === "LATE") return "Geç";
  if (status === "COMPLETED") return "Tamamlandı";
  return "Gelişiyor";
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  });
}

function setupVisibleInTab(setup: SessionSetup, tab: SessionTab): boolean {
  if (tab === "confirmed") return CONFIRMED.includes(setup.lifecycleStatus);
  if (tab === "history") return TERMINAL.includes(setup.lifecycleStatus);
  if (tab === "developing") return !CONFIRMED.includes(setup.lifecycleStatus) && !TERMINAL.includes(setup.lifecycleStatus);
  return !TERMINAL.includes(setup.lifecycleStatus);
}

function SessionRangeMap({ setup }: { setup: SessionSetup }) {
  const { high, low } = setup.referenceRange;
  const span = Math.max(high - low, 0.000001);
  const currentPct = Math.max(0, Math.min(100, ((setup.currentPrice - low) / span) * 100));
  const entryPct = setup.plan
    ? Math.max(0, Math.min(100, ((setup.plan.entry - low) / span) * 100))
    : undefined;
  return (
    <div className="session-range-map" aria-label="Session range haritası">
      <div className="session-range-label high"><span>High</span><strong>{high.toFixed(5)}</strong></div>
      <div className="session-range-track">
        <span className="session-midline" />
        <span className={`session-price-marker ${setup.direction}`} style={{ bottom: `${currentPct}%` }}>
          {setup.currentPrice.toFixed(5)}
        </span>
        {entryPct !== undefined && <span className="session-entry-marker" style={{ bottom: `${entryPct}%` }}>Entry</span>}
      </div>
      <div className="session-range-label low"><span>Low</span><strong>{low.toFixed(5)}</strong></div>
    </div>
  );
}

export function SessionSetupsView({
  setups,
  logs,
  silverBulletSetups,
  silverBulletLogs,
  onOpenSignal
}: {
  setups: SessionSetup[];
  logs: SessionSetupLog[];
  silverBulletSetups: SilverBulletSetup[];
  silverBulletLogs: SilverBulletLog[];
  onOpenSignal: (signalId: string) => void;
}) {
  const [family, setFamily] = useState<"crt-session" | "silver-bullet">("crt-session");
  const [tab, setTab] = useState<SessionTab>("live");
  const [symbol, setSymbol] = useState("ALL");
  const [model, setModel] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(setups[0]?.id ?? null);
  const [analysis, setAnalysis] = useState<SessionAnalysisResponse>({ status: "disabled", reason: "Henüz yorum alınmadı." });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const stats = useMemo(() => buildSessionStatistics(setups), [setups]);
  const symbols = useMemo(() => [...new Set(setups.map((setup) => setup.symbol))], [setups]);
  const models = useMemo(() => [...new Set(setups.map((setup) => setup.setupModel))], [setups]);
  const filtered = useMemo(() =>
    setups.filter((setup) =>
      setupVisibleInTab(setup, tab) &&
      (symbol === "ALL" || setup.symbol === symbol) &&
      (model === "ALL" || setup.setupModel === model)
    ), [model, setups, symbol, tab]);
  const selected = setups.find((setup) => setup.id === selectedId) ?? filtered[0] ?? setups[0];
  const selectedLogs = selected ? logs.filter((log) => log.setupId === selected.id) : [];

  useEffect(() => {
    if (filtered.length && !filtered.some((setup) => setup.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    setAnalysis({ status: "disabled", reason: "AI yorumu yalnız seçili setup için alınır." });
  }, [selected?.id]);

  const requestAnalysis = async () => {
    if (!selected || analysisLoading) return;
    setAnalysisLoading(true);
    try {
      setAnalysis(await fetchSessionAnalysis(selected));
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <section className="session-setups-page">
      <div className="session-family-tabs" role="tablist" aria-label="Setup ailesi">
        <button className={family === "crt-session" ? "active" : ""} onClick={() => setFamily("crt-session")} type="button">CRT × Session</button>
        <button className={family === "silver-bullet" ? "active" : ""} onClick={() => setFamily("silver-bullet")} type="button">Silver Bullet</button>
      </div>
      {family === "silver-bullet" ? (
        <SilverBulletSection logs={silverBulletLogs} setups={silverBulletSetups} />
      ) : (
      <>
      <article className="panel session-summary-strip">
        <div>
          <span className="eyebrow">CRT × Session</span>
          <h2>{stats.confirmed ? `${stats.confirmed} hazır setup` : `${stats.developing} setup gelişiyor`}</h2>
          <p>Session range → sweep/acceptance → displacement → CRT onayı.</p>
        </div>
        <div className="session-summary-metrics">
          <span><strong>{stats.confirmed}</strong> hazır</span>
          <span><strong>{stats.developing}</strong> gelişiyor</span>
          <span><strong>{stats.averageScore.toFixed(0)}</strong> ort. skor</span>
        </div>
      </article>

      <div className="session-day-timeline" aria-label="Session akışı">
        {(["ASIA", "LONDON", "NY_AM", "NY_PM"] as const).map((session) => {
          const related = setups.filter((setup) => setup.referenceSession === session || setup.triggerSession === session);
          const active = related.some((setup) => !TERMINAL.includes(setup.lifecycleStatus));
          return (
            <div className={active ? "active" : related.length ? "completed" : "empty"} key={session}>
              <span>{session.replace("_", " ")}</span>
              <strong>{related.length || "—"}</strong>
            </div>
          );
        })}
      </div>

      <div className="session-workspace">
        <article className="panel session-list-panel">
          <header className="session-filterbar">
            <div className="session-tabs" role="tablist">
              {([
                ["live", "Canlı"],
                ["developing", "Gelişiyor"],
                ["confirmed", "Hazır"],
                ["history", "Geçmiş"]
              ] as Array<[SessionTab, string]>).map(([value, label]) => (
                <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)} type="button">{label}</button>
              ))}
            </div>
            <label className="session-symbol-filter">
              <Filter size={14} />
              <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                <option value="ALL">Tüm marketler</option>
                {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select aria-label="Setup modeli" value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="ALL">Tüm modeller</option>
                {models.map((item) => <option key={item} value={item}>{shortModel(item)}</option>)}
              </select>
            </label>
          </header>

          <div className="session-setup-list">
            {filtered.map((setup) => (
              <button
                className={`session-setup-row ${selected?.id === setup.id ? "selected" : ""} ${setup.lifecycleStatus.toLowerCase()}`}
                key={setup.id}
                onClick={() => setSelectedId(setup.id)}
                type="button"
              >
                <span className={`session-direction-dot ${setup.direction}`} />
                <span className="session-row-main">
                  <strong>{setup.symbol} {setup.direction.toUpperCase()}</strong>
                  <small><Route size={13} /> {setup.referenceSession} → {setup.triggerSession}</small>
                </span>
                <span className="session-row-model">{shortModel(setup.setupModel)}</span>
                <span className="session-row-score"><strong>{setup.score}</strong><small>{setup.grade}</small></span>
                <span className="session-row-status">{lifecycleLabel(setup.lifecycleStatus)}</span>
              </button>
            ))}
            {!filtered.length && (
              <div className="empty-decision-state">
                <strong>Bu filtrede setup yok.</strong>
                <span>Range etkileşimi oluşunca burada görünür.</span>
              </div>
            )}
          </div>
        </article>

        <aside className="panel session-detail-panel">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selected.referenceSession} → {selected.triggerSession}</span>
                  <h2>{selected.symbol} {selected.direction.toUpperCase()}</h2>
                  <p>{shortModel(selected.setupModel)}</p>
                </div>
                <span className={`session-state-badge ${selected.lifecycleStatus.toLowerCase()}`}>{lifecycleLabel(selected.lifecycleStatus)}</span>
              </header>

              <SessionRangeMap setup={selected} />

              <div className="session-decision">
                <strong>{selected.summary}</strong>
                <p>{selected.blockers[0] ?? "Deterministik sequence tamam."}</p>
              </div>

              <div className="session-evidence-list">
                {selected.events.map((event) => (
                  <div className={event.status} key={event.id}>
                    <span>{event.status === "pass" ? "✓" : "·"}</span>
                    <p><strong>{event.label}</strong><small>{event.detail}</small></p>
                    {event.timestampUtc && <time>{timeLabel(event.timestampUtc)}</time>}
                  </div>
                ))}
              </div>

              <div className="session-detail-actions">
                {selected.signalId && <button className="primary-btn" onClick={() => onOpenSignal(selected.signalId!)} type="button"><Eye size={15} /> Chart</button>}
                <button className="ghost-btn" onClick={requestAnalysis} disabled={analysisLoading} type="button"><Brain size={15} /> {analysisLoading ? "AI okuyor" : "AI yorumla"}</button>
              </div>

              <div className="session-ai-note">
                <span><Sparkles size={14} /> Session mentor</span>
                {analysis.status === "ready"
                  ? <><strong>{analysis.analysis.verdict} · {analysis.model === "local-deterministic-fallback" ? "local" : "Gemini"}</strong><p>{analysis.analysis.summary}</p></>
                  : <p>{analysis.status === "error" ? analysis.error : analysis.reason}</p>}
              </div>

              <details className="compact-details">
                <summary><Clock3 size={14} /> Setup geçmişi</summary>
                <div className="session-log-list">
                  {selectedLogs.map((log) => (
                    <div key={log.id}><strong>{lifecycleLabel(log.lifecycleStatus)}</strong><span>{log.detail}</span><time>{timeLabel(log.eventTimestampUtc)}</time></div>
                  ))}
                  {!selectedLogs.length && <p className="muted-note">Henüz lifecycle logu yok.</p>}
                </div>
              </details>
            </>
          ) : (
            <div className="empty-decision-state"><strong>Setup seç.</strong><span>Detay ve kanıt zinciri burada görünür.</span></div>
          )}
        </aside>
      </div>
      </>
      )}
    </section>
  );
}
