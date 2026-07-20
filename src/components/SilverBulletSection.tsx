import { useEffect, useMemo, useState } from "react";
import { Brain, Clock3, Sparkles } from "lucide-react";
import { fetchSilverBulletAnalysis, type SbAnalysisResponse } from "../lib/gemini/silverBulletInterpretation";
import { tzOffsetHours } from "../lib/session/sessionClock";
import type { SbLifecycle, SilverBulletLog, SilverBulletSetup } from "../lib/strategies/silverBullet/types";
import { SilverBulletPlanChart } from "./SilverBulletPlanChart";

type SilverMode = "active" | "history";

const READY: SbLifecycle[] = ["ENTRY_FILLED", "ACTIVE", "TARGET_1_REACHED", "TARGET_2_REACHED"];
const TERMINAL: SbLifecycle[] = ["STOPPED", "INVALIDATED", "LATE", "EXPIRED", "NO_TRADE", "COMPLETED", "BOTH_SIDES_SWEPT", "BREAK_ACCEPTED_OUTSIDE"];

function lifecycleLabel(status: SbLifecycle): string {
  if (READY.includes(status)) return "Hazır";
  if (status === "REFERENCE_BUILDING" || status === "REFERENCE_LOCKED" || status === "WINDOW_OPEN") return "Range hazırlanıyor";
  if (status === "WAITING_FOR_SWEEP") return "Sweep bekle";
  if (status === "WAITING_FOR_RECLAIM" || status === "HIGH_SWEPT" || status === "LOW_SWEPT") return "İçeri dönüş bekle";
  if (status === "WAITING_FOR_DISPLACEMENT") return "Güçlü hareket bekle";
  if (status === "WAITING_FOR_STRUCTURE_SHIFT") return "Kapanış bekle";
  if (status === "WAITING_FOR_ENTRY_ARRAY" || status === "ORDER_PENDING") return "Giriş bekle";
  if (status === "STOPPED") return "Stop";
  if (status === "COMPLETED") return "Tamamlandı";
  if (status === "NO_TRADE") return "İşlem yok";
  return "Geçersiz";
}

function nextStep(setup: SilverBulletSetup): string {
  if (TERMINAL.includes(setup.lifecycleStatus)) {
    return setup.noTradeReasons[0] ?? setup.invalidationReasons[0] ?? setup.lateReason ?? "Bu pencere işlem üretmeden kapandı.";
  }
  if (READY.includes(setup.lifecycleStatus)) return "Plan aktif. Stop ve hedefi takip et.";
  if (setup.lifecycleStatus === "REFERENCE_BUILDING" || setup.lifecycleStatus === "REFERENCE_LOCKED" || setup.lifecycleStatus === "WINDOW_OPEN") return "09:00 NY range tamamlansın.";
  if (setup.lifecycleStatus === "WAITING_FOR_SWEEP") return "09:00 range high veya low alınsın.";
  if (setup.lifecycleStatus === "WAITING_FOR_RECLAIM" || setup.lifecycleStatus === "HIGH_SWEPT" || setup.lifecycleStatus === "LOW_SWEPT") return "Fiyat range içine geri dönsün.";
  if (setup.lifecycleStatus === "WAITING_FOR_DISPLACEMENT") return "Sweep yönünün tersine güçlü hareket gelsin.";
  if (setup.lifecycleStatus === "WAITING_FOR_STRUCTURE_SHIFT") return "5m mum yön değişimini kapanışla onaylasın.";
  if (setup.lifecycleStatus === "WAITING_FOR_ENTRY_ARRAY") return "Yön değişimi sonrası FVG oluşsun.";
  if (setup.lifecycleStatus === "ORDER_PENDING") return "Fiyat giriş alanına dokunsun.";
  return setup.summary;
}

