import { ArrowRight, CircleAlert, CircleCheck, Clock3, Play } from "lucide-react";
import type { TradingSignal } from "../lib/ict/types";
import type { RejectedSetup } from "../lib/strategies/types";
import { formatPrice, formatR } from "../lib/ict/format";
import { isCryptoSymbol } from "../lib/ict/symbols";
import type { MarketDataSource } from "../lib/data/yahooProvider";
import type { DataHealthReport } from "../lib/data/dataHealth";
import { signalDecisionLabel, signalDecisionReason } from "../lib/signals/signalClassification";
import { closeConfirmationRequirement, entryRetestRequirement } from "../lib/signals/waitingGuidance";

function stagePriority(signal: TradingSignal) {
  if (signal.stage === "ready") return 3000;
  if (signal.stage === "watch") return 2000;
  if (signal.stage === "missed") return 500;
  return 0;
}

function sortForAction(signals: TradingSignal[]) {
  return [...signals].sort((a, b) => {
    const stageScore = stagePriority(b) - stagePriority(a);
    return stageScore || b.score - a.score || b.plan.rr - a.plan.rr;
  });
}

function expectedLiquiditySide(signal: TradingSignal) {
  return signal.direction === "long" ? "sell-side" : "buy-side";
}

function expectedBias(signal: TradingSignal) {
  return signal.direction === "long" ? "bullish" : "bearish";
}

function expectedPdZone(signal: TradingSignal) {
  return signal.direction === "long" ? "discount" : "premium";
}

function simpleDirectionText(signal: TradingSignal) {
  return signal.direction === "long" ? "yukarı" : "aşağı";
}

function simplePdText(signal: TradingSignal) {
  return signal.direction === "long"
    ? "Fiyat daha ucuz bölgeye insin."
    : "Fiyat daha pahalı bölgeye çıksın.";
}

function simpleSweepText(signal: TradingSignal) {
  return signal.direction === "long"
    ? "Önce alttaki stoplar alınsın, sonra fiyat geri dönsün."
    : "Önce üstteki stoplar alınsın, sonra fiyat geri dönsün.";
}

function simpleChecklistText(label: string, signal: TradingSignal): string | null {
  const direction = simpleDirectionText(signal);
  switch (label) {
    case "Dealing Range":
      return "Günlük aralık net olmalı.";
    case "Entry Model":
      return "Giriş alanı netleşsin ve mum kapanışıyla onay gelsin.";
    case "Premium / Discount":
      return simplePdText(signal);
    case "Killzone":
      return "Doğru saat gelsin: London veya New York zamanı.";
    case "Judas Swing":
      return "Session başındaki ters hareket daha net görünsün.";
    case "Liquidity Sweep":
      return simpleSweepText(signal);
    case "Displacement":
      return `Fiyat ${direction} tarafa güçlü bir mum atsın.`;
    case "MSS":
      return `Yön değişimi ${direction} tarafa mum kapanışıyla netleşsin.`;
    case "FVG":
      return signal.plan.entryModel.fairValueGap
        ? "Seçilen FVG/iFVG kutusu korunup retest temiz kalsın."
        : "Giriş kapanış/onay modeliyle netleşsin.";
    case "SMT":
      return "SMT pair teyidi gelirse kalite artar; yoksa tek başına no-trade sebebi değil.";
    case "RR":
      return "Hedef mesafesi stop riskine değsin.";
    case "Execution Cost":
      return "Spread/slippage planı bozmayacak kadar düşük kalsın.";
    case "Regime":
      return "Piyasa chop/news spike değil, setup modeline uygun rejimde olsun.";
    case "Event Risk":
      return "Yakında kırmızı haber varsa sakinleşene kadar bekle.";
    case "Data Confidence":
      return "Veri güveni yeterli olsun; demo/stale veriyle READY alma.";
    case "HTF Alignment":
      return `Üst zaman yönü de ${direction} tarafa baksın.`;
    default:
      return null;
  }
}

