import { useEffect, useMemo, useState } from "react";
import { Brain, Clock3, Crosshair, Sparkles } from "lucide-react";
import { fetchSilverBulletAnalysis, type SbAnalysisResponse } from "../lib/gemini/silverBulletInterpretation";
import { tzOffsetHours } from "../lib/session/sessionClock";
import type { SbLifecycle, SilverBulletLog, SilverBulletSetup } from "../lib/strategies/silverBullet/types";

const TERMINAL: SbLifecycle[] = ["STOPPED", "INVALIDATED", "LATE", "EXPIRED", "NO_TRADE", "COMPLETED", "BOTH_SIDES_SWEPT", "BREAK_ACCEPTED_OUTSIDE"];

function lifecycleLabel(status: SbLifecycle): string {
  switch (status) {
    case "REFERENCE_BUILDING": return "09:00 mumu oluşuyor";
    case "WAITING_FOR_SWEEP": return "Sweep bekleniyor";
    case "WAITING_FOR_RECLAIM": return "Reclaim bekleniyor";
    case "WAITING_FOR_DISPLACEMENT": return "Displacement bekleniyor";
    case "WAITING_FOR_STRUCTURE_SHIFT": return "MSS/CISD bekleniyor";
    case "WAITING_FOR_ENTRY_ARRAY": return "Entry array bekleniyor";
    case "ORDER_PENDING": return "Emir bekliyor";
    case "ENTRY_FILLED": return "Entry doldu";
    case "ACTIVE": return "Aktif";
    case "TARGET_1_REACHED": return "TP1 görüldü";
    case "TARGET_2_REACHED": return "TP2 görüldü";
    case "STOPPED": return "Stop";
    case "BOTH_SIDES_SWEPT": return "İki taraf süpürüldü";
    case "BREAK_ACCEPTED_OUTSIDE": return "Dışarıda kabul";
    case "INVALIDATED": return "Geçersiz";
    case "LATE": return "Geç";
    case "EXPIRED": return "Süre doldu";
    case "NO_TRADE": return "No-trade";
    case "COMPLETED": return "Tamamlandı";
    default: return "Gelişiyor";
  }
}