function nyClock(now: number): string {
  const offset = tzOffsetHours("America/New_York", now);
  const local = new Date(now + offset * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")} NY`;
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
}

function uniqueActiveSetups(setups: SilverBulletSetup[]): SilverBulletSetup[] {
  const unique = new Map<string, SilverBulletSetup>();
  for (const setup of setups) {
    const key = [setup.symbol, setup.direction, setup.tradingDayId].join(":");
    const current = unique.get(key);
    if (!current || setup.updatedAtUtc > current.updatedAtUtc || (setup.updatedAtUtc === current.updatedAtUtc && setup.score > current.score)) {
      unique.set(key, setup);
    }
  }
  return [...unique.values()];
}

export function SilverBulletSection({ setups, logs }: { setups: SilverBulletSetup[]; logs: SilverBulletLog[] }) {
  const [mode, setMode] = useState<SilverMode>("active");
  const [selectedId, setSelectedId] = useState<string | null>(setups[0]?.setupId ?? null);
  const [analysis, setAnalysis] = useState<SbAnalysisResponse>({ status: "disabled", reason: "" });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const now = Date.now();
  const active = useMemo(
    () => uniqueActiveSetups(setups.filter((setup) => !TERMINAL.includes(setup.lifecycleStatus)))
      .sort((a, b) => Number(READY.includes(b.lifecycleStatus)) - Number(READY.includes(a.lifecycleStatus)) || b.score - a.score),
    [setups]
  );
  const history = useMemo(
    () => setups.filter((setup) => TERMINAL.includes(setup.lifecycleStatus)).sort((a, b) => b.updatedAtUtc - a.updatedAtUtc),
    [setups]
  );
  const displayed = mode === "active" ? active : history;
  const selected = displayed.find((setup) => setup.setupId === selectedId) ?? displayed[0];
  const selectedLogs = selected ? logs.filter((log) => log.setupId === selected.setupId) : [];
  const live = active[0];
  const windowActive = Boolean(live && now >= live.windowStartUtc && now < live.windowEndUtc);
  const remainingMin = live && windowActive ? Math.max(0, Math.round((live.windowEndUtc - now) / 60000)) : null;

  useEffect(() => {
    if (displayed.length && !displayed.some((setup) => setup.setupId === selectedId)) setSelectedId(displayed[0].setupId);
  }, [displayed, selectedId]);

  useEffect(() => {
    setAnalysis({ status: "disabled", reason: "" });
  }, [selected?.setupId]);

  const requestAnalysis = async () => {
    if (!selected || analysisLoading) return;
    setAnalysisLoading(true);
    try {
      setAnalysis(await fetchSilverBulletAnalysis(selected));
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <section className="silver-bullet-section simple-session-page">
      <article className="panel session-summary-strip simple-session-summary">
        <div>
          <span className="eyebrow">Silver Bullet</span>
          <h2>{windowActive ? `Pencere açık · ${remainingMin} dk` : "Pencere kapalı"}</h2>
          <p>{nyClock(now)} · İşlem penceresi 10:00–11:00 NY.</p>
        </div>
        <div className="session-summary-metrics">
          <span><strong>{active.filter((setup) => READY.includes(setup.lifecycleStatus)).length}</strong> hazır</span>
          <span><strong>{active.length}</strong> aktif</span>
        </div>
      </article>

      <div className="simple-mode-switch" role="tablist" aria-label="Silver Bullet görünümü">
        <button className={mode === "active" ? "active" : ""} onClick={() => setMode("active")} type="button">Aktif ({active.length})</button>
        <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")} type="button">Geçmiş ({history.length})</button>
      </div>

      <div className="session-workspace simple-session-workspace">
        <article className="panel session-list-panel">
          <div className="session-setup-list">
            {displayed.map((setup) => (
              <button
                className={`session-setup-row simple-session-row ${selected?.setupId === setup.setupId ? "selected" : ""} ${setup.lifecycleStatus.toLowerCase()}`}
                key={setup.setupId}
                onClick={() => setSelectedId(setup.setupId)}
                type="button"
              >
                <span className={`session-direction-dot ${setup.direction === "none" ? "neutral" : setup.direction}`} />
                <span className="session-row-main">
                  <strong>{setup.symbol} {setup.direction === "none" ? "" : setup.direction.toUpperCase()}</strong>
                  <small>{nextStep(setup)}</small>
                </span>
                <span className="session-row-score"><strong>{setup.grade}</strong><small>{setup.score} kalite</small></span>
                <span className="session-row-status">{lifecycleLabel(setup.lifecycleStatus)}</span>
              </button>
            ))}
            {!displayed.length && (
              <div className="empty-decision-state">
                <strong>{mode === "active" ? "Şu an setup yok." : "Geçmiş boş."}</strong>
                <span>{mode === "active" ? "10:00 NY sonrası range sweep oluşursa burada görünür." : "Kapanan pencereler burada tutulur."}</span>
              </div>
            )}
          </div>
        </article>

        <aside className="panel session-detail-panel simple-session-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">10:00–11:00 NY</span>
                  <h2>{selected.symbol} {selected.direction === "none" ? "" : selected.direction.toUpperCase()}</h2>
                </div>
                <span className={`session-state-badge ${selected.lifecycleStatus.toLowerCase()}`}>{lifecycleLabel(selected.lifecycleStatus)}</span>
              </header>

              <div className="session-decision simple-next-step">
                <span>Tek beklenen</span>
                <strong>{nextStep(selected)}</strong>
                {selected.plan && <p>Giriş {selected.plan.entry.toFixed(4)} · Stop {selected.plan.stopLoss.toFixed(4)} · Hedef {selected.plan.targets[0]?.toFixed(4)} · RR 1:{selected.plan.plannedRR.toFixed(2)}</p>}
              </div>

              <div className="session-detail-actions">
                <button className="ghost-btn" onClick={requestAnalysis} disabled={analysisLoading} type="button">
                  <Brain size={15} /> {analysisLoading ? "Okuyor" : "AI yorum"}
                </button>
              </div>

              {(analysis.status === "ready" || analysis.status === "error") && (
                <div className="session-ai-note">
                  <span><Sparkles size={14} /> AI notu</span>
                  {analysis.status === "ready"
                    ? <p>{String(analysis.analysis.plain_language_summary ?? "Özet yok.")}</p>
                    : <p>{analysis.error}</p>}
                </div>
              )}

              <details className="compact-details session-plan-details">
                <summary>Plan haritası</summary>
                <SilverBulletPlanChart setup={selected} />
              </details>

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
                    <div key={log.id}><strong>{lifecycleLabel(log.statusAfter)}</strong><span>{log.reason}</span><time>{timeLabel(log.eventTimestampUtc)}</time></div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="empty-decision-state"><strong>Setup yok.</strong><span>Geçerli pencere yapısı oluşunca burada görünür.</span></div>
          )}
        </aside>
      </div>
    </section>
  );
}
