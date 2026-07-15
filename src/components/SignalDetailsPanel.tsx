import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { signalAnchorTime } from "../lib/charts/selectedSignal";
import { fetchGeminiTradeCommentary, type GeminiTradeCommentaryResponse } from "../lib/gemini/tradeCommentary";
import { fetchCrtAnalysis, type CrtAnalysisResponse } from "../lib/gemini/crtInterpretation";
import { formatPrice, formatR } from "../lib/ict/format";
import type { DecisionChecklistItem, SignalEvidenceItem, TradingSignal } from "../lib/ict/types";
import type { JournalEntry, TradeAction } from "../lib/journal/types";
import { buildStructureAudit } from "../lib/signals/structureAudit";
import { signalDecisionClass } from "../lib/signals/signalClassification";
import { waitingRequirementsForMinimumRR } from "./ScannerView";

function statusClass(status: DecisionChecklistItem["status"] | SignalEvidenceItem["status"]) {
  return `status-pill ${status}`;
}

function stopSourceText(signal: TradingSignal) {
  if (signal.plan.stopSource === "sweep") return signal.direction === "short" ? "Sweep high üstü" : "Sweep low altı";
  if (signal.plan.stopSource === "fvg") return signal.direction === "short" ? "FVG üstü" : "FVG altı";
  if (signal.plan.stopSource === "swing") return signal.direction === "short" ? "Swing high üstü" : "Swing low altı";
  if (signal.plan.stopSource === "manipulation") return signal.direction === "short" ? "Manipulation wick üstü" : "Manipulation wick altı";
  return "Volatility floor";
}

function rrStatusText(signal: TradingSignal) {
  if (signal.stage === "invalidated") return "GEÇERSİZ / STOP GÖRÜLDÜ";
  if (signal.stage === "missed") return "MISSED / GEÇ KALDI";
  if (signal.plan.executionCosts.stress !== "off" && signal.plan.grossRR > signal.plan.rr && signal.plan.rr < 1.5) return "FRICTION WATCH";
  if (signal.plan.planWarnings.some((item) => item.includes("READY değil"))) return "WATCH";
  return "Uygun";
}

function actionTitle(signal: TradingSignal) {
  if (signalDecisionClass(signal) === "invalid") return "Geçersiz";
  if (signal.stage === "ready") return "Plan hazır";
  if (signal.stage === "watch") return "Bekle";
  if (signal.stage === "invalidated") return "Bozuldu";
  return "Geç kaldı";
}

function numberInputValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function tradeRMultiple(signal: TradingSignal, entry: number | undefined, exit: number | undefined) {
  if (typeof exit !== "number") return undefined;
  const actualEntry = entry ?? signal.plan.entry;
  const risk = Math.abs(actualEntry - signal.plan.stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) return undefined;
  const reward = signal.direction === "long" ? exit - actualEntry : actualEntry - exit;
  return reward / risk;
}