function simplePlanWarning(warning: string): string | null {
  const lower = warning.toLowerCase();
  if (lower.includes("spread") || lower.includes("slippage") || lower.includes("friction")) {
    return "Spread/slippage yüzünden plan zayıflıyor.";
  }
  if (lower.includes("rr") || lower.includes("risk reward")) {
    return "Kazanç mesafesi stop riskine göre yetmiyor.";
  }
  if (lower.includes("entry map yok") || lower.includes("fallback")) {
    return "Giriş yeri net değil; daha temiz bir giriş bekle.";
  }
  if (lower.includes("retest")) {
    return "Fiyat giriş alanına tekrar dokunsun.";
  }
  if (lower.includes("mss") || lower.includes("cisd") || lower.includes("confirmation")) {
    return "Yön değişimi mum kapanışıyla onaylansın.";
  }
  if (lower.includes("stop") && lower.includes("çok yakın")) {
    return "Stop girişe çok yakın; daha güvenli stop mesafesi beklenmeli.";
  }
  if (lower.includes("ready değil")) {
    return "Plan hâlâ hazır değil; onay bekle.";
  }
  return null;
}

function stopSourceText(signal: TradingSignal) {
  if (signal.plan.stopSource === "sweep") return signal.direction === "short" ? "sweep high üstü" : "sweep low altı";
  if (signal.plan.stopSource === "fvg") return signal.direction === "short" ? "FVG üstü" : "FVG altı";
  if (signal.plan.stopSource === "swing") return signal.direction === "short" ? "swing high üstü" : "swing low altı";
  return "volatility floor";
}

export function waitingRequirements(signal: TradingSignal): string[] {
  return waitingRequirementsForMinimumRR(signal, 1.5);
}

export function waitingRequirementsForMinimumRR(signal: TradingSignal, minimumRR: number): string[] {
  if (signal.stage === "ready") return ["Plan hazır: giriş, stop ve hedef belli."];
  if (signal.stage === "invalidated") return ["Bu fikir bozuldu. Kovalamadan yeni setup bekle."];
  if (signal.stage === "missed") {
    const entryMissed = signal.plan.planWarnings.find((warning) => warning.includes("Entry kaçtı"));
    return [entryMissed ?? "Fiyat hedefe gitmiş veya entry kaçmış. Geç kalındı, yeni giriş bekle."];
  }
  const context = signal.context;
  const direction = signal.direction;
  const simpleDirection = simpleDirectionText(signal);
  const needs: string[] = [];
  const closeRequirement = closeConfirmationRequirement(signal);
  const retestRequirement = entryRetestRequirement(signal);
  const failedChecklist = signal.decisionSummary.checklist.filter((item) => item.status === "fail");
  const neutralChecklist = signal.decisionSummary.checklist.filter((item) => item.status === "neutral");
  if (signal.plan.entryStatus !== "confirmed") {
    if (retestRequirement) needs.push(retestRequirement);
    if (closeRequirement) {
      needs.push(`${closeRequirement.label} kapanmalı. ${closeRequirement.reason}`);
    }
    if (!retestRequirement && !closeRequirement) {
      needs.push("Giriş henüz net değil; temiz kapanış bekle.");
    }
  }
  for (const item of [...failedChecklist, ...neutralChecklist].filter((item) => item.label !== "Entry Model" && item.label !== "MSS").slice(0, 3)) {
    const simple = simpleChecklistText(item.label, signal);
    if (simple) needs.push(simple);
  }
  const pdZone = expectedPdZone(signal);
  const liquiditySide = expectedLiquiditySide(signal);
  const bias = expectedBias(signal);

  if (context.premiumDiscount.zone !== pdZone) {
    needs.push(`${simplePdText(signal)} Şu an doğru bölgede değil.`);
  }
  if (!context.sweeps.some((sweep) => sweep.side === liquiditySide && sweep.reclaimed)) {
    needs.push(simpleSweepText(signal));
  }
  if (!context.displacements.some((item) => item.direction === direction)) {
    needs.push(`Fiyat ${simpleDirection} tarafa güçlü bir mum atsın.`);
  }
  if (!signal.plan.entryModel.cisdConfirmed && !closeRequirement && !context.marketStructureShifts.some((item) => item.direction === direction)) {
    needs.push(`Yön değişimi ${simpleDirection} tarafa mum kapanışıyla netleşsin.`);
  }
  if ((signal.plan.entrySource === "fvg-retest" || signal.plan.entrySource === "ifvg-retest") && !signal.plan.entryModel.fairValueGap) {
    needs.push("Temiz bir giriş boşluğu oluşsun veya korunmuş kalsın.");
  }
  if (signal.plan.entrySource !== "fvg-retest" && signal.plan.entrySource !== "ifvg-retest" && signal.plan.entryStatus !== "confirmed") {
    needs.push("Giriş kapanış/onay modeliyle netleşsin.");
  }
  if (signal.plan.executionCosts.stress !== "off" && signal.plan.grossRR >= minimumRR && signal.plan.rr < minimumRR) {
    needs.push(`Spread/slippage fazla. Kağıt üstünde ${formatR(signal.plan.grossRR)}, gerçek hesapta ${formatR(signal.plan.rr)}.`);
  }
  if (signal.plan.rr < minimumRR) {
    needs.push(`Kazanç mesafesi yetmiyor. En az ${formatR(minimumRR)} lazım, şu an ${formatR(signal.plan.rr)}.`);
  }
  needs.push(...signal.governance.blockers);
  needs.push(...signal.governance.warnings);
  if (signal.actionWindow.status === "expired" || signal.actionWindow.status === "inactive") {
    needs.push(signal.actionWindow.summary);
  }
  if (context.bias.daily !== bias && context.bias.h4 !== bias) {
    needs.push(`Üst zaman yönü de ${simpleDirection} tarafa dönsün.`);
  }
  if (!isCryptoSymbol(signal.symbol) && context.killzones.every((zone) => !zone.active || zone.name === "Outside")) {
    needs.push("Doğru saat gelsin: London veya New York zamanı.");
  }
  needs.push(...signal.plan.planWarnings.map(simplePlanWarning).filter((warning): warning is string => Boolean(warning)));

  return Array.from(new Set(needs)).slice(0, 9);
}