function nyClock(now: number): string {
  const offset = tzOffsetHours("America/New_York", now);
  const local = new Date(now + offset * 60 * 60 * 1000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")} NY (UTC${offset >= 0 ? "+" : ""}${offset})`;
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
}

export function SilverBulletSection({ setups, logs }: { setups: SilverBulletSetup[]; logs: SilverBulletLog[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(setups[0]?.setupId ?? null);
  const [analysis, setAnalysis] = useState<SbAnalysisResponse>({ status: "disabled", reason: "AI yorumu yalnız seçili setup için alınır." });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const now = Date.now();

  const ordered = useMemo(
    () => [...setups].sort((a, b) => Number(TERMINAL.includes(a.lifecycleStatus)) - Number(TERMINAL.includes(b.lifecycleStatus)) || b.updatedAtUtc - a.updatedAtUtc),
    [setups]
  );
  const selected = ordered.find((setup) => setup.setupId === selectedId) ?? ordered[0];
  const selectedLogs = selected ? logs.filter((log) => log.setupId === selected.setupId) : [];
  const live = ordered.find((setup) => !TERMINAL.includes(setup.lifecycleStatus));
  const windowActive = live ? now >= live.windowStartUtc && now < live.windowEndUtc : false;
  const remainingMin = live && windowActive ? Math.max(0, Math.round((live.windowEndUtc - now) / 60000)) : null;

  useEffect(() => {
    if (ordered.length && !ordered.some((setup) => setup.setupId === selectedId)) {
      setSelectedId(ordered[0].setupId);
    }
  }, [ordered, selectedId]);

  useEffect(() => {
    setAnalysis({ status: "disabled", reason: "AI yorumu yalnız seçili setup için alınır." });
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
    <div className="silver-bullet-section">
      <article className="panel session-summary-strip">
        <div>
          <span className="eyebrow">ICT Silver Bullet · NY AM 09:00 range</span>
          <h2>{windowActive ? `Pencere AÇIK · ${remainingMin} dk kaldı` : "Pencere kapalı (10:00–11:00 NY)"}</h2>
          <p>{nyClock(now)} · 09:00 mumu sweep → reclaim → displacement → MSS/CISD → FVG → 11:00'dan önce fill.</p>
        </div>
        <div className="session-summary-metrics">
          <span><strong>{ordered.filter((setup) => !TERMINAL.includes(setup.lifecycleStatus)).length}</strong> canlı</span>
          <span><strong>{ordered.filter((setup) => setup.lifecycleStatus === "NO_TRADE").length}</strong> no-trade</span>
          <span><strong>{ordered.filter((setup) => setup.plan?.entryFilledUtc).length}</strong> fill</span>
        </div>
      </article>

      <div className="session-workspace">
        <article className="panel session-list-panel">
          <header className="session-filterbar">
            <div className="session-tabs"><button className="active" type="button"><Crosshair size={14} /> NY_AM_09_HOURLY_RANGE_REVERSAL_V1</button></div>
          </header>
          <div className="session-setup-list">
            {ordered.map((setup) => (
              <button
                className={`session-setup-row ${selected?.setupId === setup.setupId ? "selected" : ""} ${setup.lifecycleStatus.toLowerCase()}`}
                key={setup.setupId}
                onClick={() => setSelectedId(setup.setupId)}
                type="button"
              >
                <span className={`session-direction-dot ${setup.direction === "none" ? "neutral" : setup.direction}`} />
                <span className="session-row-main">
                  <strong>{setup.symbol} {setup.direction === "none" ? "" : setup.direction.toUpperCase()}</strong>
                  <small>{setup.referenceRange.low.toFixed(2)} – {setup.referenceRange.high.toFixed(2)} · {setup.referenceRange.quality}</small>
                </span>
                <span className="session-row-model">{setup.triggerType ?? setup.sweep?.side ?? "—"}</span>
                <span className="session-row-score"><strong>{setup.score}</strong><small>{setup.grade}</small></span>
                <span className="session-row-status">{lifecycleLabel(setup.lifecycleStatus)}</span>
              </button>
            ))}
            {!ordered.length && (
              <div className="empty-decision-state">
                <strong>Bugün Silver Bullet verisi yok.</strong>
                <span>09:00 NY referans mumu oluşunca burada görünür.</span>
              </div>
            )}
          </div>
        </article>

        <aside className="panel session-detail-panel">
          {selected ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selected.setupModel ?? "SILVER BULLET"} · {selected.tradingDayId}</span>
                  <h2>{selected.symbol} {selected.direction === "none" ? "" : selected.direction.toUpperCase()}</h2>
                  <p>Skor {selected.score} / {selected.grade} · HTF {selected.htfAlignment}</p>
                </div>
                <span className={`session-state-badge ${selected.lifecycleStatus.toLowerCase()}`}>{lifecycleLabel(selected.lifecycleStatus)}</span>
              </header>

              {selected.plan && (
                <div className="session-decision">
                  <strong>Entry {selected.plan.entry.toFixed(4)} · Stop {selected.plan.stopLoss.toFixed(4)} · TP {selected.plan.targets.map((target) => target.toFixed(4)).join(" / ")}</strong>
                  <p>Planlanan R:R {selected.plan.plannedRR} {selected.plan.entryFilledUtc ? `· fill ${timeLabel(selected.plan.entryFilledUtc)} (kalan ${Math.round((selected.plan.remainingSecondsAtEntry ?? 0) / 60)} dk)` : "· emir dolmadı"}</p>
                </div>
              )}
              {!selected.plan && <div className="session-decision"><strong>{selected.summary}</strong></div>}

              {(selected.noTradeReasons.length > 0 || selected.invalidationReasons.length > 0) && (
                <div className="session-decision">
                  <strong>{selected.noTradeReasons.length ? "NO-TRADE" : "GEÇERSİZ"}</strong>
                  <p>{[...selected.noTradeReasons, ...selected.invalidationReasons].join(" · ")}</p>
                </div>
              )}

              <div className="session-evidence-list">
                {selected.events.map((event) => (
                  <div className={event.status} key={event.id}>
                    <span>{event.status === "pass" ? "✓" : event.status === "fail" ? "×" : "·"}</span>
                    <p><strong>{event.label}</strong><small>{event.detail}</small></p>
                    {event.timestampUtc && <time>{timeLabel(event.timestampUtc)}</time>}
                  </div>
                ))}
              </div>

              <div className="session-detail-actions">
                <button className="ghost-btn" onClick={requestAnalysis} disabled={analysisLoading} type="button">
                  <Brain size={15} /> {analysisLoading ? "AI okuyor" : "AI yorumla"}
                </button>
              </div>

              <div className="session-ai-note">
                <span><Sparkles size={14} /> Silver Bullet mentor</span>
                {analysis.status === "ready"
                  ? (() => {
                      const strategy = analysis.analysis.strategy_analysis as { status?: string } | undefined;
                      const summary = String(analysis.analysis.plain_language_summary ?? "");
                      return <><strong>{strategy?.status ?? "?"} · Gemini</strong><p>{summary}</p></>;
                    })()
                  : <p>{analysis.status === "error" ? analysis.error : analysis.reason}</p>}
              </div>

              <details className="compact-details">
                <summary><Clock3 size={14} /> Setup geçmişi</summary>
                <div className="session-log-list">
                  {selectedLogs.map((log) => (
                    <div key={log.id}><strong>{lifecycleLabel(log.statusAfter)}</strong><span>{log.reason}</span><time>{timeLabel(log.eventTimestampUtc)}</time></div>
                  ))}
                  {!selectedLogs.length && <p className="muted-note">Henüz lifecycle logu yok.</p>}
                </div>
              </details>
            </>
          ) : (
            <div className="empty-decision-state"><strong>Setup seç.</strong><span>09:00 range, sweep ve onay zinciri burada görünür.</span></div>
          )}
        </aside>
      </div>
    </div>
  );
}