export function SignalDetailsPanel({
  signal,
  journalEntry,
  onClear,
  onSaveJournal
}: {
  signal: TradingSignal;
  journalEntry?: JournalEntry;
  onClear: () => void;
  onSaveJournal: (signal: TradingSignal, patch: Partial<JournalEntry>) => void;
}) {
  const [notes, setNotes] = useState(journalEntry?.notes ?? "");
  const [mistake, setMistake] = useState(journalEntry?.mistake ?? "");
  const [executionQuality, setExecutionQuality] = useState(journalEntry?.executionQuality ?? "beklemede");
  const [result, setResult] = useState<JournalEntry["result"]>(journalEntry?.result ?? "open");
  const [tradeAction, setTradeAction] = useState<TradeAction>(journalEntry?.tradeAction ?? "watch");
  const [actualEntry, setActualEntry] = useState(numberInputValue(journalEntry?.actualEntry));
  const [actualExit, setActualExit] = useState(numberInputValue(journalEntry?.actualExit ?? journalEntry?.exit));
  const [positionSize, setPositionSize] = useState(numberInputValue(journalEntry?.positionSize));
  const [riskPct, setRiskPct] = useState(numberInputValue(journalEntry?.riskPct));
  const [outcomeNote, setOutcomeNote] = useState(journalEntry?.outcomeNote ?? "");
  const [aiCommentary, setAiCommentary] = useState<GeminiTradeCommentaryResponse>({ status: "disabled", reason: "Yüklenmedi" });
  const [aiLoading, setAiLoading] = useState(false);
  const [crtAnalysis, setCrtAnalysis] = useState<CrtAnalysisResponse>({ status: "disabled", reason: "Yüklenmedi" });
  const [crtAnalysisLoading, setCrtAnalysisLoading] = useState(false);
  const structureAudit = buildStructureAudit(signal);
  const decisionClass = signalDecisionClass(signal);
  const activeKillzone = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const setupTime = new Date(signalAnchorTime(signal)).toLocaleString();
  const waitItems = waitingRequirementsForMinimumRR(signal, 1.5).slice(0, 3);
  const actualEntryNumber = optionalNumber(actualEntry);
  const actualExitNumber = optionalNumber(actualExit);
  const calculatedR = tradeRMultiple(signal, actualEntryNumber, actualExitNumber);
  const primaryWait = signal.stage === "ready"
    ? "Plan hazır: entry, stop ve DOL belli. Sadece kendi risk limitin uygunsa işlem alınır."
    : signal.governance.blockers[0] ?? waitItems[0] ?? "Yeni CRT sweep ve ChoCH kapanışı bekle.";
  const secondaryWait = signal.stage === "ready"
    ? signal.decisionSummary.invalidation[0] ?? "Stop seviyesi görülürse plan iptal."
    : waitItems.find((item) => item !== primaryWait) ?? signal.decisionSummary.invalidation[0] ?? "Onay gelmezse işlem yok.";
  useEffect(() => {
    setNotes(journalEntry?.notes ?? "");
    setMistake(journalEntry?.mistake ?? "");
    setExecutionQuality(journalEntry?.executionQuality ?? "beklemede");
    setResult(journalEntry?.result ?? "open");
    setTradeAction(journalEntry?.tradeAction ?? "watch");
    setActualEntry(numberInputValue(journalEntry?.actualEntry));
    setActualExit(numberInputValue(journalEntry?.actualExit ?? journalEntry?.exit));
    setPositionSize(numberInputValue(journalEntry?.positionSize));
    setRiskPct(numberInputValue(journalEntry?.riskPct));
    setOutcomeNote(journalEntry?.outcomeNote ?? "");
  }, [journalEntry, signal.id]);

  useEffect(() => {
    let active = true;
    setAiLoading(true);
    setAiCommentary({ status: "disabled", reason: "Gemini yorumu bekleniyor." });
    void fetchGeminiTradeCommentary(signal).then((response) => {
      if (!active) return;
      setAiCommentary(response);
      setAiLoading(false);
    });
    return () => {
      active = false;
    };
  }, [signal.id]);

  useEffect(() => {
    let active = true;
    setCrtAnalysisLoading(true);
    setCrtAnalysis({ status: "disabled", reason: "CRT analizi bekleniyor." });
    void fetchCrtAnalysis(signal).then((response) => {
      if (!active) return;
      setCrtAnalysis(response);
      setCrtAnalysisLoading(false);
    });
    return () => {
      active = false;
    };
  }, [signal.id]);

  const saveJournal = (
    nextResult = result,
    nextAction: TradeAction = tradeAction,
    options: { usePlanEntry?: boolean; useStopExit?: boolean } = {}
  ) => {
    const now = Date.now();
    const isTaken = nextAction === "taken";
    const normalizedResult = isTaken ? nextResult : "open";
    const entryForSave = isTaken ? optionalNumber(actualEntry) ?? signal.plan.entry : undefined;
    const exitForSave = isTaken ? options.useStopExit ? signal.plan.stopLoss : optionalNumber(actualExit) : undefined;
    const nextR = isTaken ? tradeRMultiple(signal, entryForSave, exitForSave) : undefined;
    onSaveJournal(signal, {
      notes,
      mistake,
      executionQuality,
      tradeAction: nextAction,
      actualEntry: entryForSave,
      actualExit: exitForSave,
      exit: exitForSave,
      positionSize: optionalNumber(positionSize),
      riskPct: optionalNumber(riskPct),
      rMultiple: nextR,
      outcomeNote,
      takenAt: isTaken ? journalEntry?.takenAt ?? now : undefined,
      closedAt: normalizedResult !== "open" ? journalEntry?.closedAt ?? now : undefined,
      result: normalizedResult,
      ruleViolations: signal.decisionSummary.checklist.filter((item) => item.status === "fail").map((item) => item.label)
    });
    setResult(normalizedResult);
    setTradeAction(nextAction);
    if (!isTaken) {
      setActualEntry("");
      setActualExit("");
    } else {
      if (!actualEntry && entryForSave) setActualEntry(String(entryForSave));
      if (options.useStopExit) setActualExit(String(signal.plan.stopLoss));
    }
  };

  return (
    <aside className="panel signal-details-panel compact">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Sinyal</span>
          <h2>{signal.symbol} {signal.direction.toUpperCase()}</h2>
          {signal.crtAnchor && (
            <p className="muted-note">{signal.crtAnchor.originLabel ?? `CRT mumu: ${signal.crtAnchor.rangeTf.toUpperCase()}`} · Onay: {signal.crtAnchor.confirmTf.toUpperCase()}{signal.crtAnchor.raidClosed ? " · raid kapalı" : signal.crtAnchor.raidActive ? " · raid canlı" : ""}</p>
          )}
        </div>
        <button className="icon-btn" onClick={onClear} type="button" aria-label="Seçili sinyali temizle"><X size={16} /></button>
      </header>
      <section className={`simple-signal-card ${decisionClass === "invalid" ? "invalidated" : signal.stage}`}>
        <div>
          <span>{actionTitle(signal)}</span>
          <strong>{signal.grade} · {signal.score} puan</strong>
        </div>
        <h3>{signal.symbol} {signal.direction.toUpperCase()} · {formatR(signal.plan.rr)}</h3>
        <p>{structureAudit.decision}</p>
      </section>
      <div className="simple-plan-grid">
        <div><span>Giriş</span><strong>{formatPrice(signal.plan.entry)}</strong></div>
        <div><span>Stop</span><strong>{formatPrice(signal.plan.stopLoss)}</strong></div>
        <div><span>TP / DOL</span><strong>{formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0])}</strong></div>
        <div><span>RR</span><strong>{formatR(signal.plan.rr)}</strong></div>
      </div>
      <section className="simple-next-card">
        <span>{signal.stage === "ready" ? "Ne yapacağım?" : "Şimdi beklenen"}</span>
        <strong>{primaryWait}</strong>
        {signal.stage === "ready" && <small>{secondaryWait}</small>}
      </section>
      <section className="journal-quick-card" aria-label="Hızlı işlem kaydı">
        <span>Bu setup için</span>
        <div className="journal-quick-actions">
          <button className={tradeAction === "taken" && result === "open" ? "active" : ""} type="button" onClick={() => saveJournal("open", "taken", { usePlanEntry: true })}>Aldım</button>
          <button className={tradeAction === "skipped" ? "active" : ""} type="button" onClick={() => saveJournal("open", "skipped")}>Almadım</button>
          <button className={result === "loss" ? "active loss" : ""} type="button" onClick={() => saveJournal("loss", "taken", { usePlanEntry: true, useStopExit: true })}>Stop oldu</button>
        </div>
      </section>
      <section className={`ai-commentary simple-ai-commentary ${aiCommentary.status}`}>
        <h3>AI mentor</h3>
        <p>
          {aiLoading
            ? "Gemini chartı CRT mentor gibi okuyor..."
            : aiCommentary.status === "ready" || aiCommentary.status === "fallback"
              ? aiCommentary.commentary
              : aiCommentary.status === "disabled"
                ? "Gemini env yok. Render Environment'a GEMINI_API_KEY veya GOOGLE_API_KEY ekleyip servisi yeniden deploy et; localde .env dosyasına ekleyip serverı yeniden başlat."
                : `AI yorumu alınamadı: ${aiCommentary.error ?? aiCommentary.reason ?? "bilinmeyen hata"}`}
        </p>
      </section>
      <section className={`crt-analysis-card ${crtAnalysis.status === "ready" ? "ready" : crtAnalysis.status}`}>
        <header className="crt-analysis-head">
          <h3>CRT Analiz (Gemini)</h3>
          {crtAnalysis.status === "ready" && crtAnalysis.analysis.bias && (
            <span className={`crt-bias-pill ${crtAnalysis.analysis.bias}`}>
              {crtAnalysis.analysis.bias.toUpperCase()}
              {typeof crtAnalysis.analysis.confidence === "number" ? ` · güven ${crtAnalysis.analysis.confidence}` : ""}
            </span>
          )}
        </header>
        {crtAnalysisLoading ? (
          <p className="crt-analysis-summary">Deterministik kanıt Gemini'ye yorumlatılıyor…</p>
        ) : crtAnalysis.status === "ready" ? (
          <div className="crt-analysis-body">
            <p className="crt-analysis-summary">{crtAnalysis.analysis.summary ?? "Özet yok."}</p>
            <div className="crt-analysis-tags">
              {crtAnalysis.analysis.crtStatus && <span className="crt-tag">Durum: {crtAnalysis.analysis.crtStatus}</span>}
              {crtAnalysis.analysis.referenceCandleQuality && <span className="crt-tag">Range mumu: {crtAnalysis.analysis.referenceCandleQuality}</span>}
              {crtAnalysis.analysis.externalDraw && <span className="crt-tag">Draw: {crtAnalysis.analysis.externalDraw}</span>}
            </div>
            {crtAnalysis.analysis.contradictions.length > 0 && (
              <div className="crt-analysis-list contradictions">
                <span className="crt-list-label">Çelişkiler</span>
                <ul>{crtAnalysis.analysis.contradictions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {crtAnalysis.analysis.missingEvidence.length > 0 && (
              <div className="crt-analysis-list missing">
                <span className="crt-list-label">Eksik kanıt</span>
                <ul>{crtAnalysis.analysis.missingEvidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
          </div>
        ) : crtAnalysis.status === "disabled" ? (
          <p className="crt-analysis-summary">Gemini env yok. GEMINI_API_KEY ekleyince deterministik kanıt yapısal olarak yorumlanır.</p>
        ) : (
          <p className="crt-analysis-summary">CRT analizi alınamadı: {crtAnalysis.error ?? "bilinmeyen hata"}</p>
        )}
      </section>
      <details className="details-section compact-details">
        <summary>Teknik detay</summary>
        <div className="detail-grid compact-detail-grid">
          <div><span>Entry modeli</span><strong>{signal.plan.entrySource}</strong></div>
          <div><span>Entry durumu</span><strong>{signal.plan.entryStatus}</strong></div>
          <div><span>Stop nedeni</span><strong>{stopSourceText(signal)}</strong></div>
          <div><span>Risk</span><strong>{formatPrice(signal.plan.riskDistance)}</strong></div>
          <div><span>Zone</span><strong>{signal.context.premiumDiscount.zone}</strong></div>
          <div><span>Session</span><strong>{activeKillzone}</strong></div>
          <div><span>POI retest</span><strong>{signal.plan.entryModel.retested ? "var · bonus" : "yok · şart değil"}</strong></div>
          <div><span>ChoCH/Just</span><strong>{signal.plan.entryModel.cisdConfirmed ? "var" : "bekliyor"}</strong></div>
          <div><span>Friction</span><strong>{signal.plan.executionCosts.stress === "off" ? "kapalı" : formatPrice(signal.plan.executionCosts.total)}</strong></div>
          <div><span>RR durumu</span><strong>{rrStatusText(signal)}</strong></div>
          <div><span>Rejim</span><strong>{signal.context.regime.type}</strong></div>
          <div><span>Event</span><strong>{signal.context.eventRisk.level}</strong></div>
          <div><span>Veri güveni</span><strong>{signal.context.dataConfidence.grade} · {signal.context.dataConfidence.score}</strong></div>
          <div><span>Replay</span><strong>{signal.outcome.status}</strong></div>
          <div><span>Window</span><strong>{signal.actionWindow.status}</strong></div>
          <div><span>Governance</span><strong>{signal.governance.status}</strong></div>
        </div>
        <div className="detail-checklist">
          {signal.governance.checklist.slice(0, 6).map((item) => (
            <div key={item.label}>
              <span className={statusClass(item.status)}>{item.status}</span>
              <strong>{item.label}</strong>
              <small>{item.explanation}</small>
            </div>
          ))}
        </div>
      </details>
      <details className="details-section compact-details">
        <summary>Not ve sonuç detayı</summary>
        <div className="journal-form">
          <div className="journal-trade-actions" aria-label="Trade aksiyonu">
            <button className={tradeAction === "taken" ? "active" : ""} type="button" onClick={() => saveJournal("open", "taken", { usePlanEntry: true })}>İşlemi aldım</button>
            <button className={tradeAction === "skipped" ? "active" : ""} type="button" onClick={() => saveJournal("open", "skipped")}>Pas geçtim</button>
            <button className={tradeAction === "missed" ? "active" : ""} type="button" onClick={() => saveJournal("open", "missed")}>Kaçtı</button>
            <button className={tradeAction === "watch" ? "active" : ""} type="button" onClick={() => saveJournal("open", "watch")}>İzle</button>
          </div>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Bu sinyal için not: neden aldın/almazsın, stop mantığı, psikoloji, sonradan bakılacak ders..." />
          <div className="form-grid compact">
            <label>Aksiyon
              <select value={tradeAction} onChange={(event) => setTradeAction(event.target.value as TradeAction)}>
                <option value="watch">izliyorum</option>
                <option value="taken">işlemi aldım</option>
                <option value="skipped">pas geçtim</option>
                <option value="missed">kaçtı / alamadım</option>
              </select>
            </label>
            <label>Sonuç
              <select value={result ?? "open"} onChange={(event) => setResult(event.target.value as JournalEntry["result"])}>
                <option value="open">izleme/açık</option>
                <option value="win">win</option>
                <option value="loss">loss</option>
                <option value="breakeven">breakeven</option>
              </select>
            </label>
            <label>Execution
              <select value={executionQuality} onChange={(event) => setExecutionQuality(event.target.value)}>
                <option value="beklemede">beklemede</option>
                <option value="temiz">temiz</option>
                <option value="erken">erken girdim</option>
                <option value="gec">geç kaldım</option>
                <option value="riskli">risk kötü</option>
              </select>
            </label>
            <label>Gerçek entry
              <input inputMode="decimal" value={actualEntry} onChange={(event) => setActualEntry(event.target.value)} placeholder={formatPrice(signal.plan.entry)} />
            </label>
            <label>Gerçek exit
              <input inputMode="decimal" value={actualExit} onChange={(event) => setActualExit(event.target.value)} placeholder="kapanış fiyatı" />
            </label>
            <label>Risk %
              <input inputMode="decimal" value={riskPct} onChange={(event) => setRiskPct(event.target.value)} placeholder="örn. 0.5" />
            </label>
            <label>Pozisyon
              <input inputMode="decimal" value={positionSize} onChange={(event) => setPositionSize(event.target.value)} placeholder="lot / adet" />
            </label>
            <label>Hata etiketi
              <input value={mistake} onChange={(event) => setMistake(event.target.value)} placeholder="örn. stop dar, HTF ters" />
            </label>
          </div>
          <div className="journal-r-summary">
            <span>Plan R: {formatR(signal.plan.rr)}</span>
            <strong>{typeof calculatedR === "number" ? `Gerçek sonuç: ${calculatedR.toFixed(2)}R` : "Gerçek R için entry/exit gir"}</strong>
          </div>
          <textarea className="compact-note" value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="İşlem sonucu: neden aldın, nerede kapattın, plan dışı hareket var mı?" />
          <div className="journal-actions">
            <button className="ghost-btn" type="button" onClick={() => saveJournal("open")}>Notu kaydet</button>
            <button className="ghost-btn" type="button" onClick={() => saveJournal("win", "taken", { usePlanEntry: true })}>Win kapat</button>
            <button className="ghost-btn" type="button" onClick={() => saveJournal("loss", "taken", { usePlanEntry: true, useStopExit: true })}>Stop kapat</button>
            <button className="ghost-btn" type="button" onClick={() => saveJournal("breakeven", "taken", { usePlanEntry: true })}>BE kapat</button>
          </div>
        </div>
      </details>
      <details className="details-section compact-details">
        <summary>Replay</summary>
        <div className="evidence-list">
          {signal.evidence.slice(0, 8).map((item) => (
            <div key={item.id}>
              <span className={statusClass(item.status)}>{item.status}</span>
              <strong>{item.label}</strong>
              <small>
                {item.time ? `${new Date(item.time).toLocaleString()} · ` : ""}
                {typeof item.price === "number" ? `${formatPrice(item.price)} · ` : ""}
                {item.detail}
              </small>
            </div>
          ))}
        </div>
        <p>{signal.decisionSummary.invalidation[0] ?? (signal.direction === "short" ? "Setup sweep high üstünde invalid olur." : "Setup sweep low altında invalid olur.")}</p>
        <p><strong>Outcome:</strong> {signal.outcome.summary}</p>
        <p><strong>Action window:</strong> {signal.actionWindow.summary}</p>
        <p><strong>Governance:</strong> {signal.governance.summary}</p>
        <p>{signal.decisionSummary.fullReasoning}</p>
        <p className="muted-note">Setup zamanı: {setupTime}</p>
      </details>
    </aside>
  );
}