function DataHealthPanel({ report }: { report: DataHealthReport }) {
  const newestIssues = report.issues.slice(0, 4);
  return (
    <article className={`panel data-health-panel ${report.status}`}>
      <header className="panel-head">
        <div>
          <span className="eyebrow">Data doğruluk</span>
          <h2>{report.status === "ok" ? "Veri temiz" : report.status === "warning" ? "Veri uyarılı" : "Fallback / riskli"}</h2>
        </div>
        <span className="badge">{report.source}</span>
      </header>
      <div className="data-health-grid">
        {report.rows.map((row) => (
          <div key={row.symbol}>
            <strong>{row.symbol}</strong>
            <span>
              {row.source} · {row.feedMode} · exec lag {Number.isFinite(row.executionLagMinutes) ? `${row.executionLagMinutes} dk` : "yok"} · HTF yaş {Number.isFinite(row.htfAgeMinutes) ? `${row.htfAgeMinutes} dk` : "yok"} · 1D yaş {Number.isFinite(row.dailyAgeMinutes) ? `${row.dailyAgeMinutes} dk` : "yok"}
            </span>
            <small>5m {row.counts.m5} · 15m {row.counts.m15} · 1h {row.counts.h1} · 4h {row.counts.h4} · 1D {row.counts.daily}</small>
          </div>
        ))}
      </div>
      {newestIssues.length > 0 && <p className="muted-note">{newestIssues.join(" · ")}</p>}
    </article>
  );
}

