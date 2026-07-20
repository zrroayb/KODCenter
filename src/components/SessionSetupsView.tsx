import { useEffect, useMemo, useState } from "react";
import { Brain, Clock3, Eye, Sparkles } from "lucide-react";
import { fetchSessionAnalysis, type SessionAnalysisResponse } from "../lib/session/sessionAnalysis";
import type { SessionSetup, SessionSetupLifecycle, SessionSetupLog } from "../lib/session/types";

type SessionMode = "active" | "history";

const READY: SessionSetupLifecycle[] = ["CONFIRMED", "ACTIVE", "TARGET_1_REACHED", "TARGET_2_REACHED"];
const TERMINAL: SessionSetupLifecycle[] = ["INVALIDATED", "LATE", "EXPIRED", "COMPLETED"];

function lifecycleLabel(status: SessionSetupLifecycle): string {
  if (READY.includes(status)) return "Hazır";
  if (status === "WAITING_FOR_SWEEP") return "Sweep bekle";
  if (status === "WAITING_FOR_RECLAIM") return "İçeri dönüş bekle";
  if (status === "WAITING_FOR_DISPLACEMENT") return "Güçlü hareket bekle";
  if (status === "WAITING_FOR_LTF_CONFIRMATION") return "Kapanış bekle";
  if (status === "INVALIDATED") return "Geçersiz";
  if (status === "EXPIRED" || status === "LATE") return "Geç kaldı";
  if (status === "COMPLETED") return "Tamamlandı";
  return "İzle";
}

function nextStep(setup: SessionSetup): string {
  if (TERMINAL.includes(setup.lifecycleStatus)) {
    return setup.blockers[0] ?? setup.warnings[0] ?? "Bu setup artık işlem için geçerli değil.";
  }
  if (READY.includes(setup.lifecycleStatus)) {
    return setup.plan ? "Plan hazır. Giriş, stop ve hedefi chartta kontrol et." : "Session onayı tamam; ana CRT planını kontrol et.";
  }
  return setup.blockers[0] ?? setup.events.find((event) => event.status === "pending")?.detail ?? "Sıradaki yapı adımı bekleniyor.";
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  });
}

function uniqueActiveSetups(setups: SessionSetup[]): SessionSetup[] {
  const unique = new Map<string, SessionSetup>();
  for (const setup of setups) {
    const key = [setup.symbol, setup.direction, setup.referenceSession, setup.triggerSession, setup.setupModel].join(":");
    const current = unique.get(key);
    if (!current || setup.updatedAt > current.updatedAt || (setup.updatedAt === current.updatedAt && setup.score > current.score)) {
      unique.set(key, setup);
    }
  }
  return [...unique.values()];
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
        {entryPct !== undefined && <span className="session-entry-marker" style={{ bottom: `${entryPct}%` }}>Giriş</span>}
      </div>
      <div className="session-range-label low"><span>Low</span><strong>{low.toFixed(5)}</strong></div>
    </div>
  );
}