export function ScannerView({
  marketCount,
  signals,
  inactiveSignals,
  rejectedSetups,
  selectedSignalId,
  lastScanTime,
  dataSource,
  dataLoading,
  dataErrors,
  dataHealth,
  minimumRR,
  onScan,
  onSelectSignal
}: {
  marketCount: number;
  signals: TradingSignal[];
  inactiveSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  selectedSignalId: string | null;
  lastScanTime: number;
  dataSource: MarketDataSource;
  dataLoading: boolean;
  dataErrors: string[];
  dataHealth: DataHealthReport;
  minimumRR: number;
  onScan: () => void;
  onSelectSignal: (signal: TradingSignal) => void;
}) {
  const sortedSignals = dataLoading ? [] : sortForAction(signals);
  const best = sortedSignals.find((signal) => signal.stage === "ready" || signal.stage === "watch");
  const latestInactive = inactiveSignals[0];
  const readySignals = signals.filter((signal) => signal.stage === "ready");
  const actionState = dataLoading
    ? "loading"
    : !best
      ? "empty"
      : best.stage === "ready"
        ? "tradeable"
        : "watch";
  const actionIcon = actionState === "tradeable" ? <CircleCheck size={20} /> : actionState === "watch" || actionState === "loading" ? <Clock3 size={20} /> : <CircleAlert size={20} />;
  const actionTitle =
    actionState === "loading"
      ? "Veri yükleniyor"
      : actionState === "tradeable"
        ? "İşlem adayı var"
        : actionState === "watch"
          ? "Şu an alınacak trade yok"
          : "Trade yok";
  const actionReason = best
    ? best.stage === "ready"
      ? best.decisionSummary.shortSummary
      : signalDecisionReason(best)
      : latestInactive?.stage === "invalidated"
        ? "Son görünen setup stop/invalidation gördü; yeni setup bekleniyor."
      : latestInactive?.stage === "missed"
        ? signalDecisionReason(latestInactive)
        : "Kurallara göre görünür aday çıkmadı.";
  const bestRequirements = best ? waitingRequirementsForMinimumRR(best, minimumRR) : [];
  const dataLabel = dataLoading
    ? "Yükleniyor"
    : dataSource === "yahoo-live"
      ? "Yahoo live"
      : dataSource === "mixed"
        ? "Live + fallback"
        : "Demo fallback";
  return (
    <section className="view-grid">
      <article className="panel hero-panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">Scanner</span>
            <h2>Tüm market KOD taraması</h2>
          </div>
          <button className="primary-btn" onClick={onScan} type="button" disabled={dataLoading}>
            <Play size={16} /> {dataLoading ? "Veri yükleniyor" : "Tümünü tara"}
          </button>
        </header>
        <div className="scan-summary">
          <div><span>Son tarama</span><strong>{new Date(lastScanTime).toLocaleTimeString()}</strong></div>
          <div><span>Market</span><strong>{marketCount}</strong></div>
          <div><span>Veri</span><strong>{dataLabel}</strong></div>
          <div><span>Sinyal</span><strong>{signals.length} / {readySignals.length} ready</strong></div>
          <div><span>Geçmiş</span><strong>{inactiveSignals.length}</strong></div>
        </div>
        {dataErrors.length > 0 && (
          <div className={`provider-warning ${dataSource}`}>
            <strong>Veri uyarısı</strong>
            {dataErrors.slice(0, 4).map((error) => <span key={error}>{error}</span>)}
          </div>
        )}
        {(best ?? latestInactive) && (
          <div className={`decision-strip ${(best ?? latestInactive)?.stage}`}>
            <strong>{best ? signalDecisionLabel(best) : "GEÇMİŞ"} · {(best ?? latestInactive)?.direction.toUpperCase()} {(best ?? latestInactive)?.stage.toUpperCase()}</strong>
            <span>
              {best
                ? `Entry ${formatPrice(best.plan.entry)} · SL ${formatPrice(best.plan.stopLoss)} · Net RR ${formatR(best.plan.rr)} · Stop ${stopSourceText(best)}`
                : "Aktif trade adayı değil; stop/missed durumunda yeni setup beklenir."}
            </span>
          </div>
        )}
      </article>
      <DataHealthPanel report={dataHealth} />
      <article className={`panel trade-now-panel ${actionState}`}>
        <header className="trade-now-head">
          <span>{actionIcon}</span>
          <div>
            <span className="eyebrow">Tek bakış</span>
            <h2>{actionTitle}</h2>
          </div>
        </header>
        {best ? (
          <>
            <div className="trade-now-main">
              <strong>{best.symbol} · {best.direction.toUpperCase()}</strong>
              <span>{signalDecisionLabel(best)} · {best.stage.toUpperCase()} · {best.grade} · Score {best.score}</span>
            </div>
            <div className="trade-plan-grid">
              <div><span>Entry</span><strong>{formatPrice(best.plan.entry)}</strong></div>
              <div><span>Entry model</span><strong>{best.plan.entrySource}</strong></div>
              <div><span>SL</span><strong>{formatPrice(best.plan.stopLoss)}</strong></div>
              <div><span>TP1</span><strong>{formatPrice(best.plan.targets[0])}</strong></div>
              <div><span>Net RR</span><strong>{formatR(best.plan.rr)}</strong></div>
              <div><span>Gross RR</span><strong>{formatR(best.plan.grossRR)}</strong></div>
              <div><span>Friction</span><strong>{best.plan.executionCosts.stress === "off" ? "kapalı" : formatPrice(best.plan.executionCosts.total)}</strong></div>
              <div><span>Stop nedeni</span><strong>{stopSourceText(best)}</strong></div>
              <div><span>Risk</span><strong>{formatPrice(best.plan.riskDistance)}</strong></div>
              <div><span>Rejim</span><strong>{best.context.regime.type}</strong></div>
              <div><span>Veri güveni</span><strong>{best.context.dataConfidence.grade} · {best.context.dataConfidence.score}</strong></div>
              <div><span>Event</span><strong>{best.context.eventRisk.level}</strong></div>
              <div><span>Window</span><strong>{best.actionWindow.status}</strong></div>
              <div><span>Replay</span><strong>{best.outcome.status}</strong></div>
              <div><span>Governance</span><strong>{best.governance.status}</strong></div>
            </div>
            <p className="trade-now-reason">{actionReason}</p>
            {(best.governance.blockers.length > 0 || best.governance.warnings.length > 0) && (
              <div className="requirements-box governance-box">
                <strong>Risk masası notu</strong>
                <ul>
                  {[...best.governance.blockers, ...best.governance.warnings].slice(0, 5).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {best.stage !== "ready" && bestRequirements.length > 0 && (
              <div className="requirements-box">
                <strong>READY için ne olmalı?</strong>
                <ul>
                  {bestRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
                </ul>
              </div>
            )}
            <button className="ghost-btn trade-now-button" onClick={() => onSelectSignal(best)} type="button">
              Chartta aç <ArrowRight size={16} />
            </button>
          </>
        ) : (
          <p className="trade-now-reason">{dataLoading ? "Canlı veriler geldikten sonra en iyi aday burada görünecek." : actionReason}</p>
        )}
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Bulunan sinyaller</h2><span className="badge">{signals.length}</span></header>
        <div className="scan-signal-list">
          {signals.map((signal) => (
            <button
              className={selectedSignalId === signal.id ? "scan-signal-card selected" : "scan-signal-card"}
              key={signal.id}
              onClick={() => onSelectSignal(signal)}
              type="button"
            >
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol} {signal.direction.toUpperCase()}</strong>
              <b>{signal.grade} · {signal.score}</b>
              <small>{signalDecisionLabel(signal)} · {signal.stage.toUpperCase()} · Entry {formatPrice(signal.plan.entry)} · Net RR {formatR(signal.plan.rr)}</small>
              {signal.stage !== "ready" && (
                <em>Ne olmalı? {waitingRequirementsForMinimumRR(signal, minimumRR).slice(0, 2).join(" · ") || "Daha temiz confirmation bekleniyor."}</em>
              )}
            </button>
          ))}
          {!signals.length && <p className="muted-note">Mevcut runtime kurallarına uyan görünür sinyal yok.</p>}
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Geçmiş / bozulmuş setup</h2><span className="badge">{inactiveSignals.length}</span></header>
        <div className="scan-signal-list">
          {inactiveSignals.slice(0, 8).map((signal) => (
            <button className="scan-signal-card inactive" key={signal.id} onClick={() => onSelectSignal(signal)} type="button">
              <span className={`status-dot ${signal.stage}`} />
              <strong>{signal.symbol} {signal.direction.toUpperCase()}</strong>
              <b>{signal.stage.toUpperCase()}</b>
              <small>{signalDecisionReason(signal)}</small>
              <em>Entry {formatPrice(signal.plan.entry)} · SL {formatPrice(signal.plan.stopLoss)} · TP1 {formatPrice(signal.plan.targets[0])}</em>
            </button>
          ))}
          {!inactiveSignals.length && <p className="muted-note">Stop olmuş veya missed setup yok.</p>}
        </div>
      </article>
      <article className="panel wide">
        <header className="panel-head"><h2>Elendi / düşük kalite</h2><span className="badge">{rejectedSetups.length}</span></header>
        <div className="list-stack">
          {rejectedSetups.slice(0, 8).map((item) => (
            <div className="row-item" key={`${item.symbol}-${item.reason}`}>
              <strong>{item.symbol}</strong>
              <span>{item.reason}</span>
              <b>{item.score}</b>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