export function SessionSetupsView({
  setups,
  logs,
  onOpenSignal
}: {
  setups: SessionSetup[];
  logs: SessionSetupLog[];
  onOpenSignal: (signalId: string) => void;
}) {
  const [mode, setMode] = useState<SessionMode>("active");
  const [selectedId, setSelectedId] = useState<string | null>(setups[0]?.id ?? null);
  const [analysis, setAnalysis] = useState<SessionAnalysisResponse>({ status: "disabled", reason: "" });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const active = useMemo(
    () => uniqueActiveSetups(setups.filter((setup) => !TERMINAL.includes(setup.lifecycleStatus)))
      .sort((a, b) => Number(READY.includes(b.lifecycleStatus)) - Number(READY.includes(a.lifecycleStatus)) || b.score - a.score),
    [setups]
  );
  const history = useMemo(
    () => setups.filter((setup) => TERMINAL.includes(setup.lifecycleStatus)).sort((a, b) => b.updatedAt - a.updatedAt),
    [setups]
  );
  const displayed = mode === "active" ? active : history;
  const readyCount = active.filter((setup) => READY.includes(setup.lifecycleStatus)).length;
  const selected = displayed.find((setup) => setup.id === selectedId) ?? displayed[0];
  const selectedLogs = selected ? logs.filter((log) => log.setupId === selected.id) : [];

  useEffect(() => {
    if (displayed.length && !displayed.some((setup) => setup.id === selectedId)) setSelectedId(displayed[0].id);
  }, [displayed, selectedId]);

  useEffect(() => {
    setAnalysis({ status: "disabled", reason: "" });
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
    <section className="session-setups-page simple-session-page">
      <article className="panel session-summary-strip simple-session-summary">
        <div>
          <span className="eyebrow">Session radar</span>
          <h2>{readyCount ? `${readyCount} hazır setup` : active.length ? `${active.length} setup izleniyor` : "Aktif session setup yok"}</h2>
          <p>Önce session likiditesi, sonra ana CRT onayı.</p>
        </div>
        <div className="session-summary-metrics">
          <span><strong>{readyCount}</strong> hazır</span>
          <span><strong>{active.length}</strong> aktif</span>
        </div>
      </article>

      <div className="simple-mode-switch" role="tablist" aria-label="Session setup görünümü">
        <button className={mode === "active" ? "active" : ""} onClick={() => setMode("active")} type="button">Aktif ({active.length})</button>
        <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")} type="button">Geçmiş ({history.length})</button>
      </div>

      <div className="session-workspace simple-session-workspace">
        <article className="panel session-list-panel">
          <div className="session-setup-list">
            {displayed.map((setup) => (
              <button
                className={`session-setup-row simple-session-row ${selected?.id === setup.id ? "selected" : ""} ${setup.lifecycleStatus.toLowerCase()}`}
                key={setup.id}
                onClick={() => setSelectedId(setup.id)}
                type="button"
              >
                <span className={`session-direction-dot ${setup.direction}`} />
                <span className="session-row-main">
                  <strong>{setup.symbol} {setup.direction.toUpperCase()}</strong>
                  <small>{setup.referenceSession} → {setup.triggerSession}</small>
                </span>
                <span className="session-row-score"><strong>{setup.grade}</strong><small>{setup.score} kalite</small></span>
                <span className="session-row-status">{lifecycleLabel(setup.lifecycleStatus)}</span>
              </button>
            ))}
            {!displayed.length && (
              <div className="empty-decision-state">
                <strong>{mode === "active" ? "Şu an setup yok." : "Geçmiş boş."}</strong>
                <span>{mode === "active" ? "Session sweep oluşunca burada görünür." : "Biten setuplar burada tutulur."}</span>
              </div>
            )}
          </div>
        </article>

        <aside className="panel session-detail-panel simple-session-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selected.referenceSession} → {selected.triggerSession}</span>
                  <h2>{selected.symbol} {selected.direction.toUpperCase()}</h2>
                </div>
                <span className={`session-state-badge ${selected.lifecycleStatus.toLowerCase()}`}>{lifecycleLabel(selected.lifecycleStatus)}</span>
              </header>

              <SessionRangeMap setup={selected} />

              <div className="session-decision simple-next-step">
                <span>Tek beklenen</span>
                <strong>{nextStep(selected)}</strong>
                {selected.plan && <p>Giriş {selected.plan.entry.toFixed(5)} · Stop {selected.plan.stopLoss.toFixed(5)} · Hedef {selected.plan.targets[0]?.toFixed(5)}</p>}
              </div>

              <div className="session-detail-actions">
                {selected.signalId && <button className="primary-btn" onClick={() => onOpenSignal(selected.signalId!)} type="button"><Eye size={15} /> Chart</button>}
                <button className="ghost-btn" onClick={requestAnalysis} disabled={analysisLoading} type="button"><Brain size={15} /> {analysisLoading ? "Okuyor" : "AI yorum"}</button>
              </div>

              {(analysis.status === "ready" || analysis.status === "error") && (
                <div className="session-ai-note">
                  <span><Sparkles size={14} /> AI notu</span>
                  {analysis.status === "ready"
                    ? <><strong>{analysis.analysis.verdict}</strong><p>{analysis.analysis.summary}</p></>
                    : <p>{analysis.error}</p>}
                </div>
              )}

              <details className="compact-details session-technical-details">
                <summary><Clock3 size={14} /> Teknik detay</summary>
                <div className="session-evidence-list">
                  {selected.events.map((event) => (
                    <div className={event.status} key={event.id}>
                      <span>{event.status === "pass" ? "✓" : event.status === "fail" ? "×" : "·"}</span>
                      <p><strong>{event.label}</strong><small>{event.detail}</small></p>
                      {event.timestampUtc && <time>{timeLabel(event.timestampUtc)}</time>}
                    </div>
                  ))}
                </div>
                <div className="session-log-list">
                  {selectedLogs.map((log) => (
                    <div key={log.id}><strong>{lifecycleLabel(log.lifecycleStatus)}</strong><span>{log.detail}</span><time>{timeLabel(log.eventTimestampUtc)}</time></div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="empty-decision-state"><strong>Setup yok.</strong><span>Aktif bir session yapısı oluşunca detayı burada görünür.</span></div>
          )}
        </aside>
      </div>
    </section>
  );
}
