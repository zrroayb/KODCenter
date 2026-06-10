const state = {
  lastLogId: 0,
  busy: false,
  journalFilter: "review",
  journalSymbol: "",
  journalOutcome: "",
  activeView: "signals",
  selectedAlertKey: null,
  selectedJournalKey: null,
  modalOpen: false,
  journalModalOpen: false,
  chartLightboxOpen: false,
  lastModalChartFingerprint: null,
  lastJournalChartFingerprint: null,
  alertsCache: [],
  journalCache: [],
  journalStats: null,
  journalRowsHtml: "",
  scanInProgress: false,
  engineRunning: false,
  lastStatus: null,
  replayRunning: false,
  deskLoading: false,
  deskCache: [],
  deskPayload: null,
  deskSymbol: "",
  deskSessionSymbol: "",
  cloudReadOnly: false,
  cloudBootstrapped: false,
};

const chartSvgCache = new Map();

const els = {
  bootError: document.querySelector("#boot-error"),
  scanBanner: document.querySelector("#scan-banner"),
  scanBannerDetail: document.querySelector("#scan-banner-detail"),
  runtimeLine: document.querySelector("#runtime-line"),
  botState: document.querySelector("#bot-state"),
  lastScan: document.querySelector("#last-scan"),
  alertsCount: document.querySelector("#alerts-count"),
  journalCount: document.querySelector("#journal-count"),
  journalPendingLabel: document.querySelector("#journal-pending-label"),
  journalWinRate: document.querySelector("#journal-win-rate"),
  journalRTotal: document.querySelector("#journal-r-total"),
  journalPendingCount: document.querySelector("#journal-pending-count"),
  journalSkippedCount: document.querySelector("#journal-skipped-count"),
  journalTakenCount: document.querySelector("#journal-taken-count"),
  journalOpenCount: document.querySelector("#journal-open-count"),
  journalClosedCount: document.querySelector("#journal-closed-count"),
  journalEfficiencyRate: document.querySelector("#journal-efficiency-rate"),
  journalRunningR: document.querySelector("#journal-running-r"),
  journalAvgR: document.querySelector("#journal-avg-r"),
  journalAvgPnl: document.querySelector("#journal-avg-pnl"),
  journalReviewWin: document.querySelector("#journal-review-win"),
  journalReviewPanel: document.querySelector("#journal-review-panel"),
  journalEdgeBody: document.querySelector("#journal-edge-body"),
  dryRun: document.querySelector("#dry-run"),
  terminalNextScan: document.querySelector("#terminal-next-scan"),
  terminalSymbols: document.querySelector("#terminal-symbols"),
  terminalApiState: document.querySelector("#terminal-api-state"),
  terminalPoll: document.querySelector("#terminal-poll"),
  pollChip: document.querySelector("#poll-chip"),
  exchangeChip: document.querySelector("#exchange-chip"),
  apiState: document.querySelector("#api-state"),
  activityChip: document.querySelector("#activity-chip"),
  activityCurrent: document.querySelector("#activity-current"),
  activityFeed: document.querySelector("#activity-feed"),
  tickerStrip: document.querySelector("#ticker-strip"),
  headerTicker: document.querySelector("#header-ticker"),
  blotterBody: document.querySelector("#blotter-body"),
  blotterEmpty: document.querySelector("#blotter-empty"),
  alertModal: document.querySelector("#alert-modal"),
  modalTitle: document.querySelector("#modal-title"),
  modalSubtitle: document.querySelector("#modal-subtitle"),
  modalDetail: document.querySelector("#modal-detail"),
  modalFooter: document.querySelector("#modal-footer"),
  modalContextPane: document.querySelector("#modal-context-pane"),
  modalTriggerPane: document.querySelector("#modal-trigger-pane"),
  modalContextLabel: document.querySelector("#modal-context-label"),
  modalTriggerLabel: document.querySelector("#modal-trigger-label"),
  modalShotContext: document.querySelector("#modal-shot-context"),
  modalShotTrigger: document.querySelector("#modal-shot-trigger"),
  modalDownloadContext: document.querySelector("#modal-download-context"),
  modalDownloadTrigger: document.querySelector("#modal-download-trigger"),
  symbols: document.querySelector("#symbols"),
  setups: document.querySelector("#setups"),
  configPath: document.querySelector("#config-path"),
  statePath: document.querySelector("#state-path"),
  journalPath: document.querySelector("#journal-path"),
  envPath: document.querySelector("#env-path"),
  journalBody: document.querySelector("#journal-body"),
  journalEmpty: document.querySelector("#journal-empty"),
  journalModal: document.querySelector("#journal-modal"),
  jmTitle: document.querySelector("#jm-title"),
  jmSubtitle: document.querySelector("#jm-subtitle"),
  jmDetail: document.querySelector("#jm-detail"),
  jmFooter: document.querySelector("#jm-footer"),
  jmContextPane: document.querySelector("#jm-context-pane"),
  jmTriggerLabel: document.querySelector("#jm-trigger-label"),
  jmContextLabel: document.querySelector("#jm-context-label"),
  jmShotContext: document.querySelector("#jm-shot-context"),
  jmShotTrigger: document.querySelector("#jm-shot-trigger"),
  chartLightbox: document.querySelector("#chart-lightbox"),
  chartLightboxTitle: document.querySelector("#chart-lightbox-title"),
  chartLightboxCanvas: document.querySelector("#chart-lightbox-canvas"),
  logs: document.querySelector("#logs"),
  lastAlertChip: document.querySelector("#last-alert-chip"),
  logChip: document.querySelector("#log-chip"),
  journalChip: document.querySelector("#journal-chip"),
  toast: document.querySelector("#toast"),
  startBtn: document.querySelector("#start-btn"),
  stopBtn: document.querySelector("#stop-btn"),
  scanBtn: document.querySelector("#scan-btn"),
  utcClock: document.querySelector("#utc-clock"),
  navItems: document.querySelectorAll(".nav-btn"),
  views: document.querySelectorAll(".view"),
  journalFilters: document.querySelectorAll(".chip-btn[data-filter]"),
  journalSymbolFilter: document.querySelector("#journal-symbol-filter"),
  journalOutcomeFilter: document.querySelector("#journal-outcome-filter"),
  journalSummary: document.querySelector("#journal-summary"),
  journalEmptyHint: document.querySelector("#journal-empty-hint"),
  replayBtn: document.querySelector("#replay-btn"),
  replayBars: document.querySelector("#replay-bars"),
  replayResults: document.querySelector("#replay-results"),
  deskFeed: document.querySelector("#desk-feed"),
  deskEmpty: document.querySelector("#desk-empty"),
  deskSummary: document.querySelector("#desk-summary"),
  deskRefreshBtn: document.querySelector("#desk-refresh-btn"),
  deskMarketTabs: document.querySelector("#desk-market-tabs"),
  deskSessions: document.querySelector("#desk-sessions"),
  deskSessionTabs: document.querySelector("#desk-session-tabs"),
};

const ALERT_MODAL_HTML = `
<div id="alert-modal" class="alert-modal hidden" aria-hidden="true" role="dialog" aria-labelledby="modal-title">
  <div class="alert-modal-backdrop" data-close-modal></div>
  <div class="alert-modal-dialog">
    <header class="alert-modal-head">
      <div>
        <h2 id="modal-title">Signal</h2>
        <p id="modal-subtitle" class="hint">—</p>
      </div>
      <button type="button" class="modal-close-btn" data-close-modal aria-label="Close">✕</button>
    </header>
    <div class="alert-modal-body">
      <div class="modal-screenshots">
        <figure class="screenshot-pane" id="modal-trigger-pane">
          <figcaption class="screenshot-cap">
            <span id="modal-trigger-label">15m · trigger</span>
            <a id="modal-download-trigger" class="btn btn-outline btn-xs" download="chart-15m.svg">SVG</a>
          </figcaption>
          <div class="screenshot-view">
            <div id="modal-shot-trigger" class="screenshot-canvas"></div>
          </div>
        </figure>
        <figure class="screenshot-pane" id="modal-context-pane">
          <figcaption class="screenshot-cap">
            <span id="modal-context-label">4h · context</span>
            <a id="modal-download-context" class="btn btn-outline btn-xs" download="chart-4h.svg">SVG</a>
          </figcaption>
          <div class="screenshot-view">
            <div id="modal-shot-context" class="screenshot-canvas"></div>
          </div>
        </figure>
      </div>
      <div id="modal-detail" class="modal-detail"></div>
    </div>
    <footer id="modal-footer" class="alert-modal-foot"></footer>
  </div>
</div>`;

const CHART_LIGHTBOX_HTML = `
<div id="chart-lightbox" class="chart-lightbox hidden" aria-hidden="true" role="dialog" aria-labelledby="chart-lightbox-title">
  <div class="chart-lightbox-backdrop" data-close-chart-lightbox></div>
  <div class="chart-lightbox-dialog">
    <header class="chart-lightbox-head">
      <strong id="chart-lightbox-title">Chart</strong>
      <button type="button" class="modal-close-btn" data-close-chart-lightbox aria-label="Close">✕</button>
    </header>
    <div id="chart-lightbox-canvas" class="chart-lightbox-canvas"></div>
  </div>
</div>`;

function bindModalElements() {
  els.alertModal = document.querySelector("#alert-modal");
  els.modalTitle = document.querySelector("#modal-title");
  els.modalSubtitle = document.querySelector("#modal-subtitle");
  els.modalDetail = document.querySelector("#modal-detail");
  els.modalFooter = document.querySelector("#modal-footer");
  els.modalTriggerPane = document.querySelector("#modal-trigger-pane");
  els.modalContextPane = document.querySelector("#modal-context-pane");
  els.modalContextLabel = document.querySelector("#modal-context-label");
  els.modalTriggerLabel = document.querySelector("#modal-trigger-label");
  els.modalShotContext = document.querySelector("#modal-shot-context");
  els.modalShotTrigger = document.querySelector("#modal-shot-trigger");
  els.modalDownloadContext = document.querySelector("#modal-download-context");
  els.modalDownloadTrigger = document.querySelector("#modal-download-trigger");
}

function ensureAlertModal() {
  if (!document.querySelector("#alert-modal")) {
    document.body.insertAdjacentHTML("beforeend", ALERT_MODAL_HTML);
  }
  bindModalElements();
}

function bindChartLightboxElements() {
  els.chartLightbox = document.querySelector("#chart-lightbox");
  els.chartLightboxTitle = document.querySelector("#chart-lightbox-title");
  els.chartLightboxCanvas = document.querySelector("#chart-lightbox-canvas");
}

function ensureChartLightbox() {
  if (!document.querySelector("#chart-lightbox")) {
    document.body.insertAdjacentHTML("beforeend", CHART_LIGHTBOX_HTML);
  }
  bindChartLightboxElements();
}

function findAlertFromRow(row) {
  if (!row) return null;
  const alertKey = row.dataset.alertKey || "";
  if (alertKey) {
    const byKey = state.alertsCache.find((a) => a.alert_key === alertKey);
    if (byKey) return byKey;
  }
  const rows = Array.from(row.parentElement?.querySelectorAll("[data-select='1']") || []);
  const index = rows.indexOf(row);
  if (index >= 0 && state.alertsCache[index]) return state.alertsCache[index];
  return null;
}

const STAGE_LABELS = {
  forming: "Watchlist",
  confirmed: "Plan",
  invalidated: "Dead",
  alert: "Alert",
};

const JOURNAL_LABELS = { pending: "Wait", taken: "Taken", skipped: "Skip" };
const OUTCOME_LABELS = {
  none: "—",
  open: "Open",
  win: "Win",
  loss: "Loss",
  breakeven: "Breakeven",
};

const PHASE_LABELS = {
  idle: "Idle",
  strategy: "Strategy",
  data: "Data",
  signal: "Signal",
  no_signal: "No signal",
  scan_complete: "Complete",
  scan_start: "Started",
  error: "Error",
  cooldown: "Cooldown",
};

const EXIT_REASONS = {
  "": "Select...",
  manual: "Manual close",
  stop: "Stop",
  tp1: "TP1",
  tp2: "TP2",
  target: "Final target",
  breakeven: "Breakeven",
  cancelled: "Cancelled",
  other: "Other",
};

const MARKET_PROXY_LABELS = {
  "EUR/USDT": { label: "EUR proxy", note: "Binance EUR/USDT · not EURUSD" },
  "GBP/USDT": { label: "GBP proxy", note: "Binance GBP/USDT · not GBPUSD" },
  "PAXG/USDT": { label: "Gold proxy", note: "PAXG/USDT · not XAUUSD" },
  "EUR/USD": { label: "EUR/USD", note: "Kraken EUR/USD" },
  "GBP/USD": { label: "GBP/USD", note: "Kraken GBP/USD" },
  "PAXG/USD": { label: "Gold proxy", note: "PAXG/USD · not spot XAUUSD" },
  "NAS100": { label: "NAS100", note: "Yahoo NQ futures · NQ=F" },
};

function setBootError(message) {
  if (!els.bootError) return;
  if (!message) {
    els.bootError.classList.add("hidden");
    els.bootError.textContent = "";
    return;
  }
  els.bootError.textContent = message;
  els.bootError.classList.remove("hidden");
}

function fmtTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtLogTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toTimeString().slice(0, 8);
}

function fmtNum(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function fmtRr(ratio) {
  if (ratio == null || Number.isNaN(Number(ratio))) return "—";
  return `1:${Number(ratio).toFixed(2)}`;
}

function targetSourceLabel(source) {
  const labels = {
    internal_liquidity: "liquidity",
    fvg: "FVG",
    ifvg: "iFVG",
    range: "range",
    midpoint: "mid",
  };
  return labels[source] || source;
}

function marketDisplay(symbol) {
  return MARKET_PROXY_LABELS[symbol]?.label || symbol || "—";
}

function marketProxyNote(symbol) {
  return MARKET_PROXY_LABELS[symbol]?.note || "";
}

function marketSymbolHtml(symbol, strongClass = "signal-symbol") {
  const note = marketProxyNote(symbol);
  return `
    <strong class="${escapeHtml(strongClass)}">${escapeHtml(marketDisplay(symbol))}</strong>
    ${note ? `<span class="market-proxy-note">${escapeHtml(note)}</span>` : ""}`;
}

function fmtR(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || "Alert";
}

function journalLabel(status) {
  return JOURNAL_LABELS[status] || "Wait";
}

function outcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome] || "—";
}

function directionLabel(direction) {
  if (direction === "bullish") return "LONG";
  if (direction === "bearish") return "SHORT";
  return direction || "—";
}

function directionClass(direction) {
  if (direction === "bullish") return "dir-long";
  if (direction === "bearish") return "dir-short";
  return "";
}

function statusClass(status) {
  return `status-${status || "pending"}`;
}

function outcomeClass(outcome) {
  return `outcome-${outcome || "none"}`;
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function tickClock() {
  if (els.utcClock) els.utcClock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function apiSafe(path, options = {}) {
  try {
    return { ok: true, data: await api(path, options) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function setBusy(value) {
  state.busy = value;
  applyControlState(state.lastStatus);
}

function scanElapsedLabel(startedAt) {
  if (!startedAt) return "";
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "";
  const sec = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function applyControlState(status) {
  const scanning = Boolean(status?.scan_in_progress);
  const running = Boolean(status?.running);
  const cloudReadOnly = Boolean(status?.cloud_readonly);
  state.scanInProgress = scanning;
  state.engineRunning = running;
  state.cloudReadOnly = cloudReadOnly;

  document.body.classList.toggle("is-scanning", scanning);
  document.body.classList.toggle("cloud-readonly", cloudReadOnly);

  if (els.scanBanner) els.scanBanner.classList.toggle("hidden", !scanning);
  if (scanning && els.scanBannerDetail) {
    const elapsed = scanElapsedLabel(status?.scan_started_at);
    els.scanBannerDetail.textContent = elapsed
      ? `${elapsed} elapsed · scanner feed is updating live`
      : "Checking setups...";
  }

  const lockActions = state.busy || scanning || cloudReadOnly;
  if (els.startBtn) {
    els.startBtn.disabled = lockActions || running;
    els.startBtn.classList.toggle("disabled", lockActions || running);
  }
  if (els.scanBtn) {
    els.scanBtn.disabled = lockActions;
    els.scanBtn.classList.toggle("disabled", lockActions);
    els.scanBtn.textContent = scanning ? "Scanning" : "Scan";
  }
  if (els.stopBtn) {
    els.stopBtn.disabled = state.busy || !running;
    els.stopBtn.classList.toggle("disabled", state.busy || !running);
  }

  document.querySelectorAll(".quick-scan").forEach((btn) => {
    btn.disabled = lockActions;
    btn.classList.toggle("disabled", lockActions);
    btn.textContent = cloudReadOnly ? "Desk only" : scanning ? "Scanning" : "Scan";
  });
}

async function postAction(path) {
  if (state.busy || state.scanInProgress) {
    showToast("Scan running.");
    return;
  }
  setBusy(true);
  try {
    const result = await api(path, { method: "POST" });
    if (result.ok === false) {
      showToast(result.message || "Rejected.");
      return;
    }
    showToast(result.message || "Done");
    await refreshStatus();
    await refreshActivity();
    if (path.includes("scan") || path.includes("start")) {
      await refreshLiveDuringScan();
    } else {
    await refreshAll();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

const chartRuntime = {
  journal: { chart: null, series: null, key: null, observer: null },
};

function chartKey(meta) {
  return `${meta.symbol}|${meta.timeframe}|${meta.atMs || 0}`;
}

function destroyChart(slot) {
  const state = chartRuntime[slot];
  if (!state) return;
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
  if (state.chart) {
    state.chart.remove();
    state.chart = null;
    state.series = null;
    state.key = null;
  }
}

function destroyModalCharts() {
  for (const el of [els.modalShotContext, els.modalShotTrigger]) {
    if (el) {
      delete el.dataset.chartUrl;
      delete el.dataset.loadingUrl;
      el.innerHTML = "";
    }
  }
}

function chartImageUrl(alert, timeframe, role) {
  const params = new URLSearchParams({
    symbol: alert.symbol,
    timeframe,
    limit: String(chartLimitForTimeframe(timeframe)),
    snapshot: "1",
  });
  const atMs = chartAtMsForRole(alert, role);
  if (atMs) params.set("at", String(atMs));
  if (role) params.set("role", role);
  if (alert.stage) params.set("stage", alert.stage);
  if (alert.direction) params.set("direction", alert.direction);
  const plan = alert.trade_plan || {};
  const levelKeys = role === "context" ? [] : ["entry", "stop", "tp1", "tp2", "final_target"];
  for (const key of levelKeys) {
    if (plan[key] != null) params.set(key, String(plan[key]));
  }
  const annotations = chartAnnotationsFromAlert(alert, role);
  for (const [key, value] of Object.entries(annotations)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return `/api/chart/png?${params.toString()}`;
}

function chartAnnotationsFromAlert(alert, role) {
  const plan = alert?.trade_plan || {};
  const details = normalizeDetailLines(alert?.details || [], alert || {});
  const side = directionLabel(alert?.direction);
  const stage = alert?.stage || "";
  const contextTf = alert?.context_timeframe || "";
  const triggerTf = alert?.trigger_timeframe || alert?.timeframe || "trigger";
  const refSide = alert?.direction === "bearish" ? "high" : "low";
  const reclaimSide = alert?.direction === "bearish" ? "below" : "above";
  const targetSide = alert?.direction === "bearish" ? "below" : "above";
  const triggerMode =
    plan.trigger_mode ||
    (String(alert?.profile_name || "").toLowerCase() === "swing" ||
    (String(alert?.context_timeframe || "").toLowerCase() === "1d" && String(alert?.trigger_timeframe || "").toLowerCase() === "1h")
      ? "mss"
      : "");
  const isMsb = triggerMode === "mss" || triggerMode === "msb";
  const isModel1 = triggerMode === "model1";
  const isRaid = triggerMode === "model1_or_mss" || triggerMode === "raid_msb_or_fvg";
  const isFvgTrigger = triggerMode === "fvg" || triggerMode === "ifvg";
  const referenceFromDetails = detailPrice(details, [
    /^Reference level:\s*([0-9.,]+)/i,
    /^Trigger reference:.*?prior\s+\d+-bar\s+(?:low|high)\s+([0-9.,]+)/i,
    /^MSS level:.*?([0-9][0-9.,]*)/i,
    /^MSB level:.*?([0-9][0-9.,]*)/i,
  ]);
  const sweepFromDetails = detailPrice(details, [/Wick extreme:\s*([0-9.,]+)/i, /Structure stop base:\s*([0-9.,]+)/i]);
  const htfTargetFromDetails = detailPrice(details, [
    /^HTF target:.*?(?:—|-| at )\s*([0-9][0-9.,]*)/i,
    /^Final target:\s*([0-9.,]+)/i,
  ]);
  const confirmation = details.find((line) => String(line).startsWith("Confirmation needed:"));
  const raidMeta = {
    raid_level: firstNumeric(plan.reference_level),
    raid_extreme: firstNumeric(plan.sweep_extreme),
    htf_raid_at_ms: plan.htf_raid_candle?.timestamp_ms || "",
    htf_raid_label: plan.htf_raid_candle?.label || "",
  };
  const structureMeta = {
    msb_level: firstNumeric(plan.msb_level),
    msb_at_ms: plan.msb_timestamp_ms || plan.trigger_level_timestamp_ms || "",
    structure_stop: firstNumeric(plan.structure_stop),
  };
  const zoneMeta = {
    ...zoneAnnotationEntries("trigger_zone", plan.fvg_trigger),
    ...zoneAnnotationEntries("fvg_zone", plan.fvg_zone),
    ...zoneAnnotationEntries("ifvg_zone", plan.ifvg_zone),
    ...zoneAnnotationEntries("opposing_zone", plan.opposing_fvg_zone),
  };

  if (role === "context") {
    return {
      reference_level: null,
      sweep_extreme: null,
      htf_target: firstNumeric(plan.final_target, htfTargetFromDetails),
      ...raidMeta,
      wait_text: `HTF only: narrative + key level + Turtle Soup. Confirm on ${triggerTf} Model #1/MSS.`,
      setup_label: `HTF CONTEXT: ${contextTf || "HTF"} ${side} draw ${targetSide}`,
      trigger_mode: triggerMode,
    };
  }

  const setupLabel =
    stage === "forming"
      ? isRaid
        ? `${triggerTf} CONFIRMATION: wait Model #1/MSS`
        : isModel1
        ? `${triggerTf} CONFIRMATION: wait Model #1`
        : isMsb
        ? `${triggerTf} CONFIRMATION: wait MSS`
        : `${triggerTf} CONFIRMATION: wait ${refSide} reclaim`
      : stage === "confirmed"
        ? isFvgTrigger
          ? `${triggerTf} FVG confluence`
          : isModel1
          ? `${triggerTf} CONFIRMATION: Model #1 confirmed`
          : isMsb
          ? `${triggerTf} CONFIRMATION: MSS confirmed`
          : `${triggerTf} CONFIRMATION: reclaim confirmed`
        : stage === "invalidated"
          ? `INVALIDATED: ${side}`
          : `${side} setup`;

  const triggerWait =
    stage === "confirmed"
      ? isFvgTrigger
        ? `On ${triggerTf}: FVG confluence present.`
        : isModel1
        ? `On ${triggerTf}: Model #1 confirmed.`
        : isMsb
        ? `On ${triggerTf}: MSS close confirmed.`
        : `On ${triggerTf}: reclaim confirmed.`
      : isRaid
        ? `On ${triggerTf}: wait Candle 3 Model #1 or MSS.`
        : isModel1
        ? `On ${triggerTf}: wait Model #1 close.`
        : isMsb
        ? `On ${triggerTf}: wait close ${reclaimSide} MSS level.`
        : `On ${triggerTf}: wait ${refSide} take and close back ${reclaimSide}.`;

  const triggerReference = isRaid
    ? firstNumeric(plan.reference_level, referenceFromDetails)
    : firstNumeric(plan.msb_level, plan.reference_level, role === "trigger" ? referenceFromDetails : referenceFromDetails || plan.entry);
  const triggerExtreme = isRaid
    ? firstNumeric(plan.sweep_extreme, sweepFromDetails)
    : firstNumeric(plan.structure_stop, plan.sweep_extreme, sweepFromDetails);

  return {
    reference_level: triggerReference,
    sweep_extreme: triggerExtreme,
    htf_target: firstNumeric(plan.final_target, htfTargetFromDetails),
    ...raidMeta,
    ...structureMeta,
    ...zoneMeta,
    wait_text: triggerWait || (confirmation ? String(confirmation).slice(0, 160) : ""),
    setup_label: setupLabel,
    trigger_mode: triggerMode,
  };
}

function zoneAnnotationEntries(prefix, zone) {
  if (!zone || zone.low == null || zone.high == null) return {};
  return {
    [`${prefix}_low`]: zone.low,
    [`${prefix}_high`]: zone.high,
    [`${prefix}_kind`]: zone.kind || "",
    [`${prefix}_direction`]: zone.direction || "",
  };
}

function detailPrice(details, patterns) {
  for (const line of details || []) {
    const text = String(line);
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return parseChartNumber(match[1]);
    }
  }
  return null;
}

function parseChartNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function firstNumeric(...values) {
  for (const value of values) {
    const n = parseChartNumber(value);
    if (n != null) return n;
  }
  return null;
}

async function loadChartCanvas(container, url, label, { force = false } = {}) {
  if (!container) return null;
  if (!force && container.dataset.chartUrl === url && container.querySelector("svg")) {
    container.dataset.chartLabel = label;
    prepareExpandableChart(container);
    return container.innerHTML;
  }
  if (!force && chartSvgCache.has(url)) {
    const body = chartSvgCache.get(url);
    container.innerHTML = body;
    container.dataset.chartUrl = url;
    container.dataset.chartLabel = label;
    prepareExpandableChart(container);
    delete container.dataset.loadingUrl;
    return body;
  }
  container.dataset.loadingUrl = url;
  container.innerHTML = `<div class="screenshot-loading">${escapeHtml(label)} loading...</div>`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(body.slice(0, 120) || `HTTP ${res.status}`);
    }
    if (!body.includes("<svg")) {
      throw new Error("Invalid chart response. Restart the web server.");
    }
    chartSvgCache.set(url, body);
    if (container.dataset.loadingUrl !== url) return null;
    container.innerHTML = body;
    container.dataset.chartUrl = url;
    container.dataset.chartLabel = label;
    prepareExpandableChart(container);
    delete container.dataset.loadingUrl;
    return body;
  } catch (error) {
    delete container.dataset.loadingUrl;
    delete container.dataset.chartUrl;
    container.classList.remove("expandable-chart");
    container.removeAttribute("role");
    container.removeAttribute("tabindex");
    container.removeAttribute("aria-label");
    container.innerHTML = `<div class="screenshot-error">${escapeHtml(label)}: ${escapeHtml(error.message)}</div>`;
    return null;
  }
}

function prepareExpandableChart(container) {
  if (!container || !container.querySelector("svg")) return;
  container.classList.add("expandable-chart");
  container.setAttribute("role", "button");
  container.setAttribute("tabindex", "0");
  container.setAttribute("aria-label", `Expand ${container.dataset.chartLabel || "chart"}`);
}

function openChartLightbox(container) {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;
  ensureChartLightbox();
  const paneLabel =
    container.closest(".screenshot-pane")?.querySelector(".screenshot-cap span")?.textContent ||
    container.dataset.chartLabel ||
    "Chart";
  if (els.chartLightboxTitle) els.chartLightboxTitle.textContent = paneLabel;
  if (els.chartLightboxCanvas) els.chartLightboxCanvas.innerHTML = svg.outerHTML;
  state.chartLightboxOpen = true;
  if (els.chartLightbox) {
    els.chartLightbox.classList.remove("hidden");
    els.chartLightbox.setAttribute("aria-hidden", "false");
  }
}

function closeChartLightbox() {
  state.chartLightboxOpen = false;
  if (els.chartLightbox) {
    els.chartLightbox.classList.add("hidden");
    els.chartLightbox.setAttribute("aria-hidden", "true");
  }
  if (els.chartLightboxCanvas) els.chartLightboxCanvas.innerHTML = "";
}

async function setModalImages(alert, { force = false } = {}) {
  const { context, trigger } = resolveAlertTimeframes(alert);
  const sym = (alert.symbol || "chart").replace("/", "-");

  if (els.modalTriggerLabel) els.modalTriggerLabel.textContent = `${trigger} · confirmation`;
  if (els.modalContextLabel) els.modalContextLabel.textContent = `${context} · HTF context`;

  const triggerUrl = chartImageUrl(alert, trigger, "trigger");
  const contextUrl = chartImageUrl(alert, context, "context");

  if (els.modalDownloadTrigger) {
    els.modalDownloadTrigger.href = triggerUrl;
    els.modalDownloadTrigger.download = `${sym}-${trigger}.svg`;
  }
  if (els.modalDownloadContext) {
    els.modalDownloadContext.href = contextUrl;
    els.modalDownloadContext.download = `${sym}-${context}.svg`;
  }

  await Promise.all([
    loadChartCanvas(els.modalShotTrigger, triggerUrl, trigger, { force }),
    loadChartCanvas(els.modalShotContext, contextUrl, context, { force }),
  ]);
}

function resolveAlertTimeframes(alert) {
  const parsed = parseProfileTimeframes(alert);
  const trigger = alert.trigger_timeframe || parsed?.trigger || "15m";
  let context = alert.context_timeframe || parsed?.context || "";
  if (!context || context === trigger) {
    context = alert.timeframe && alert.timeframe !== trigger ? alert.timeframe : (parsed?.context || "4h");
  }
  return { context, trigger };
}

function chartAtMsForRole(alert, role) {
  const candleMs = alert?.candle_timestamp_ms || null;
  const triggerMs = alert?.trigger_candle_timestamp_ms || candleMs;
  if (role === "trigger") return triggerMs;
  return candleMs;
}

function chartFingerprint(alert) {
  if (!alert) return "";
  return JSON.stringify({
    alert_key: alert.alert_key || "",
    candle_timestamp_ms: alert.candle_timestamp_ms,
    trigger_candle_timestamp_ms: alert.trigger_candle_timestamp_ms,
    stage: alert.stage,
    direction: alert.direction,
    trade_plan: alert.trade_plan,
  });
}

function chartLimitForTimeframe(timeframe) {
  const limits = {
    "1m": 120,
    "5m": 100,
    "15m": 80,
    "30m": 64,
    "1h": 72,
    "4h": 36,
    "1d": 28,
    "1w": 16,
  };
  return limits[(timeframe || "").toLowerCase()] || 80;
}

function setChartLoading(host, message) {
  if (!host) return;
  host.classList.add("loading");
  host.textContent = message || "Loading chart...";
}

function clearChartLoading(host) {
  if (!host) return;
  host.classList.remove("loading");
  host.textContent = "";
}

function candleTimeMs(ms) {
  return Math.floor(Number(ms) / 1000);
}

function buildChartLevels(tradePlan, direction) {
  if (!tradePlan) return [];
  const levels = [
    ["Entry", tradePlan.entry, "#22c55e"],
    ["Stop", tradePlan.stop, "#ef4444"],
    ["TP1", tradePlan.tp1, "#3b82f6"],
    ["TP2", tradePlan.tp2, "#60a5fa"],
    ["Final", tradePlan.final_target, "#a78bfa"],
  ];
  return levels.filter(([, price]) => price != null && !Number.isNaN(Number(price)));
}

function applyChartLevels(series, tradePlan) {
  if (!series || !tradePlan) return;
  for (const [title, price, color] of buildChartLevels(tradePlan)) {
    series.createPriceLine({
      price: Number(price),
      color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title,
    });
  }
}

function findSignalMarkerTime(candles, atMs) {
  if (!atMs || !candles?.length) return null;
  let best = candles[0];
  let bestDiff = Math.abs(best.t - atMs);
  for (const candle of candles) {
    const diff = Math.abs(candle.t - atMs);
    if (diff < bestDiff) {
      best = candle;
      bestDiff = diff;
    }
  }
  return candleTimeMs(best.t);
}

async function fetchChartData(symbol, timeframe, atMs, limit = 120) {
  const params = new URLSearchParams({ symbol, timeframe, limit: String(limit) });
  if (atMs) params.set("at", String(atMs));
  const res = await apiSafe(`/api/chart?${params.toString()}`);
  if (!res.ok) throw new Error(res.error || "Chart failed.");
  if (!res.data.ok) throw new Error(res.data.error || "Chart failed.");
  return res.data;
}

function renderChartTabs(tabsEl, views, activeTf, onSelect) {
  if (!tabsEl) return;
  if (views.length <= 1) {
    tabsEl.innerHTML = views.length
      ? `<span class="badge">${escapeHtml(views[0].label)}</span>`
      : "";
    return;
  }
  tabsEl.innerHTML = views
    .map(
      (view) =>
        `<button type="button" class="chart-tab ${view.timeframe === activeTf ? "active" : ""}" data-timeframe="${escapeHtml(view.timeframe)}">${escapeHtml(view.label)}</button>`,
    )
    .join("");
  tabsEl.querySelectorAll(".chart-tab").forEach((btn) => {
    btn.addEventListener("click", () => onSelect(btn.dataset.timeframe));
  });
}

async function paintChartInHost(slot, host, meta, timeframe, options = {}) {
  if (!host || !meta?.symbol || !timeframe) {
    destroyChart(slot);
    return null;
  }

  const height = options.height ?? 320;
  const drawKey = chartKey({ ...meta, timeframe });
  const runtime = chartRuntime[slot];
  if (!runtime) return null;

  if (runtime.key === drawKey && runtime.chart) {
    runtime.chart.applyOptions({ width: host.clientWidth || host.offsetWidth || 400 });
    return runtime.chart;
  }

  destroyChart(slot);
  runtime.key = drawKey;
    setChartLoading(host, "Loading...");

  try {
    const payload = await fetchChartData(meta.symbol, timeframe, meta.atMs, options.limit ?? 120);
    clearChartLoading(host);

    if (!window.LightweightCharts) {
      host.textContent = "Chart failed.";
      return null;
    }

    const width = host.clientWidth || host.offsetWidth || 400;
    const chart = window.LightweightCharts.createChart(host, {
      width,
      height,
      layout: {
        background: { color: "#0a0c0f" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: { borderColor: "#374151", timeVisible: true, secondsVisible: false },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const data = (payload.candles || []).map((c) => ({
      time: candleTimeMs(c.t),
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    series.setData(data);
    applyChartLevels(series, meta.tradePlan);

    const markerTime = findSignalMarkerTime(payload.candles, meta.atMs);
    if (markerTime != null) {
      const bullish = meta.direction === "bullish";
      series.setMarkers([
        {
          time: markerTime,
          position: bullish ? "belowBar" : "aboveBar",
          color: bullish ? "#22c55e" : "#ef4444",
          shape: bullish ? "arrowUp" : "arrowDown",
          text: "Signal",
        },
      ]);
    }

    if (options.focusSignal && data.length > 8) {
      let markerIndex = markerTime != null ? data.findIndex((d) => d.time === markerTime) : -1;
      if (markerIndex < 0) markerIndex = data.length - 1;
      const padBefore = options.padBefore ?? 16;
      const padAfter = options.padAfter ?? 6;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, markerIndex - padBefore),
        to: Math.min(data.length - 1, markerIndex + padAfter),
      });
    } else {
      chart.timeScale().fitContent();
    }
    runtime.chart = chart;
    runtime.series = series;

    runtime.observer = new ResizeObserver(() => {
      if (runtime.chart) {
        runtime.chart.applyOptions({ width: host.clientWidth || host.offsetWidth || 400 });
      }
    });
    runtime.observer.observe(host);

    return chart;
  } catch (error) {
    clearChartLoading(host);
    host.textContent = error.message;
    return null;
  }
}

async function paintTradeChart(slot, meta) {
  const isJournal = slot === "journal";
  const section = isJournal ? els.journalChartSection : null;
  const host = isJournal ? els.journalChartHost : null;
  const tabsEl = isJournal ? els.journalChartTabs : null;
  const captionEl = isJournal ? els.journalChartCaption : null;

  if (!section || !host || !meta?.symbol || !meta?.timeframe) {
    if (section) section.classList.add("hidden");
    destroyChart(slot);
    return;
  }

  const views = [];
  if (meta.contextTimeframe && meta.contextTimeframe !== meta.timeframe) {
    views.push({ timeframe: meta.contextTimeframe, label: `Context (${meta.contextTimeframe})` });
  }
  views.push({ timeframe: meta.timeframe, label: `Trigger (${meta.timeframe})` });

  let activeTf = meta.activeTimeframe || meta.timeframe;
  section.classList.remove("hidden");

  const draw = async (timeframe) => {
    activeTf = timeframe;
    const drawKey = chartKey({ ...meta, timeframe: activeTf });
    if (chartRuntime[slot].key === drawKey && chartRuntime[slot].chart) {
      renderChartTabs(tabsEl, views, activeTf, draw);
      return;
    }

    await paintChartInHost(slot, host, meta, timeframe, { height: 320 });

    if (captionEl) {
      const tfLabel = timeframe === meta.contextTimeframe ? "Context" : "Trigger";
      captionEl.textContent = `${meta.symbol} · ${tfLabel} ${timeframe}`;
    }

    renderChartTabs(tabsEl, views, activeTf, draw);
  };

  await draw(activeTf);
}

function parseProfileTimeframes(alert) {
  for (const line of alert?.details || []) {
    const text = String(line);
    const match = text.match(/(\S+)\s+ana grafik → (\S+)\s+tetik/) || text.match(/(\S+)\s+context -> (\S+)\s+trigger/);
    if (match) return { context: match[1], trigger: match[2] };
  }
  return null;
}

function detailLines(details, predicate) {
  return (details || []).filter(predicate);
}

function normalizeDetailLines(details, alert = {}) {
  return (details || []).map((line) => normalizeLegacyDetailLine(line, alert)).filter(Boolean);
}

function normalizeLegacyDetailLine(line, alert = {}) {
  const text = String(line || "").trim();
  if (!text) return "";

  const direction = alert.direction || "";
  const triggerTf = alert.trigger_timeframe || alert.timeframe || "trigger";
  const refSide = direction === "bearish" ? "high" : "low";
  const closeSide = direction === "bearish" ? "below" : "above";

  if (/^Özet:\s*Erken uyarı/i.test(text)) {
    return "Summary: Early HTF warning only. No trigger confirmation yet; do not enter from this alert.";
  }
  if (/^Özet:\s*Kurulum onaylandı/i.test(text)) {
    return "Summary: Setup confirmed. Use the plan levels; the bot still does not place orders.";
  }
  if (/^Özet:\s*Kurulum geçersiz/i.test(text)) {
    return "Summary: Setup invalidated. The move extended before a valid reclaim.";
  }

  let match = text.match(/^(?:Neden izleniyor\?:\s*)?Kapanmış\s+(\S+)\s+mumu\s+bir önceki\s+(\S+)\s+(dipini|tepesini)\s+\(([^)]+)\)\s+süpürdü\s+\(wick\s+([^)]+)\)/i);
  if (match) {
    const side = match[3].startsWith("dip") ? "low" : "high";
    return `Why watch?: The last closed ${match[1]} candle took the previous ${match[2]} ${side} at ${match[4]} (wick ${match[5]}) and closed back through it. Wait for ${triggerTf} confirmation.`;
  }

  match = text.match(/^Ne oldu\?:\s*Kapanmış\s+(\S+)\s+mumu\s+bir önceki\s+(\S+)\s+mumunun\s+(dip|tepe)\s+seviyesini\s+süpürdü/i);
  if (match) {
    const side = match[3] === "dip" ? "low" : "high";
    return `What happened?: The last closed ${match[1]} candle took the previous ${match[2]} ${side} and closed back inside.`;
  }

  match = text.match(/^Onay için\s+(\S+)\s+grafiğinde\s+20 bar likidite havuzu süpürme \+ geri kazanım gerekli/i);
  if (match) {
    return `Confirmation needed: on ${match[1]}, price must take the prior 20-bar ${refSide} and close back ${closeSide} it.`;
  }

  match = text.match(/^Onay için beklenen:\s*(\S+)\s+grafikte\s+20-bar\s+havuz\s+süpürme \+ geri kazanım/i);
  if (match) {
    return `Confirmation needed: on ${match[1]}, price must take the prior 20-bar ${refSide} and close back ${closeSide} it.`;
  }

  match = text.match(/^HTF durum:\s*(\S+)\s+kapanış\s+([^—-]+)\s+[—-]\s+seviye\s+(üstünde|altında)/i);
  if (match) {
    const side = match[3] === "üstünde" ? "above" : "below";
    return `HTF state: ${match[1]} close ${match[2].trim()} is back ${side} the reference level. This is still not a trade trigger.`;
  }

  match = text.match(/^Tetik grafik:\s*(\S+)\s+son fiyat\s+([^—-]+)\s+[—-]\s+seviye\s+(üstünde|altında)/i);
  if (match) {
    const side = match[3] === "üstünde" ? "above" : "below";
    return `Trigger state: latest ${match[1]} close ${match[2].trim()} is ${side} the reference level. Location only; not confirmation.`;
  }

  match = text.match(/^Likidite havuzu:\s*son\s+(\d+)\s+(\S+)\s+(dip|tepe)\s+([^·]+)(?:·\s*(\d+)\s+bar\s+yaşında)?/i);
  if (match) {
    const side = match[3] === "dip" ? "low" : "high";
    const age = match[5] ? ` - level is ${match[5]} bars old` : "";
    return `Trigger reference: prior ${match[1]}-bar ${side} ${match[4].trim()}${age}`;
  }

  match = text.match(/^Seviye:\s*([^·]+)\s*·\s*Süpürme ucu:\s*(.+)$/i);
  if (match) {
    return `Reference level: ${match[1].trim()} · Wick extreme: ${match[2].trim()}`;
  }

  match = text.match(/^Stop:\s*([^—-]+)\s+[—-]\s+süpürme ucunun\s+(altına|üstüne)/i);
  if (match) {
    const side = match[2] === "altına" ? "below" : "above";
    return `Stop: ${match[1].trim()} - ${side} the wick extreme with ATR buffer`;
  }

  match = text.match(/^Plan giriş:\s*([^(]+)\s+\(reclaim seviyesi\)\s*·\s*Güncel\s+(\S+):\s*(.+)$/i);
  if (match) {
    return `Entry guide: ${match[1].trim()} (reclaim level) · Current ${match[2]}: ${match[3].trim()}`;
  }

  match = text.match(/^Hedef 1:\s*([^—-]+)\s+[—-]\s+bilinçli 1R/i);
  if (match) {
    return `TP1: ${match[1].trim()} - planned 1R`;
  }

  match = text.match(/^RR Hedef 1:\s*([^—-]+)\s+[—-]\s+TP1 bilinçli 1R/i);
  if (match) {
    return `RR TP1: ${match[1].trim()} - TP1 is planned at 1R`;
  }

  if (/^Not:\s*Bot emir vermez/i.test(text)) {
    return "Note: The bot does not place orders; watch only until confirmation.";
  }

  const directPrefixes = [
    [/^Neden LONG\?:/i, "Why LONG?:"],
    [/^Neden SHORT\?:/i, "Why SHORT?:"],
    [/^Neden izleniyor\?:/i, "Why watch?:"],
    [/^Ne oldu\?:/i, "What happened?:"],
    [/^Ana hedef:/i, "HTF target:"],
    [/^Seviye:/i, "Reference level:"],
    [/^Süpürme ucu:/i, "Wick extreme:"],
    [/^Plan giriş:/i, "Entry guide:"],
    [/^Giriş rehberi:/i, "Entry guide:"],
    [/^Giriş:/i, "Entry:"],
    [/^Stop rehberi:/i, "Stop guide:"],
    [/^Hedef 1:/i, "TP1:"],
    [/^Hedef 2:/i, "TP2:"],
    [/^Risk mesafesi:/i, "Risk distance:"],
    [/^RR Hedef 1:/i, "RR TP1:"],
    [/^RR Hedef 2:/i, "RR TP2:"],
    [/^RR Ana hedef:/i, "RR final target:"],
    [/^Yönetim:/i, "Management:"],
    [/^Bekleme:/i, "Cooldown:"],
    [/^Geçersiz:/i, "Invalidation guide:"],
    [/^Sonraki adım:/i, "Next step:"],
    [/^Not:/i, "Note:"],
    [/^Volatilite:/i, "Volatility:"],
    [/^Durum:/i, "State:"],
    [/^Fiyat bölgesi:/i, "Location:"],
    [/^Mum yapısı:/i, "Trigger candle:"],
    [/^Kalite puanı:/i, "Quality score:"],
    [/^Setup notu:/i, "Setup:"],
  ];

  let normalized = text;
  for (const [pattern, replacement] of directPrefixes) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replaceAll("Maybe later — zayıf potansiyel", "Low quality - no trade yet")
    .replaceAll("Maybe later - zayıf potansiyel", "Low quality - no trade yet")
    .replaceAll("Sorun:", "Issue:")
    .replaceAll("yanlış bölge", "location mismatch")
    .replaceAll("long için pahalı", "premium zone for long")
    .replaceAll("short için ucuz", "discount zone for short")
    .replaceAll("zayıf tetik mumu", "weak trigger candle")
    .replaceAll("tetik mumu", "trigger candle")
    .replaceAll("kapanış mumun alt yarısında", "close is in the lower half of the candle")
    .replaceAll("kapanış mumun üst yarısında", "close is in the upper half of the candle")
    .replaceAll("HTF pahalı bölgede", "HTF is in premium")
    .replaceAll("HTF ucuz bölgede", "HTF is in discount")
    .replaceAll("ortanın üstünde", "above midpoint")
    .replaceAll("ortanın altında", "below midpoint")
    .replaceAll("long için geç", "late for long")
    .replaceAll("short için geç", "late for short")
    .replaceAll("indirim beklenirdi", "discount would be cleaner")
    .replaceAll("premium beklenirdi", "premium would be cleaner")
    .replaceAll("eksik", "weak")
    .replaceAll("likidite havuzu", "reference level")
    .replaceAll("havuz", "reference level")
    .replaceAll("süpürme + geri kazanım", "take and reclaim")
    .replaceAll("geri kazanım", "reclaim")
    .replaceAll("süpürme ucunun altına", "below the wick extreme")
    .replaceAll("süpürme ucunun üstüne", "above the wick extreme")
    .replaceAll("süpürme low", "wick low")
    .replaceAll("süpürme high", "wick high")
    .replaceAll("süpürdü", "took")
    .replaceAll("süpürme", "take")
    .replaceAll("ATR tamponu", "ATR buffer")
    .replaceAll("tamponu", "buffer")
    .replaceAll("reclaim seviyesi", "reclaim level")
    .replaceAll("Güncel", "Current")
    .replaceAll("bilinçli 1R", "planned 1R")
    .replaceAll("giriş", "entry")
    .replaceAll("beklenen", "required")
    .replaceAll("bekleniyor", "pending")
    .replaceAll("grafikte", "chart")
    .replaceAll("onayı", "confirmation")
    .replaceAll("confirmed aşaması", "confirmed stage")
    .replaceAll("mumunun", "candle's")
    .replaceAll("mumu", "candle")
    .replaceAll("mum", "candle")
    .replaceAll("önceki", "previous")
    .replaceAll("son fiyat", "latest price")
    .replaceAll("kapanış", "close")
    .replaceAll("üstünde", "above")
    .replaceAll("altında", "below")
    .replaceAll("henüz trade onayı değil", "still not a trade trigger")
    .replaceAll("sadece konum, onay değil", "location only, not confirmation")
    .replaceAll("uygun değil", "weak")
    .replaceAll("UYGUN DEĞİL", "weak")
    .replaceAll("uygun", "passed")
    .replaceAll("pahalı bölge", "premium zone")
    .replaceAll("ucuz bölge", "discount zone")
    .replaceAll("zayıf", "weak")
    .replaceAll("şartlı", "conditional")
    .replaceAll("pas geç", "pass");
}

function formatAlertMeta(alert, status) {
  const parsed = parseProfileTimeframes(alert);
  const tf = parsed
    ? `${parsed.context} → ${parsed.trigger}`
    : [alert.context_timeframe, alert.trigger_timeframe || alert.timeframe].filter(Boolean).join(" → ");
  return [
    directionLabel(alert.direction),
    alert.profile,
    tf,
    fmtTime(alert.time),
    journalLabel(status),
  ].filter(Boolean).join(" · ");
}

function buildAlertStoryHtml(alert) {
  const details = normalizeDetailLines(alert.details || [], alert);
  const parsed = parseProfileTimeframes(alert);
  const triggerTf = alert.trigger_timeframe || parsed?.trigger || alert.timeframe;
  const contextTf = alert.context_timeframe || parsed?.context || "";
  const plan = alert.trade_plan || {};
  const why = findDetail(details, /^(Why|Neden|Summary)/);
  const alignment = findDetail(details, /^YTL \/ HTF Alignment:/);
  const quality = findDetail(details, /^Setup:/);
  const displacement = findDetail(details, /^Displacement:/);
  const targetWarning = findDetail(details, /^Target warning:/);
  const smcItems = institutionalPlanItems(plan, details);
  const scenarioItems = scenarioPlanItems(plan);

  const biasItems = [
    traderBiasText(alignment, alert.direction),
    stripDetailLabel(why),
  ].filter(Boolean);

  const triggerItems = alert.stage === "forming"
    ? [
        `No entry yet.`,
        `Wait for closed ${triggerTf || "trigger"} Candle 3 Model #1 or MSS.`,
      ]
    : alert.stage === "confirmed"
      ? [`Confirmed. Use the plan levels, no auto order.`]
      : [`Invalidated. Stand down.`];

  const planItems = traderPlanItems(plan, alert.stage);
  const qualityItems = [
    stripDetailLabel(quality),
    stripDetailLabel(displacement),
    stripDetailLabel(targetWarning),
  ].filter(Boolean);

  const summary = parseSummary(details);
  const stageBanner =
    alert.stage === "forming"
      ? `<div class="stage-banner forming"><strong>Watchlist</strong><span>No entry yet</span></div>`
      : alert.stage === "confirmed"
        ? `<div class="stage-banner confirmed"><strong>Plan ready</strong><span>Manual execution</span></div>`
        : "";

  const errorBanner = alert.error
    ? `<div class="stage-banner error"><strong>Alert error</strong><span>${escapeHtml(alert.error)}</span></div>`
    : "";

  function storyList(title, items, cls) {
    if (!items.length) return "";
    return `
      <section class="story-box ${cls || ""}">
        <h3>${escapeHtml(title)}</h3>
        <ul>${items.map((line) => {
          const text = String(line);
          const colon = text.indexOf(":");
          const body = colon >= 0 ? text.slice(colon + 1).trim() : text;
          return `<li>${escapeHtml(body)}</li>`;
        }).join("")}</ul>
      </section>`;
  }

  return `
    ${stageBanner}
    ${errorBanner}
    <div class="detail-summary">${escapeHtml(cleanTraderSummary(summary, alert))}</div>
    ${storyList("Bias", biasItems, "why")}
    ${storyList("Trigger", triggerItems, "waiting")}
    ${storyList("Plan", planItems, "plan-text")}
    ${storyList("SMC Map", smcItems, "quality")}
    ${storyList("Scenarios", scenarioItems, "plan-text")}
    ${storyList("Quality", qualityItems, "quality")}
  `;
}

function findDetail(details, pattern) {
  return (details || []).find((line) => pattern.test(String(line))) || "";
}

function stripDetailLabel(line) {
  if (!line) return "";
  const text = String(line);
  const colon = text.indexOf(":");
  return cleanTraderSummary(colon >= 0 ? text.slice(colon + 1).trim() : text);
}

function cleanTraderSummary(text, alert = {}) {
  let cleaned = String(text || "");
  cleaned = cleaned
    .replace("HTF raid happened. No entry yet; wait for", "Candle 2 Turtle Soup done. Waiting for")
    .replace("Context CRT happened. No entry yet; wait for", "Candle 2 Turtle Soup done. Waiting for")
    .replace("Setup confirmed.", "Setup confirmed.")
    .replace("the bot still does not place orders.", "Manual execution only.")
    .replace("YTL", "HTF");
  if (!cleaned && alert.stage === "forming") return "Candle 2 Turtle Soup done. Waiting for Candle 3.";
  if (!cleaned && alert.stage === "confirmed") return "Plan ready. Manage the levels.";
  return cleaned || "Setup";
}

function traderBiasText(alignment, direction) {
  const text = String(alignment || "");
  if (/PASSED/.test(text) && direction === "bullish") return "HTF bias is bullish.";
  if (/PASSED/.test(text) && direction === "bearish") return "HTF bias is bearish.";
  if (/WATCH ONLY/.test(text)) return "Watch only. HTF bias is not clean enough.";
  if (/BLOCKED/.test(text)) return "Blocked. HTF bias conflicts.";
  return "";
}

function traderPlanItems(plan, stage) {
  if (!plan || !Object.keys(plan).length) return [];
  const items = [];
  if (plan.entry != null) items.push(`${stage === "forming" ? "Potential entry" : "Entry"}: ${fmtNum(plan.entry)}`);
  if (plan.stop != null) items.push(`Invalidation: ${fmtNum(plan.stop)}`);
  if (plan.tp1 != null) items.push(`TP1: ${fmtNum(plan.tp1)}${plan.rr_tp1 != null ? ` (${fmtRr(plan.rr_tp1)})` : ""}`);
  if (plan.tp2 != null) items.push(`TP2: ${fmtNum(plan.tp2)}${plan.rr_tp2 != null ? ` (${fmtRr(plan.rr_tp2)})` : ""}`);
  if (plan.final_target != null) items.push(`Final draw: ${fmtNum(plan.final_target)}${plan.rr_final != null ? ` (${fmtRr(plan.rr_final)})` : ""}`);
  if (plan.risk != null) items.push(`Risk width: ${fmtNum(plan.risk)}`);
  return items;
}

function institutionalPlanItems(plan, details = []) {
  const items = [
    stripDetailLabel(findDetail(details, /^Liquidity map:/)),
    stripDetailLabel(findDetail(details, /^Order block:/)),
    stripDetailLabel(findDetail(details, /^Inducement:/)),
    stripDetailLabel(findDetail(details, /^Delivery model:/)),
  ].filter(Boolean);
  const session = plan?.session_context?.name;
  if (session) items.push(`Session: ${session}`);
  const limitation = (plan?.data_limitations || [])[0];
  if (limitation) items.push(`Data: ${limitation}`);
  return items;
}

function scenarioPlanItems(plan) {
  const scenarios = plan?.scenarios || {};
  const primary = scenarios.primary || {};
  const opposite = scenarios.opposite || {};
  const items = [];
  if (primary.name) {
    const targets = (primary.targets || []).map((value) => fmtNum(value)).join(", ");
    items.push(`${primary.name}: ${primary.trigger || "wait for trigger"}${targets ? ` Targets ${targets}` : ""}`);
  }
  if (opposite.name) {
    items.push(`${opposite.name}: ${opposite.trigger || "only after invalidation"}`);
  }
  return items;
}

function chartMetaFromAlert(alert) {
  if (!alert) return null;
  const { context, trigger } = resolveAlertTimeframes(alert);
  return {
    symbol: alert.symbol,
    timeframe: trigger,
    contextTimeframe: context && context !== trigger ? context : "",
    atMs: chartAtMsForRole(alert, "trigger"),
    tradePlan: alert.trade_plan || {},
    direction: alert.direction || "",
  };
}

function chartMetaFromJournal(entry) {
  if (!entry) return null;
  let atMs = entry.candle_timestamp_ms || null;
  if (!atMs && entry.time) {
    const parsed = Date.parse(entry.time);
    if (!Number.isNaN(parsed)) atMs = parsed;
  }
  const parsed = parseProfileTimeframes(entry);
  return {
    symbol: entry.symbol,
    timeframe: entry.trigger_timeframe || parsed?.trigger || entry.timeframe,
    contextTimeframe: entry.context_timeframe || parsed?.context || "",
    atMs,
    tradePlan: entry.trade_plan || {},
    direction: entry.direction || "",
  };
}

function parseSummary(details) {
  for (const line of details || []) {
    if (String(line).startsWith("Summary:")) return String(line).slice(8).trim();
    if (String(line).startsWith("Özet:")) return String(line).slice(5).trim();
  }
  return "";
}

function legacyLinePassed(line) {
  const text = String(line);
  if (text.includes("UYGUN DEĞİL") || text.includes("uygun değil")) return false;
  if (/:\s*A\+?\s*—/.test(text)) return true;
  if (/\(uygun\)\s*$/.test(text)) return true;
  return false;
}

function legacyGradeFromDetails(details, stage) {
  const scoreLine = (details || []).find((l) => String(l).startsWith("Kalite puanı:"));
  if (scoreLine) {
    const match = String(scoreLine).match(/(\d+)\/(\d+)/);
    if (match) {
      return legacyGradeFromScore(parseInt(match[1], 10), parseInt(match[2], 10), stage);
    }
  }

  const checks = (details || []).filter((l) =>
    /^(Fiyat bölgesi|Mum yapısı|Trend \(EMA20\)):/.test(String(l))
  );
  if (!checks.length) return null;

  let passed = 0;
  for (const line of checks) {
    if (legacyLinePassed(line)) passed += 1;
  }
  return legacyGradeFromScore(passed, checks.length, stage);
}

function legacyGradeFromScore(score, max, stage) {
  const forming = stage === "forming";
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 1) {
    return { grade: "A+", action: forming ? "Wait for confirmation" : "Tradable" };
  }
  if (ratio >= 2 / 3) {
    return { grade: "A", action: forming ? "Good setup - watch" : "Good setup - conditional" };
  }
  if (ratio >= 1 / 3) {
    return { grade: "CB", action: forming ? "Could be - weak" : "Could be - risky" };
  }
  return { grade: "ML", action: forming ? "Low quality - no trade yet" : "Low quality - pass" };
}

function normalizeSetupGrade(grade) {
  if (!grade) return null;
  const map = { B: "A", C: "CB", D: "ML" };
  return map[grade] || grade;
}

function setupDisplayName(name) {
  const map = {
    "kod-turtle-soup-reclaim": "KOD Turtle Soup Reclaim",
  };
  return map[name] || String(name || "Setup").replace(/^kod-/, "").replace(/-/g, " ");
}

function setupActionLabel(action) {
  const text = String(action || "");
  const map = {
    "Onay bekle": "Wait for confirmation",
    "Girilebilir": "Tradable",
    "Pas geç": "Pass",
    "Maybe later — pas geç": "Maybe later - pass",
    "Maybe later — zayıf potansiyel": "Low quality - no trade yet",
    "Maybe later - weak potential": "Low quality - no trade yet",
    "Could be — riskli": "Could be - risky",
    "Could be — zayıf": "Could be - weak",
    "Could be - location mismatch": "Needs cleaner location",
    "Could be - risky location": "Risky location",
    "Could be - weak": "Lower quality",
    "Could be - risky": "Risky plan",
    "Good setup - small weakness": "Good watchlist - wait for trigger",
    "Good setup - conditional": "Good plan - conditional",
    "İyi setup — izle": "Good setup - watch",
    "İyi setup — şartlı": "Good setup - conditional",
  };
  if (map[text]) return map[text];
  return text
    .replaceAll("—", "-")
    .replaceAll("Maybe later - weak potential", "Low quality - no trade yet")
    .replaceAll("Maybe later - pass", "Low quality - pass")
    .replaceAll("Onay bekle", "Wait for confirmation")
    .replaceAll("Girilebilir", "Tradable")
    .replaceAll("Pas geç", "Pass")
    .replaceAll("pas geç", "pass")
    .replaceAll("İyi setup", "Good setup")
    .replaceAll("zayıf", "weak")
    .replaceAll("şartlı", "conditional")
    .replaceAll("riskli", "risky");
}

function setupGradeFromEntry(entry) {
  const plan = entry?.trade_plan || {};
  if (plan.setup_grade) {
    return { grade: normalizeSetupGrade(plan.setup_grade), action: setupActionLabel(plan.setup_action) };
  }
  return null;
}

function journalEmptyHintForFilter(filter) {
  if (filter === "review") return "No active review items. Live plans and taken trades will appear here.";
  if (filter === "open") return "No open trades.";
  if (filter === "taken") return "No taken trades yet. Mark a signal with ✓ to add one.";
  if (filter === "archive") return "No archived setups.";
  if (filter === "skipped") return "No archived setups.";
  if (filter === "pending") return "No pending decisions.";
  return "Mark signals as taken or skipped; records appear here.";
}

function isArchivedJournalEntry(entry) {
  const status = entry?.status || "pending";
  if (status !== "skipped") return false;
  const note = String(entry?.notes || "");
  return /auto skipped:/i.test(note) || /setup expired/i.test(note) || /no longer active/i.test(note);
}

function filterJournalEntries(entries, filter) {
  if (filter === "review") {
    return entries.filter((entry) => (entry.status || "pending") !== "skipped");
  }
  if (filter === "open") {
    return entries.filter((entry) => (entry.status || "") === "taken" && (entry.outcome || "none") === "open");
  }
  if (filter === "archive") {
    return entries.filter((entry) => (entry.status || "") === "skipped");
  }
  return entries;
}

function journalSummaryText(stats, counts) {
  if (!stats) return "";
  const taken = counts?.taken ?? stats.taken ?? 0;
  const pending = counts?.pending ?? 0;
  const skipped = counts?.skipped ?? 0;
  const closed = (stats.wins ?? 0) + (stats.losses ?? 0);
  if (taken === 0 && pending > 0) {
    return `${pending} pending decision${pending === 1 ? "" : "s"}`;
  }
  if (taken === 0 && skipped > 0) {
    return `${skipped} skipped setup${skipped === 1 ? "" : "s"}`;
  }
  const parts = [`${taken} trade${taken === 1 ? "" : "s"}`];
  if (stats.efficiency_rate != null) {
    parts.push(`${stats.efficiency_rate}% efficient`);
  }
  if (stats.open_total_r != null) {
    parts.push(`running ${fmtR(stats.open_total_r)}`);
  }
  if (closed > 0) {
    parts.push(`${stats.wins ?? 0}W / ${stats.losses ?? 0}L`);
    if (stats.win_rate != null) parts.push(`WR ${stats.win_rate}%`);
    if (stats.avg_r != null) parts.push(`avg ${fmtR(stats.avg_r)}`);
  } else if (taken > 0) {
    parts.push(`${stats.open ?? 0} open`);
  }
  return parts.join(" · ");
}

function journalMetricClass(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const n = Number(value);
  if (n > 0.05) return "positive";
  if (n < -0.05) return "negative";
  return "neutral";
}

function topBreakdownRows(items, formatter) {
  return Object.entries(items || {})
    .sort((a, b) => Math.abs(Number(b[1]?.total_r || 0)) - Math.abs(Number(a[1]?.total_r || 0)))
    .slice(0, 4)
    .map(([label, data]) => formatter(label, data))
    .join("");
}

function renderJournalReviewPanel(stats, counts) {
  if (!els.journalReviewPanel) return;
  if (!stats) {
    els.journalReviewPanel.innerHTML = "";
    return;
  }
  const expectancy = stats.expectancy_r;
  const taken = stats.taken ?? 0;
  const closed = stats.closed ?? 0;

  els.journalReviewPanel.innerHTML = `
    <section class="review-card review-main">
      <span>Trades</span>
      <strong>${Number(taken || 0)}</strong>
      <p>${Number(closed || 0)} closed · ${Number(stats.open || 0)} open</p>
    </section>
    <section class="review-card">
      <span>Expectancy</span>
      <strong class="${journalMetricClass(expectancy)}">${expectancy == null ? "—" : fmtR(expectancy)}</strong>
      <p>Average R per closed trade.</p>
    </section>
    <section class="review-card">
      <span>Total R</span>
      <strong class="${journalMetricClass(stats.total_r)}">${stats.total_r == null ? "—" : fmtR(stats.total_r)}</strong>
      <p>Closed trades only.</p>
    </section>
  `;
}

function renderJournalEdge(stats) {
  if (!els.journalEdgeBody) return;
  if (!stats) {
    els.journalEdgeBody.innerHTML = "";
    return;
  }
  const groups = [
    { key: "by_framework_grade", title: "ICT Grade" },
    { key: "by_grade", title: "Grade" },
    { key: "by_session", title: "Session" },
    { key: "by_profile", title: "Profile" },
    { key: "by_direction", title: "Direction" },
    { key: "by_trigger", title: "Trigger" },
    { key: "by_symbol", title: "Symbol" },
  ];

  const sections = groups
    .map((group) => renderEdgeGroup(group.title, stats[group.key]))
    .filter(Boolean)
    .join("");

  if (!sections) {
    els.journalEdgeBody.innerHTML = `<p class="edge-empty muted">Take and close a few trades — this panel will show which grades, sessions and setups actually carry your R, and flags negative-expectancy buckets to cut.</p>`;
    return;
  }
  els.journalEdgeBody.innerHTML = sections;
}

function renderEdgeGroup(title, bucketMap) {
  const rows = edgeRows(bucketMap);
  if (!rows.length) return "";
  const body = rows.map((row) => edgeRowHtml(row)).join("");
  return `
    <section class="edge-group">
      <h4 class="edge-group-title">${escapeHtml(title)}</h4>
      <div class="edge-rows">${body}</div>
    </section>`;
}

function edgeRows(bucketMap) {
  return Object.entries(bucketMap || {})
    .map(([label, data]) => {
      const closed = (Number(data?.wins || 0) + Number(data?.losses || 0));
      return {
        label,
        taken: Number(data?.taken || 0),
        open: Number(data?.open || 0),
        wins: Number(data?.wins || 0),
        losses: Number(data?.losses || 0),
        closed,
        winRate: data?.win_rate,
        avgR: data?.avg_r,
        totalR: data?.total_r,
      };
    })
    .filter((row) => row.taken > 0)
    .sort((a, b) => Number(b.totalR || 0) - Number(a.totalR || 0));
}

function edgeRowHtml(row) {
  const cls = journalMetricClass(row.avgR);
  // Statistical confidence is weak below ~5 closed trades.
  const thin = row.closed < 5;
  const cut = !thin && Number(row.avgR) < -0.05;
  const flag = cut
    ? `<span class="edge-flag cut" title="Negative expectancy with a usable sample — candidate to cut">CUT</span>`
    : thin
      ? `<span class="edge-flag thin" title="Fewer than 5 closed trades — not enough data yet">THIN</span>`
      : "";
  const wr = row.winRate == null ? "—" : `${row.winRate}%`;
  const avg = row.avgR == null ? "—" : fmtR(row.avgR);
  const total = row.totalR == null ? "—" : fmtR(row.totalR);
  return `
    <div class="edge-row ${cut ? "is-cut" : ""}">
      <div class="edge-row-label">
        <strong>${escapeHtml(row.label)}</strong>
        ${flag}
      </div>
      <div class="edge-row-metrics">
        <span class="edge-metric"><i>WR</i><b>${wr}</b></span>
        <span class="edge-metric"><i>Avg R</i><b class="${cls}">${avg}</b></span>
        <span class="edge-metric"><i>Total R</i><b class="${journalMetricClass(row.totalR)}">${total}</b></span>
        <span class="edge-metric"><i>n</i><b>${row.closed}/${row.taken}</b></span>
      </div>
    </div>`;
}

function setupGradeFromAlert(alert) {
  const plan = alert?.trade_plan || {};
  if (plan.setup_grade) {
    return { grade: normalizeSetupGrade(plan.setup_grade), action: setupActionLabel(plan.setup_action) };
  }
  const details = alert?.details || [];
  const line = details.find((l) => {
    const text = String(l);
    return text.startsWith("Setup:") || text.startsWith("Setup notu:");
  });
  if (line) {
    const text = String(line);
    const match = text.match(/^Setup(?: notu)?:\s*(A\+|A|CB|ML|B|C|D)\s*—\s*(.+)$/);
    if (match) return { grade: normalizeSetupGrade(match[1]), action: match[2].trim() };
  }
  return legacyGradeFromDetails(details, alert?.stage);
}

function gradeClass(grade) {
  if (!grade) return "";
  if (grade === "A+") return "grade-aplus";
  if (grade === "A") return "grade-a";
  if (grade === "CB") return "grade-cb";
  if (grade === "ML") return "grade-ml";
  return "grade-ml";
}

function gradeBadgeHtml(alert) {
  const info = setupGradeFromAlert(alert);
  if (!info?.grade) return "";
  return `<span class="grade-badge ${gradeClass(info.grade)}" title="${escapeHtml(info.action || "")}">${escapeHtml(info.grade)}</span>`;
}

function frameworkGradeClass(grade) {
  if (!grade) return "fw-grade-na";
  if (grade === "S+" || grade === "S") return "fw-grade-s";
  if (grade === "A+" || grade === "A") return "fw-grade-a";
  if (grade === "B+" || grade === "B") return "fw-grade-b";
  return "fw-grade-na";
}

function titleCase(text) {
  return String(text || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function frameworkGradeBadge(fw) {
  if (!fw) return "";
  const grade = fw.grade || "—";
  const score = fw.score ? ` · ${escapeHtml(fw.score)}` : "";
  return `<span class="fw-grade ${frameworkGradeClass(grade)}" title="ICT framework grade">${escapeHtml(grade)}${score}</span>`;
}

function frameworkModalHtml(alert) {
  const fw = alert?.framework;
  if (!fw) return "";
  const inKz = fw.killzone && fw.killzone !== "Outside Killzone";
  const rows = [
    ["Macro bias", titleCase(fw.macro_bias)],
    ["Daily / 4H", `${titleCase(fw.daily_bias)} · ${titleCase(fw.h4_bias)}`],
    ["Structure", fw.market_structure],
    ["Session", `${fw.session || "—"} · ${fw.killzone || "—"}`],
    ["PO3 phase", fw.po3_phase],
    ["MSS / CHOCH", `${fw.mss || "none"} · ${fw.choch || "none"}`],
    ["Draw on liquidity", fw.liquidity_objective],
  ].filter(([, v]) => v && v !== "unknown");

  const crt = fw.crt || {};
  const crtLevels = [
    ["Entry", crt.entry],
    ["Stop", crt.stop],
    ["Target", crt.target],
    ["RR", crt.rr],
  ].filter(([, v]) => v);

  const reasoning = (fw.reasoning || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");

  return `
    <div class="fw-panel">
      <div class="fw-panel-head">
        <span class="fw-panel-title">ICT / CRT Framework</span>
        ${frameworkGradeBadge(fw)}
        ${fw.decision && fw.decision !== "NO TRADE"
          ? `<span class="fw-decision fw-go">${escapeHtml(fw.decision)}</span>`
          : `<span class="fw-decision fw-no">NO TRADE</span>`}
      </div>
      <div class="fw-grid">
        ${rows.map(([k, v]) => `<div class="fw-row"><span>${escapeHtml(k)}</span><strong class="${k === "Killzone" ? (inKz ? "fw-kz-in" : "fw-kz-out") : ""}">${escapeHtml(v)}</strong></div>`).join("")}
      </div>
      ${crtLevels.length ? `<div class="fw-crt"><span class="fw-crt-label">CRT setup${crt.confidence != null ? ` · conf ${escapeHtml(String(crt.confidence))}` : ""}</span><div class="fw-crt-levels">${crtLevels.map(([k, v]) => `<div class="level"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div></div>` : ""}
      ${reasoning ? `<ul class="fw-reasoning">${reasoning}</ul>` : ""}
    </div>`;
}

function frameworkStripHtml(alert) {
  const fw = alert?.framework;
  if (!fw) return "";
  const inKz = fw.killzone && fw.killzone !== "Outside Killzone";
  const chips = [];
  if (fw.macro_bias) chips.push(`<span class="fw-chip" title="Macro bias">${escapeHtml(titleCase(fw.macro_bias))}</span>`);
  if (fw.killzone) chips.push(`<span class="fw-chip ${inKz ? "fw-kz-in" : "fw-kz-out"}" title="Killzone">${escapeHtml(fw.killzone.replace(" Killzone", " KZ"))}</span>`);
  if (fw.po3_phase && fw.po3_phase !== "unknown") chips.push(`<span class="fw-chip" title="PO3 phase">${escapeHtml(fw.po3_phase)}</span>`);
  if (fw.liquidity_objective && fw.liquidity_objective !== "none") chips.push(`<span class="fw-chip fw-draw" title="Draw on liquidity">→ ${escapeHtml(fw.liquidity_objective)}</span>`);
  const decision = fw.decision && fw.decision !== "NO TRADE"
    ? `<span class="fw-decision fw-go">${escapeHtml(fw.decision)}</span>`
    : `<span class="fw-decision fw-no">NO TRADE</span>`;
  return `
    <div class="fw-strip">
      <div class="fw-strip-head">
        ${frameworkGradeBadge(fw)}
        ${decision}
      </div>
      <div class="fw-chips">${chips.join("")}</div>
    </div>`;
}

function fwScoreNumber(fw) {
  const value = parseFloat(String(fw?.score || "").replace("%", ""));
  return Number.isFinite(value) ? value : null;
}

function normalizeBias(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("strong bullish")) return "strong bullish";
  if (text.includes("strong bearish")) return "strong bearish";
  if (text.includes("bull")) return "bullish";
  if (text.includes("bear")) return "bearish";
  if (text.includes("pullback")) return "pullback";
  if (text.includes("expansion")) return "expansion";
  if (text.includes("consolidation") || text.includes("compression")) return "consolidation";
  if (text.includes("neutral") || text.includes("unavailable")) return "neutral";
  return text || "neutral";
}

function directionSide(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("bull") || text === "long") return "bullish";
  if (text.includes("bear") || text === "short") return "bearish";
  return "";
}

function frameworkBiasSide(fw) {
  const macro = directionSide(fw?.macro_bias);
  if (macro) return macro;
  const frames = ["monthly_bias", "weekly_bias", "daily_bias", "h4_bias"];
  const votes = frames.map((key) => directionSide(fw?.[key])).filter(Boolean);
  const bullish = votes.filter((side) => side === "bullish").length;
  const bearish = votes.filter((side) => side === "bearish").length;
  if (bullish >= 3 && bullish > bearish) return "bullish";
  if (bearish >= 3 && bearish > bullish) return "bearish";
  return "";
}

function isCounterBiasAlert(alert) {
  const fwSide = frameworkBiasSide(alert?.framework || {});
  const alertSide = directionSide(alert?.direction);
  return Boolean(fwSide && alertSide && fwSide !== alertSide);
}

function biasConflictText(alert) {
  const fw = alert?.framework || {};
  const bias = fw.macro_bias || titleCase(frameworkBiasSide(fw) || "HTF bias");
  const side = directionLabel(alert?.direction).toLowerCase();
  return `${bias} blocks ${side}. Wait for bias flip.`;
}

function biasClass(value) {
  const bias = normalizeBias(value);
  if (bias.includes("bullish")) return "bullish";
  if (bias.includes("bearish")) return "bearish";
  if (bias.includes("pullback") || bias.includes("mixed")) return "pullback";
  if (bias.includes("expansion")) return "expansion";
  if (bias.includes("consolidation")) return "consolidation";
  return "neutral";
}

function directionGlyph(value) {
  const cls = biasClass(value);
  if (cls === "bullish") return "UP";
  if (cls === "bearish") return "DN";
  if (cls === "pullback") return "PB";
  if (cls === "expansion") return "EX";
  if (cls === "consolidation") return "CO";
  return "NT";
}

function frameworkTf(fw, tf) {
  const map = fw?.timeframes || {};
  const direct = map[tf] || {};
  const fallback = {
    "1d": fw?.daily_bias,
    "4h": fw?.h4_bias,
    "1h": fw?.one_h_bias,
    "15m": fw?.m15_bias,
  };
  return {
    bias: direct.bias || fallback[tf] || "neutral",
    structure: direct.structure || {},
    pd: direct.pd || {},
  };
}

function shortStructureLabel(item) {
  const structure = item?.structure || {};
  const pattern = String(structure.pattern || structure.trend || item?.bias || "neutral");
  if (pattern.includes("HH+HL")) return "HH/HL";
  if (pattern.includes("LH+LL")) return "LH/LL";
  if (pattern.includes("HH+LL")) return "EXP";
  if (pattern.toLowerCase().includes("compression")) return "COMP";
  return titleCase(pattern).slice(0, 10);
}

function mtfStructureChipsHtml(fw) {
  const frames = [
    ["M", "1M"],
    ["W", "1w"],
    ["D1", "1d"],
    ["H4", "4h"],
    ["H1", "1h"],
    ["M15", "15m"],
  ];
  return frames.map(([label, key]) => {
    const item = frameworkTf(fw, key);
    const cls = biasClass(item.bias);
    return `
      <span class="mtf-chip ${cls}" title="${escapeHtml(label)} structure: ${escapeHtml(shortStructureLabel(item))}">
        <b>${escapeHtml(label)}</b>
        <i>${escapeHtml(directionGlyph(item.bias))}</i>
        <em>${escapeHtml(shortStructureLabel(item))}</em>
      </span>`;
  }).join("");
}

function marketBiasBarHtml(post) {
  const fw = post?.framework || {};
  const overall = fw.macro_bias || titleCase(post?.bias || "Neutral");
  const cls = biasClass(overall);
  return `
    <div class="market-bias-bar ${cls}">
      <div class="bias-read">
        <span>Overall Bias</span>
        <strong>${escapeHtml(overall)}</strong>
      </div>
      <div class="mtf-structure">${mtfStructureChipsHtml(fw)}</div>
    </div>`;
}

function normalizeTradeDecision(post) {
  const fw = post?.framework || {};
  const fwSide = frameworkBiasSide(fw);
  const postSide = directionSide(post?.bias);
  if (fwSide && postSide && fwSide !== postSide) {
    return { type: "no-trade", label: "NO TRADE", subtitle: shortTacticalText(`${fw.macro_bias || titleCase(fwSide)} blocks ${directionLabel(post?.bias).toLowerCase()}`) };
  }
  const raw = String(fw.decision || post?.decision?.label || post?.status || "WAIT").toUpperCase();
  const subtitle = post?.decision?.subtitle || post?.what_now || "";
  if (raw.includes("NO TRADE") || post?.status === "blocked") {
    return { type: "no-trade", label: "NO TRADE", subtitle: shortTacticalText(subtitle || "Wait for cleaner conditions") };
  }
  if (raw.includes("LONG")) {
    return { type: "long", label: "LONG BIAS", subtitle: shortTacticalText(subtitle || "Entry and target mapped") };
  }
  if (raw.includes("SHORT")) {
    return { type: "short", label: "SHORT BIAS", subtitle: shortTacticalText(subtitle || "Entry and target mapped") };
  }
  if (raw.includes("READY")) {
    return { type: post?.bias === "bearish" ? "short" : "long", label: `${directionLabel(post?.bias).toUpperCase()} BIAS`, subtitle: "Plan valid" };
  }
  return { type: "wait", label: "WAIT", subtitle: shortTacticalText(subtitle || "Trigger not ready") };
}

function shortTacticalText(text) {
  const clean = String(text || "").replace(/^Manual execution only\.\s*/i, "").trim();
  if (!clean) return "";
  return clean.length > 54 ? `${clean.slice(0, 53).trim()}...` : clean;
}

function primaryObjective(post) {
  const fw = post?.framework || {};
  const objective = fw.liquidity_objective;
  if (objective && objective !== "none") {
    if (typeof objective === "object") {
      const label = objective.source || objective.kind || objective.side || "Liquidity";
      const level = objective.level != null ? ` @ ${fmtNum(objective.level)}` : "";
      return `${label}${level}`;
    }
    return String(objective);
  }
  if (post?.objective?.source && post?.objective?.level != null) {
    return `${post.objective.source} @ ${fmtNum(post.objective.level)}`;
  }
  return "No clean draw";
}

function liquidityLabel(source) {
  const raw = String(source || "").trim();
  const upper = raw.toUpperCase();
  if (upper === "BUY-SIDE LIQUIDITY") return "BSL";
  if (upper === "SELL-SIDE LIQUIDITY") return "SSL";
  if (upper === "EQUAL HIGHS") return "EQH";
  if (upper === "EQUAL LOWS") return "EQL";
  if (["PDH", "PDL", "PWH", "PWL", "PMH", "PML"].includes(upper)) return upper;
  return raw || "Liquidity";
}

function objectiveLevelFromText(text) {
  const match = String(text || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function liquidityStatus(pool, objectiveLevel) {
  const level = Number(pool?.level);
  if (Number.isFinite(level) && Number.isFinite(objectiveLevel) && Math.abs(level - objectiveLevel) <= Math.max(Math.abs(level), 1) * 0.0005) {
    return "active";
  }
  const dist = Number(pool?.distance_pct);
  if (Number.isFinite(dist)) {
    if (pool?.side === "buy" && dist < 0) return "taken";
    if (pool?.side === "sell" && dist > 0) return "taken";
  }
  return "pending";
}

function liquidityRoadmapHtml(post) {
  const fw = post?.framework || {};
  const objective = primaryObjective(post);
  const objectiveLevel = objectiveLevelFromText(objective);
  const pools = (fw.liquidity_ranking || fw.liquidity_map || []).slice(0, 5);
  const items = pools.map((pool, index) => {
    const status = liquidityStatus(pool, objectiveLevel);
    const label = liquidityLabel(pool.source);
    const level = pool.level != null ? fmtNum(pool.level) : "";
    return `
      <li class="${status}">
        <span class="roadmap-step">${index + 1}</span>
        <div>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(pool.strength || "")}${level ? ` · ${escapeHtml(level)}` : ""}</small>
        </div>
        <b>${status === "taken" ? "TAKEN" : status === "active" ? "ACTIVE" : "PENDING"}</b>
      </li>`;
  }).join("");
  return `
    <aside class="liquidity-roadmap" aria-label="Liquidity roadmap">
      <div class="roadmap-head">
        <span>Liquidity Roadmap</span>
        <strong>${escapeHtml(liquidityLabel(objective.split("@")[0]))}</strong>
      </div>
      <ol>${items || `<li class="pending"><span class="roadmap-step">1</span><div><strong>No mapped pool</strong><small>Waiting for draw</small></div><b>WAIT</b></li>`}</ol>
    </aside>`;
}

function po3LifecycleHtml(fw) {
  const active = String(fw?.po3_phase || "unknown").toLowerCase();
  const phases = ["Accumulation", "Manipulation", "Distribution"];
  const activeIndex = phases.findIndex((phase) => phase.toLowerCase() === active);
  return `
    <div class="po3-life" aria-label="PO3 lifecycle">
      ${phases.map((phase, index) => {
        const status = activeIndex < 0 ? "pending" : index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
        return `<span class="${status}"><b>${escapeHtml(phase)}</b><em>${status === "done" ? "OK" : status === "active" ? "ACTIVE" : "PENDING"}</em></span>`;
      }).join("")}
    </div>`;
}

function setupGradeHtml(fw, fallbackGrade = "") {
  const grade = fw?.grade || fallbackGrade || "NO TRADE";
  const score = fwScoreNumber(fw);
  const scoreText = score != null ? ` · ${score}%` : "";
  return `<span class="setup-grade-xl ${frameworkGradeClass(grade)}">${escapeHtml(grade)}${escapeHtml(scoreText)}</span>`;
}

function deskChartMetaHtml(post) {
  const decision = normalizeTradeDecision(post);
  const objective = primaryObjective(post);
  return `
    <div class="crt-chart-meta">
      <span class="desk-decision-pill ${escapeHtml(decision.type)}">${escapeHtml(decision.label)}</span>
      ${objective ? `<span class="desk-plan-facts">${escapeHtml(objective)}</span>` : ""}
    </div>`;
}

function tradeDecisionBadgeHtml(post) {
  const decision = normalizeTradeDecision(post);
  return `
    <div class="trade-decision-badge ${decision.type}">
      <strong>${escapeHtml(decision.label)}</strong>
      <span>${escapeHtml(decision.subtitle)}</span>
    </div>`;
}

function mobileTradeStripHtml(post) {
  const fw = post?.framework || {};
  const crt = fw.crt || {};
  const decision = normalizeTradeDecision(post);
  const bias = fw.macro_bias || post?.bias || "Neutral";
  const activeSetup = post?.active_setup_model?.name || "Wait";
  const rows = [
    ["Bias", bias],
    ["Setup", activeSetup],
    ["Objective", primaryObjective(post)],
    ["Decision", decision.label],
    ["Entry", crt.entry || "Wait"],
    ["Invalid", crt.stop || "—"],
    ["Target", crt.target || "—"],
  ];
  return `
    <div class="crt-mobile-strip ${escapeHtml(decision.type)}">
      <div class="mobile-strip-head">
        <strong>${escapeHtml(marketDisplay(post?.symbol))}</strong>
        ${setupGradeHtml(fw, post?.grade)}
      </div>
      <div class="mobile-strip-grid">
        ${rows.map(([label, value]) => `<span><b>${escapeHtml(label)}</b><em>${escapeHtml(String(value || "—"))}</em></span>`).join("")}
      </div>
    </div>`;
}

function latestSweepLabel(fw) {
  const sweep = fw?.latest_sweep || (fw?.sweeps || [])[0];
  if (!sweep) return "";
  const side = sweep.type === "bullish" ? "SSL SWEPT" : sweep.type === "bearish" ? "BSL SWEPT" : "SWEEP";
  return `${side}${sweep.strength ? ` · ${sweep.strength}` : ""}`;
}

function firstFreshFvgLabel(fw) {
  const fvg = (fw?.fvg || []).find((item) => item.freshness === "fresh") || (fw?.fvg || [])[0];
  if (!fvg) return "";
  return `${titleCase(fvg.direction || "")} FVG`;
}

function marketNarrativeChainHtml(post) {
  const fw = post?.framework || {};
  const chain = [
    latestSweepLabel(fw),
    fw.mss && fw.mss !== "none" ? `${String(fw.mss).toUpperCase()} MSS` : "",
    firstFreshFvgLabel(fw),
    primaryObjective(post) !== "No clean draw" ? `TARGETING ${liquidityLabel(primaryObjective(post).split("@")[0])}` : "",
  ].filter(Boolean).slice(0, 4);
  return `
    <div class="market-story-chain">
      ${chain.map((item) => `<span>${escapeHtml(item)}</span>`).join(`<i aria-hidden="true">-&gt;</i>`)}
    </div>`;
}

function eventTimelineHtml(post) {
  const fw = post?.framework || {};
  const events = [];
  const sweep = latestSweepLabel(fw);
  if (sweep) events.push([sweep, "recent"]);
  if (fw.mss && fw.mss !== "none") events.push([`${String(fw.mss).toUpperCase()} MSS`, "now"]);
  if (fw.choch && fw.choch !== "none") events.push([`${String(fw.choch).toUpperCase()} CHOCH`, "now"]);
  const fvg = firstFreshFvgLabel(fw);
  if (fvg) events.push([`${fvg} CREATED`, "recent"]);
  const crt = fw.crt?.type || normalizeTradeDecision(post).label;
  if (crt) events.push([String(crt).toUpperCase(), "now"]);
  const limited = events.slice(-5);
  return `
    <div class="event-timeline" aria-label="Market event timeline">
      ${limited.map(([label, time], index) => `
        <span class="${index === limited.length - 1 ? "current" : ""}">
          <b>${escapeHtml(label)}</b>
          <em>${escapeHtml(time)}</em>
        </span>
      `).join("")}
    </div>`;
}

function setupBreakdownHtml(post) {
  const fw = post?.framework || {};
  const checklist = [
    ["HTF Alignment", biasClass(fw.macro_bias) === biasClass(post?.bias) && post?.bias !== "neutral"],
    ["Liquidity Sweep", Boolean(fw.latest_sweep || (fw.sweeps || []).length)],
    ["Displacement", Boolean(fw.displacement?.present)],
    ["MSS", fw.mss && fw.mss !== "none"],
    ["CHOCH", fw.choch && fw.choch !== "none"],
    ["FVG", Boolean((fw.fvg || []).length)],
    ["OB", Boolean((fw.order_blocks || []).length)],
    ["PO3", fw.po3_phase && fw.po3_phase !== "unknown"],
    ["CRT", Boolean(fw.crt?.type)],
  ];
  return `
    <details class="setup-breakdown">
      <summary>Setup Breakdown</summary>
      <div class="breakdown-grid">
        ${checklist.map(([label, ok]) => `
          <span class="${ok ? "pass" : "wait"}"><b>${ok ? "OK" : "WAIT"}</b>${escapeHtml(label)}</span>
        `).join("")}
      </div>
      <p>Score: ${escapeHtml(fw.score || "—")}</p>
    </details>`;
}

function alertPreviewLine(alert) {
  if (isCounterBiasAlert(alert)) return biasConflictText(alert);
  const details = normalizeDetailLines(alert?.details || [], alert || {});
  const setup = details.find((l) => String(l).startsWith("Setup:") || String(l).startsWith("Setup notu:"));
  if (alert?.stage === "forming") {
    const tf = alert.trigger_timeframe || alert.timeframe || "trigger";
    return `No entry. Waiting for clean ${tf} displacement.`;
  }
  if (alert?.stage === "confirmed") return "Plan ready. Entry, invalidation and targets are mapped.";
  if (setup) {
    const text = String(setup).replace(/^Setup(?: notu)?:\s*(A\+|A|CB|ML)\s*—\s*/, "");
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  }
  const why = details.find((l) => String(l).startsWith("Why") || String(l).startsWith("Neden"));
  if (why) {
    const text = String(why)
      .replace(/^Why (SHORT|LONG|watch)\?:\s*/, "")
      .replace(/^Neden (SHORT|LONG|izleniyor)\?:\s*/, "");
    return text.length > 96 ? `${text.slice(0, 96)}…` : text;
  }
  const summary = parseSummary(details);
  if (summary && !summary.startsWith("Early HTF warning") && !summary.startsWith("Setup confirmed") && !summary.startsWith("Erken uyarı") && !summary.startsWith("Kurulum onaylandı")) {
    return summary.length > 96 ? `${summary.slice(0, 96)}…` : summary;
  }
  const reason = details.find((l) => String(l).startsWith("What happened?:") || String(l).startsWith("Ne oldu?:"));
  if (reason) {
    const text = String(reason).replace("What happened?: ", "").replace("Ne oldu?: ", "");
    const dir = alert?.direction === "bearish" ? "SHORT" : alert?.direction === "bullish" ? "LONG" : "";
    const prefix = dir ? `${dir}: ` : "";
    const line = prefix + text;
    return line.length > 96 ? `${line.slice(0, 96)}…` : line;
  }
  if (alert?.stage === "forming") return "Watch only. No entry yet.";
  return "Tap for details";
}

function bestRr(plan) {
  if (!plan) return null;
  return plan.rr_final ?? plan.rr_tp2 ?? plan.rr_tp1 ?? null;
}

function nextScanLabel(status) {
  if (!status?.running || !status?.poll_seconds) return "Next: —";
  if (!status.last_scan_at) return "Next: armed";
  const last = Date.parse(status.last_scan_at);
  if (Number.isNaN(last)) return "Next: armed";
  const due = last + Number(status.poll_seconds) * 1000;
  const sec = Math.max(0, Math.ceil((due - Date.now()) / 1000));
  return sec < 60 ? `Next: ${sec}s` : `Next: ${Math.ceil(sec / 60)}m`;
}

function alertActionText(alert, gradeInfo) {
  if (isCounterBiasAlert(alert)) return "Bias conflict";
  const stage = alert?.stage || "forming";
  if (stage === "confirmed") return "Plan active";
  if (stage === "invalidated") return "Dead setup";
  if (gradeInfo?.action) return gradeInfo.action;
  return "Wait for trigger";
}

function riskLabel(alert) {
  const plan = alert?.trade_plan || {};
  const details = normalizeDetailLines(alert?.details || [], alert || {});
  if (String(plan.risk_warning || "").toLowerCase().includes("wide")) return "Wide risk";
  if (details.some((line) => /wide risk|risk wide|risk geniş/i.test(String(line)))) return "Wide risk";
  if (plan.rr_final != null) return `RR ${fmtRr(plan.rr_final)}`;
  if (plan.risk != null) return `Risk ${fmtNum(plan.risk)}`;
  return "Risk —";
}

function actionClass(gradeInfo, stage) {
  if (gradeInfo?.counterBias) return "action-dead";
  if (stage === "confirmed") return "action-confirmed";
  if (stage === "invalidated") return "action-dead";
  const grade = gradeInfo?.grade || "";
  if (grade === "A+" || grade === "A") return "action-watch";
  if (grade === "CB") return "action-caution";
  return "action-pass";
}

function alertPriority(alert) {
  const stage = alert?.stage || "forming";
  if (stage === "confirmed") return 0;
  if (stage === "forming") return 1;
  return 2;
}

function renderStatus(status) {
  state.lastStatus = status;
  const running = status.running;
  const scanning = status.scan_in_progress;
  const cloudReadOnly = Boolean(status.cloud_readonly);
  const counts = status.journal_counts || {};
  state.cloudReadOnly = cloudReadOnly;
  document.body.classList.toggle("cloud-readonly", cloudReadOnly);

  if (els.botState) {
    els.botState.textContent = cloudReadOnly ? "On-demand" : scanning ? "Scanning" : running ? "Running" : "Stopped";
    els.botState.className = `${cloudReadOnly ? "running" : scanning ? "scanning" : running ? "running" : "stopped"}`;
  }
  if (els.lastScan) els.lastScan.textContent = fmtTime(status.last_scan_at);
  if (els.terminalNextScan) els.terminalNextScan.textContent = nextScanLabel(status);
  if (els.alertsCount) els.alertsCount.textContent = cloudReadOnly ? "Desk" : status.stored_alerts ?? 0;
  if (els.dryRun) els.dryRun.textContent = cloudReadOnly ? "Read-only" : status.dry_run ? "Dashboard" : "Live";
  if (els.journalCount) els.journalCount.textContent = counts.total ?? 0;
  if (els.journalPendingLabel) {
    els.journalPendingLabel.textContent = `Wait: ${counts.pending ?? 0}`;
  }
  if (els.pollChip) els.pollChip.textContent = status.poll_seconds ? `${status.poll_seconds}s` : "—";
  if (els.terminalPoll) els.terminalPoll.textContent = status.poll_seconds ? `Poll: ${status.poll_seconds}s` : "Poll: —";
  if (els.configPath) els.configPath.textContent = status.config_path || "—";
  if (els.statePath) els.statePath.textContent = status.state_file || "—";
  if (els.journalPath) els.journalPath.textContent = status.journal_file || "—";
  if (els.envPath) els.envPath.textContent = status.env_file || "—";

  if (els.runtimeLine) {
    if (cloudReadOnly) {
      els.runtimeLine.textContent = "Cloud read-only";
    } else if (scanning) {
      const elapsed = scanElapsedLabel(status.scan_started_at);
      els.runtimeLine.textContent = elapsed
        ? `Scanning · ${elapsed}`
        : "Scanning";
    } else if (status.last_error) {
      els.runtimeLine.textContent = "Error";
    } else {
      els.runtimeLine.textContent = status.dry_run ? "Dashboard only" : "Live alerts";
    }
  }

  if (els.apiState) {
    els.apiState.textContent = status.last_error ? "Warn" : cloudReadOnly ? "Desk" : scanning ? "Scan" : "Online";
    els.apiState.className = `badge ${status.last_error ? "warn" : "ok"}`;
  }
  if (els.terminalApiState) {
    els.terminalApiState.textContent = status.last_error ? "Warn" : cloudReadOnly ? "On demand" : scanning ? "Scanning" : "Online";
    els.terminalApiState.className = status.last_error ? "warn" : "ok";
  }

  const tickerItems = (status.symbols || [])
    .map((s) => `<span class="ticker-item" title="${escapeHtml(marketProxyNote(s) || s)}">${escapeHtml(marketDisplay(s))}</span>`)
    .join("");
  if (els.tickerStrip) {
    els.tickerStrip.innerHTML = tickerItems;
  }
  if (els.headerTicker) {
    els.headerTicker.innerHTML = tickerItems ? tickerItems + tickerItems : `<span class="ticker-item muted">No markets</span>`;
  }
  if (els.terminalSymbols) {
    const symbols = status.symbols || [];
    els.terminalSymbols.textContent = symbols.length ? `Markets: ${symbols.length}` : "Markets: —";
  }

  applyControlState(status);
}

function renderJournalHeroStats(stats) {
  if (!stats) return;
  if (els.journalWinRate) {
    els.journalWinRate.textContent = stats.win_rate != null ? `${stats.win_rate}%` : "—";
  }
  if (els.journalRTotal) {
    els.journalRTotal.textContent = stats.total_r != null ? `R: ${fmtR(stats.total_r)}` : "R: —";
  }
}

function renderJournalStats(stats, counts) {
  if (els.journalPendingCount) els.journalPendingCount.textContent = counts?.pending ?? 0;
  if (els.journalSkippedCount) els.journalSkippedCount.textContent = counts?.skipped ?? 0;
  if (els.journalTakenCount) els.journalTakenCount.textContent = counts?.taken ?? 0;
  if (els.journalOpenCount) els.journalOpenCount.textContent = stats?.open ?? 0;
  if (els.journalClosedCount) els.journalClosedCount.textContent = stats?.closed ?? 0;
  if (els.journalEfficiencyRate) els.journalEfficiencyRate.textContent = stats?.efficiency_rate != null ? `${stats.efficiency_rate}%` : "—";
  if (els.journalRunningR) els.journalRunningR.textContent = stats?.open_total_r != null ? fmtR(stats.open_total_r) : "—";
  if (els.journalAvgR) els.journalAvgR.textContent = stats?.avg_r != null ? fmtR(stats.avg_r) : "—";
  if (els.journalAvgPnl) els.journalAvgPnl.textContent = stats?.avg_pnl_pct != null ? fmtPct(stats.avg_pnl_pct) : "—";
  if (els.journalReviewWin) els.journalReviewWin.textContent = stats?.win_rate != null ? `${stats.win_rate}%` : "—";
}

function renderConfig(config) {
  if (!config.ok) {
    if (els.exchangeChip) els.exchangeChip.textContent = "Error";
    if (els.setups) {
      els.setups.innerHTML = `<p class="muted">${escapeHtml(config.error || "config error")}</p>`;
    }
    return;
  }
  if (els.exchangeChip) {
    els.exchangeChip.textContent = `${config.exchange.id} · ${config.exchange.market_type}`;
  }
  const symbols = config.scanner?.symbols || [];
  if (els.symbols) {
  els.symbols.innerHTML = symbols.length
      ? symbols.map((s) => `
        <div class="watch-item">
          <strong>${escapeHtml(marketDisplay(s))}</strong>
          ${marketProxyNote(s) ? `<span>${escapeHtml(marketProxyNote(s))}</span>` : `<span>${escapeHtml(s)}</span>`}
        </div>`).join("")
      : `<p class="muted">No markets</p>`;
  }
  const setups = config.setups || [];
  if (els.setups) {
  els.setups.innerHTML = setups.length
      ? setups.map((setup) => `
          <div class="setup-row">
            <div>
              <div class="setup-name">${escapeHtml(setup.name)}</div>
              <div class="setup-meta">${escapeHtml(setup.brief || setup.type || "")}</div>
            </div>
            <span class="badge">${setup.enabled ? "On" : "Off"}</span>
          </div>`).join("")
      : `<p class="muted">No strategy</p>`;
  }
}

function renderDesk(payload) {
  if (!els.deskFeed) return;
  if (!payload?.ok) {
    els.deskFeed.innerHTML = `<div class="desk-state">Desk failed: ${escapeHtml(payload?.message || "Unknown error")}</div>`;
    if (els.deskEmpty) els.deskEmpty.classList.add("hidden");
    return;
  }
  const posts = payload.posts || [];
  state.deskCache = posts;
  state.deskPayload = payload;
  const symbols = [...new Set(posts.map((post) => post.symbol).filter(Boolean))];
  if (!symbols.includes(state.deskSymbol)) {
    const focusPost = sortedDeskPosts(posts).find((post) => Number(post.priority_score || 0) >= 35) || sortedDeskPosts(posts)[0];
    state.deskSymbol = focusPost?.symbol || symbols[0] || "";
  }
  renderDeskMarkets(posts, symbols);
  const symbolPosts = state.deskSymbol
    ? sortedDeskPosts(posts.filter((post) => post.symbol === state.deskSymbol))
    : sortedDeskPosts(posts);
  const visiblePosts = symbolPosts.slice(0, 1);
  if (els.deskSummary) {
    const cacheAge = Math.round(Number(payload.cache_age_seconds || 0));
    const cacheText = payload.cached ? ` · cache ${cacheAge}s` : "";
    const primary = visiblePosts[0] || {};
    const setup = primary.active_setup_model?.name || primary.profile || "No clean setup";
    const marketText = state.deskSymbol ? `${marketDisplay(state.deskSymbol)} · ` : "";
    const extra = symbolPosts.length > 1 ? ` · ${symbolPosts.length - 1} quiet` : "";
    els.deskSummary.textContent = `${marketText}${setup}${extra} · ${fmtTime(payload.generated_at)}${cacheText}`;
  }
  if (els.deskEmpty) els.deskEmpty.classList.toggle("hidden", visiblePosts.length > 0);
  els.deskFeed.innerHTML = visiblePosts.length
    ? visiblePosts.map(renderDeskPost).join("")
    : "";
  void loadDeskCharts();
}

function setupStatusLabel(status) {
  const labels = {
    ready: "TRADE",
    armed: "ARMED",
    waiting: "WAIT",
    blocked: "NO",
    unavailable: "N/A",
  };
  return labels[status] || String(status || "WAIT").toUpperCase();
}

function setupRadarHtml(post) {
  const candidates = post?.setup_candidates || [];
  const activeKey = post?.active_setup_model?.key || "";
  if (!candidates.length) return "";
  const rank = { ready: 5, armed: 4, waiting: 3, blocked: 2, unavailable: 1 };
  const visible = [...candidates]
    .filter((item) => item.status !== "unavailable")
    .sort((a, b) => {
      const activeDiff = Number(b.key === activeKey) - Number(a.key === activeKey);
      if (activeDiff) return activeDiff;
      return (rank[b.status] || 0) - (rank[a.status] || 0);
    })
    .slice(0, 3);
  return `
    <div class="setup-radar" aria-label="CRT setup radar">
      ${visible.map((item) => {
        const status = item.status || "waiting";
        const active = item.key && item.key === activeKey ? "active" : "";
        return `
          <article class="setup-radar-card ${escapeHtml(status)} ${active}">
            <header>
              <strong>${escapeHtml(item.name || "Setup")}</strong>
              <span>${escapeHtml(setupStatusLabel(status))}</span>
            </header>
            <p>${escapeHtml(item.detail || "")}</p>
            <small>${escapeHtml(item.trigger || item.timeframe || "")}</small>
          </article>`;
      }).join("")}
    </div>`;
}

function timeframeChartsHtml(post) {
  const charts = post?.timeframe_charts || [];
  if (!charts.length) {
    return `
      <div class="desk-mtf-chart-card active">
        <div class="desk-mtf-chart-head"><strong>${escapeHtml(post?.trigger_timeframe || "Chart")}</strong><span>Trigger</span></div>
        <div class="tv-chart-canvas desk-chart desk-mtf-chart expandable-chart" data-chart-url="${escapeHtml(post?.chart_url || "")}" data-chart-label="${escapeHtml(`${post?.symbol || ""} trigger chart`)}"></div>
      </div>`;
  }
  return charts.map((chart) => `
    <div class="desk-mtf-chart-card ${chart.active ? "active" : ""} role-${escapeHtml(chart.role || "context")}">
      <div class="desk-mtf-chart-head">
        <strong>${escapeHtml(chart.label || chart.timeframe || "")}</strong>
        <span>${escapeHtml(chart.role === "trigger" ? "Trigger" : "Context")}</span>
      </div>
      <div class="tv-chart-canvas desk-chart desk-mtf-chart expandable-chart" data-chart-url="${escapeHtml(chart.url || "")}" data-chart-label="${escapeHtml(`${post?.symbol || ""} ${chart.timeframe || ""}`)}"></div>
    </div>`).join("");
}

function renderDeskMarkets(posts, symbols) {
  if (!els.deskMarketTabs) return;
  els.deskMarketTabs.innerHTML = symbols.length
    ? symbols.map((symbol) => {
      const symbolPosts = posts.filter((post) => post.symbol === symbol);
      const bestPost = sortedDeskPosts(symbolPosts)[0] || {};
      const isActive = symbol === state.deskSymbol;
      const isHot = symbolPosts.some((post) => post.high_potential);
      const profiles = symbolPosts.map((post) => `${post.context_timeframe}→${post.trigger_timeframe}`).join(" / ");
      return `
        <button type="button" class="desk-market-btn ${isActive ? "active" : ""} ${isHot ? "hot" : ""}" data-desk-symbol="${escapeHtml(symbol)}">
          <strong>${escapeHtml(marketDisplay(symbol))}</strong>
          <small>${escapeHtml(profiles || symbol)}</small>
        </button>`;
    }).join("")
    : "";
}

function sortedDeskPosts(posts) {
  return [...(posts || [])].sort((a, b) => {
    const scoreDiff = Number(b.priority_score || 0) - Number(a.priority_score || 0);
    if (scoreDiff) return scoreDiff;
    const rank = { ready: 4, armed: 3, waiting: 2, blocked: 1 };
    return (rank[b.status] || 0) - (rank[a.status] || 0);
  });
}

function renderDeskSessions(projections) {
  if (!els.deskSessions) return;
  const items = projections || [];
  if (!items.length) {
    if (els.deskSessionTabs) els.deskSessionTabs.innerHTML = "";
    els.deskSessions.innerHTML = `
      <div class="desk-sessions-empty">
        <p>No session markets configured.</p>
        <span class="muted">NAS100, EUR/USD, GBP/USD show session boxes.</span>
      </div>`;
    return;
  }

  if (!items.some((item) => item.symbol === state.deskSessionSymbol)) {
    state.deskSessionSymbol = items[0].symbol || "";
  }

  if (els.deskSessionTabs) {
    els.deskSessionTabs.innerHTML = items.map((item) => {
      const active = item.symbol === state.deskSessionSymbol ? "active" : "";
      const status = item.status || "neutral";
      return `
        <button type="button" class="desk-session-tab ${active} status-${escapeHtml(status)}" data-desk-session-symbol="${escapeHtml(item.symbol || "")}">
          ${escapeHtml(marketDisplay(item.symbol))}
        </button>`;
    }).join("");
  }

  const active = items.find((item) => item.symbol === state.deskSessionSymbol) || items[0];
  els.deskSessions.innerHTML = renderDeskSessionPanel(active);
  void loadDeskSessionChart(active);
}

function renderDeskSessionPanel(item) {
  const status = item.status || "neutral";
  const ranges = item.ranges || [];
  const expectations = item.expectations || [];
  const chartUrl = item.chart_url || `/api/chart/session?symbol=${encodeURIComponent(item.symbol || "")}`;

  const rangePills = ranges.map((range) => `
    <div class="session-range-pill ${range.active ? "live" : ""} session-${escapeHtml(range.key || "")}">
      <span class="session-range-name">${escapeHtml(range.name || "")}</span>
      <span class="session-range-values mono">${escapeHtml(fmtNum(range.high))} / ${escapeHtml(fmtNum(range.low))}</span>
    </div>`).join("");

  const expectHtml = expectations.map((row) => `
    <div class="session-expect-row">
      <span class="session-expect-label">${escapeHtml(row.title || row.key || "")}</span>
      <p>${escapeHtml(row.text || "—")}</p>
    </div>`).join("");

  return `
    <div class="session-panel status-${escapeHtml(status)}">
      <div class="session-chart-frame tv-chart-frame">
        <div class="tv-chart-toolbar">
          <span>${escapeHtml(marketDisplay(item.symbol))} · 15m</span>
          <span class="session-bias">${escapeHtml(projectionStatusLabel(status))}</span>
        </div>
        <div class="tv-chart-canvas session-chart-canvas expandable-chart" data-chart-url="${escapeHtml(chartUrl)}" data-chart-label="${escapeHtml(`${item.symbol} sessions`)}"></div>
      </div>
      <aside class="session-guide">
        <div class="session-now">
          <span class="session-now-label">Now</span>
          <strong>${escapeHtml(item.current_session || "Between sessions")}</strong>
          <small>Next · ${escapeHtml(item.next_session || "—")}</small>
          <span class="session-focus">${escapeHtml(item.focus || "")}</span>
        </div>
        <div class="session-range-grid">${rangePills || `<p class="muted">No session ranges yet.</p>`}</div>
        <div class="session-expect">
          <h3>What to wait for</h3>
          ${expectHtml}
        </div>
        <p class="session-note muted">${escapeHtml(item.note || "")}</p>
      </aside>
    </div>`;
}

async function loadDeskSessionChart(item) {
  if (!item || !els.deskSessions) return;
  const host = els.deskSessions.querySelector(".session-chart-canvas[data-chart-url]");
  if (!host) return;
  const url = host.dataset.chartUrl;
  if (!url) return;
  await loadChartCanvas(host, url, `${item.symbol} sessions`, { force: true });
}

function projectionStatusLabel(status) {
  if (status === "bullish") return "Bullish draw";
  if (status === "bearish") return "Bearish draw";
  return "Neutral / wait";
}

function renderDeskPost(post) {
  const status = post.status || "waiting";
  const decision = post.decision || {};
  const checklist = post.checklist || decision.checklist || [];
  const context = post.context_summary || {};
  const checklistHtml = renderDeskChecklist(checklist);
  const tradeDecision = normalizeTradeDecision(post);
  return `
    <article class="desk-post crt-terminal desk-${escapeHtml(status)} decision-${escapeHtml(tradeDecision.type)}">
      ${marketBiasBarHtml(post)}
      <div class="crt-terminal-head">
        <div>
          <span class="terminal-kicker">${escapeHtml(post.profile || "CRT")}</span>
          <h3>${escapeHtml(marketDisplay(post.symbol))} · ${escapeHtml(post.context_timeframe)}→${escapeHtml(post.trigger_timeframe)}</h3>
        </div>
        <div class="terminal-priority">
          ${setupGradeHtml(post.framework || {}, post.grade)}
          <span class="desk-status ${escapeHtml(status)}">${escapeHtml(deskStatusLabel(status))}</span>
        </div>
      </div>
      ${setupRadarHtml(post)}
      <div class="crt-stage-grid">
        <section class="crt-chart-shell">
          <div class="crt-chart-toolbar">
            <span>MTF chart stack</span>
            ${deskChartMetaHtml(post)}
            <em>${escapeHtml(post.active_setup_model?.name || "CRT map")}</em>
          </div>
          ${mobileTradeStripHtml(post)}
          <div class="crt-chart-stage">
            <div class="desk-mtf-chart-grid">
              ${timeframeChartsHtml(post)}
            </div>
          </div>
          ${eventTimelineHtml(post)}
        </section>
        ${liquidityRoadmapHtml(post)}
      </div>
      <div class="crt-context-strip">
        ${po3LifecycleHtml(post.framework || {})}
        ${marketNarrativeChainHtml(post)}
      </div>
      <div class="crt-secondary-read">
        <div class="desk-context-card">
          <div class="desk-context-read">
            <span>Context</span>
            <strong>${escapeHtml(context.bias || directionLabel(post.bias))}</strong>
            <p>${escapeHtml(context.read || post.headline || "Waiting for context")}</p>
          </div>
        </div>
        ${checklistHtml}
        ${setupBreakdownHtml(post)}
      </div>
    </article>`;
}

function renderDeskChecklist(items) {
  const visibleItems = (items || []).filter((item) => item.key !== "session");
  if (!visibleItems.length) return "";
  return `
    <div class="desk-checklist">
      ${visibleItems.map((item) => {
        const status = item.status || "wait";
        return `
          <span class="desk-check ${escapeHtml(status)}">
            <b>${escapeHtml(status === "pass" ? "OK" : status === "block" ? "NO" : "WAIT")}</b>
            ${escapeHtml(item.label || item.key || "Check")}
          </span>`;
      }).join("")}
    </div>`;
}

function deskStatusLabel(status) {
  if (status === "ready") return "Ready";
  if (status === "armed") return "Armed";
  if (status === "blocked") return "Blocked";
  return "Waiting";
}

async function loadDeskCharts() {
  if (!els.deskFeed) return;
  const charts = [...els.deskFeed.querySelectorAll(".desk-chart[data-chart-url]")];
  await Promise.all(charts.map((el) => {
    const url = el.dataset.chartUrl;
    if (!url) return Promise.resolve(null);
    return loadChartCanvas(el, url, el.dataset.chartLabel || "chart", { force: true });
  }));
}

function profileLabel(alert) {
  const ctx = alert.context_timeframe || "";
  const tr = alert.trigger_timeframe || alert.timeframe || "";
  const tf = ctx && tr ? `${ctx}→${tr}` : tr || ctx || "—";
  return alert.profile ? `${alert.profile} · ${tf}` : tf;
}

function targetLevelFromAlert(alert) {
  const plan = alert?.trade_plan || {};
  if (plan.final_target != null) return plan.final_target;
  if (plan.htf_target != null) return plan.htf_target;
  const details = normalizeDetailLines(alert?.details || [], alert || {});
  const targetLine = findDetail(details, /^HTF target:/);
  if (!targetLine) return null;
  const text = String(targetLine);
  const targetText = text.includes("—") ? text.split("—").pop() : text;
  const match = targetText.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function freshnessLabel(alert) {
  const details = normalizeDetailLines(alert?.details || [], alert || {});
  const line = findDetail(details, /^Freshness:/);
  const text = stripDetailLabel(line);
  if (!text) return "";
  const limit = text.match(/within\s+(\d+)\s+\S+\s+bars/i);
  const age = text.match(/current age\s+(\d+)\s+bars/i);
  if (limit && age) return `Age ${age[1]}/${limit[1]} bars`;
  return text.length > 38 ? `${text.slice(0, 38)}...` : text;
}

function compactTriggerText(alert) {
  if (isCounterBiasAlert(alert)) return "Counter-bias blocked";
  const { trigger } = resolveAlertTimeframes(alert || {});
  const mode = String(alert?.trade_plan?.trigger_mode || "").toLowerCase();
  if ((alert?.stage || "") === "confirmed") {
    if (mode.includes("ifvg") || mode === "fvg") return `${trigger} FVG confluence only`;
    if (mode.includes("model1")) return `${trigger} Model #1 confirmed`;
    if (mode.includes("mss") || mode.includes("msb")) return `${trigger} MSS confirmed`;
    return `${trigger} trigger confirmed`;
  }
  return `Wait ${trigger} Model #1/MSS`;
}

function biasChipText(alert) {
  if (isCounterBiasAlert(alert)) return "Bias conflict";
  const plan = alert?.trade_plan || {};
  if (plan.htf_bias === "bullish") return "HTF bullish";
  if (plan.htf_bias === "bearish") return "HTF bearish";
  return "HTF check";
}

function tradeCardStateLabel(alert) {
  if (isCounterBiasAlert(alert)) return "No Trade";
  const stage = alert?.stage || "forming";
  if (stage === "confirmed") return "Active Plan";
  if (stage === "invalidated") return "Invalidated";
  return "Watchlist";
}

function tradeLevelItems(alert) {
  const plan = alert?.trade_plan || {};
  const target = targetLevelFromAlert(alert);
  const freshness = freshnessLabel(alert);
  if (plan.entry != null || plan.stop != null) {
    return [
      ["Entry", plan.entry],
      ["Invalid", plan.stop],
      ["TP1", plan.tp1],
      [plan.tp2_source ? `TP2 ${targetSourceLabel(plan.tp2_source)}` : "TP2", plan.tp2],
      ["Final draw", plan.final_target],
      ["RR", bestRr(plan) != null ? fmtRr(bestRr(plan)) : null],
    ].filter(([, value]) => value != null);
  }
  return [
    ["Turtle Soup", plan.reference_level],
    ["Sweep", plan.sweep_extreme],
    ["HTF draw", target],
    ["Window", freshness],
  ].filter(([, value]) => value != null && value !== "");
}

function journalPlanSnapshot(entry) {
  const plan = entry?.trade_plan || {};
  const parts = [];
  if (plan.entry != null) parts.push(`Plan ${fmtNum(plan.entry)}`);
  if (plan.stop != null) parts.push(`Invalid ${fmtNum(plan.stop)}`);
  if (plan.rr_final != null) parts.push(`Final ${fmtRr(plan.rr_final)}`);
  else if (plan.rr_tp2 != null) parts.push(`TP2 ${fmtRr(plan.rr_tp2)}`);
  return parts.join(" · ");
}

function journalOutcomeText(entry) {
  if ((entry.status || "pending") === "skipped") return entry.notes ? `Skipped: ${entry.notes}` : "Skipped setup";
  if ((entry.status || "pending") === "pending") return "Waiting for decision";
  if (entry.outcome === "open") {
    return entry.r_result != null ? `Open · running ${fmtR(entry.r_result)}` : "Open trade";
  }
  if (entry.r_result != null) return `${outcomeLabel(entry.outcome)} · ${fmtR(entry.r_result)}`;
  return outcomeLabel(entry.outcome || "none");
}

function tradeLevelsHtml(alert) {
  const items = tradeLevelItems(alert);
  if (!items.length) return "";
  return `
    <div class="trade-levels">
      ${items.map(([label, value]) => {
        const display = typeof value === "number" ? fmtNum(value) : String(value);
        return `
          <div class="trade-level">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(display)}</strong>
          </div>`;
      }).join("")}
    </div>`;
}

function tradeRoadmapHtml(alert) {
  const stage = alert?.stage || "forming";
  const firstDone = alert?.trade_plan?.reference_level != null;
  const triggerDone = stage === "confirmed";
  const stopped = stage === "invalidated";
  const steps = [
    ["Turtle Soup", firstDone ? "done" : "idle"],
    [triggerDone ? "Trigger confirmed" : "Trigger pending", triggerDone ? "done" : stopped ? "dead" : "pending"],
    [triggerDone ? "Manage plan" : "No entry", triggerDone ? "live" : stopped ? "dead" : "idle"],
  ];
  return `
    <div class="trade-roadmap" aria-label="Setup roadmap">
      ${steps.map(([label, cls]) => `<span class="trade-step ${cls}">${escapeHtml(label)}</span>`).join("")}
    </div>`;
}

function renderBlotterRow(alert) {
  const key = alert.alert_key || "";
  const selected = key && key === state.selectedAlertKey ? "selected" : "";
  const preview = alertPreviewLine(alert);
  const stage = alert.stage || "forming";
  const gradeInfo = setupGradeFromAlert(alert);
  const counterBias = isCounterBiasAlert(alert);
  const actionInfo = counterBias ? { ...(gradeInfo || {}), counterBias: true } : gradeInfo;
  const fw = alert.framework;
  const gradeCell = fw
    ? frameworkGradeBadge(fw)
    : gradeInfo?.grade
    ? `<span class="grade-badge ${gradeClass(gradeInfo.grade)}" title="${escapeHtml(gradeInfo.action || "")}">${escapeHtml(gradeInfo.grade)}</span>`
    : `<span class="muted">—</span>`;
  const action = alertActionText(alert, actionInfo);
  const confirmedPin = stage === "confirmed" ? `<span class="pin-label">Live Plan</span>` : "";
  const directionText = counterBias ? "NO TRADE" : directionLabel(alert.direction);
  const directionCls = counterBias ? "dir-no-trade" : directionClass(alert.direction);
  return `
    <div class="signal-card ${selected} ${escapeHtml(stage)} ${counterBias ? "counter-bias" : ""}" data-alert-key="${escapeHtml(key)}" data-select="1" title="Open">
      <div class="trade-card-kicker">
        <span>${escapeHtml(tradeCardStateLabel(alert))}</span>
        <span class="mono">${escapeHtml(compactTriggerText(alert))}</span>
      </div>
      <div class="signal-topline">
        <div>
          ${marketSymbolHtml(alert.symbol)}
          <span class="signal-time mono">${escapeHtml(fmtTime(alert.time))}</span>
        </div>
        <div class="signal-badges">
          ${confirmedPin}
          <span class="pill ${escapeHtml(stage)}">${escapeHtml(stageLabel(stage))}</span>
          ${gradeCell}
        </div>
      </div>
      <div class="signal-midline">
        <span class="${escapeHtml(directionCls)}">${escapeHtml(directionText)}</span>
        <span>${escapeHtml(profileLabel(alert))}</span>
        <span>${escapeHtml(biasChipText(alert))}</span>
        <span>${escapeHtml(riskLabel(alert))}</span>
      </div>
      <p class="signal-reason">${escapeHtml(preview)}</p>
      ${frameworkStripHtml(alert)}
      ${tradeLevelsHtml(alert)}
      ${tradeRoadmapHtml(alert)}
      <div class="signal-footer">
        <span class="next-action ${actionClass(actionInfo, stage)}">${escapeHtml(action)}</span>
        <div class="cell-actions" data-alert-key="${escapeHtml(key)}">
          <button type="button" class="icon-btn journal-mark ${alert.journal_status === "taken" ? "on" : ""}" data-status="taken" title="Taken">✓</button>
          <button type="button" class="icon-btn journal-mark ${alert.journal_status === "skipped" ? "off" : ""}" data-status="skipped" title="Skip">✕</button>
          <button type="button" class="icon-btn alert-dismiss" data-alert-id="${alert.id}" title="Hide">×</button>
        </div>
      </div>
    </div>`;
}

function renderBlotter(alerts) {
  state.alertsCache = alerts;
  const has = alerts.length > 0;
  if (els.blotterEmpty) els.blotterEmpty.classList.toggle("hidden", has);
  if (els.blotterBody) {
    const sortedAlerts = [...alerts].sort((a, b) => alertPriority(a) - alertPriority(b));
    els.blotterBody.innerHTML = has ? sortedAlerts.map(renderBlotterRow).join("") : "";
  }
  if (els.lastAlertChip) els.lastAlertChip.textContent = has ? fmtTime(alerts[0].time) : "—";

  if (state.modalOpen && state.selectedAlertKey) {
    const selected = alerts.find((a) => a.alert_key === state.selectedAlertKey);
    if (selected) {
      populateAlertModal(selected);
      const fp = chartFingerprint(selected);
      if (fp !== state.lastModalChartFingerprint) {
        state.lastModalChartFingerprint = fp;
        void setModalImages(selected, { force: true });
      }
    } else {
      closeAlertModal();
    }
  }
}

function buildAlertModalContent(alert) {
  const plan = alert.trade_plan || {};
  const status = alert.journal_status || "pending";
  const key = alert.alert_key || "";

  const levels = [
    ["Entry", plan.entry],
    ["Invalid", plan.stop],
    ["TP1", plan.tp1],
    [plan.tp2_source ? `TP2 · ${targetSourceLabel(plan.tp2_source)}` : "TP2", plan.tp2],
    ["Final draw", plan.final_target],
  ].filter(([, v]) => v != null);

  const rrTags = [];
  if (plan.rr_tp1 != null) rrTags.push(`TP1 ${fmtRr(plan.rr_tp1)}`);
  if (plan.rr_tp2 != null) rrTags.push(`TP2 ${fmtRr(plan.rr_tp2)}`);
  if (plan.rr_final != null) rrTags.push(`Final draw ${fmtRr(plan.rr_final)}`);

  const gradeInfo = setupGradeFromAlert(alert);
  const gradeBanner = gradeInfo?.grade
    ? `<div class="setup-grade-banner ${gradeClass(gradeInfo.grade)}">
        <strong class="setup-grade-letter">${escapeHtml(gradeInfo.grade)}</strong>
        <span>${escapeHtml(gradeInfo.action || "")}</span>
      </div>`
    : "";

  const detailHtml = `
    ${frameworkModalHtml(alert)}
    ${gradeBanner}
    ${buildAlertStoryHtml(alert)}
    <div class="detail-meta">${escapeHtml(formatAlertMeta(alert, status))}</div>
    ${rrTags.length ? `<div class="rr-row">${rrTags.map((t) => `<span class="rr-chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    ${levels.length ? `<div class="level-grid">${levels.map(([label, val]) => `
      <div class="level"><span>${escapeHtml(label)}</span><strong>${escapeHtml(fmtNum(val))}</strong></div>
    `).join("")}</div>` : ""}`;

  const footerHtml = key ? `
    <div class="action-row" data-alert-key="${escapeHtml(key)}">
      <button type="button" class="btn btn-outline journal-mark ${status === "taken" ? "active-taken" : ""}" data-status="taken">Taken</button>
      <button type="button" class="btn btn-outline journal-mark ${status === "skipped" ? "active-skipped" : ""}" data-status="skipped">Skip</button>
      ${status !== "pending" ? `<button type="button" class="btn btn-outline journal-mark" data-status="pending">Wait</button>` : ""}
      <button type="button" class="btn btn-go" data-open-journal-modal="${escapeHtml(key)}">Journal</button>
      <button type="button" class="btn btn-stop alert-dismiss" data-alert-id="${alert.id}">Hide</button>
    </div>
    <textarea class="note-input" placeholder="Note..." data-note-for="${escapeHtml(key)}">${escapeHtml(alert.journal_notes || "")}</textarea>
    <div class="action-row">
      <button type="button" class="btn btn-go journal-save" data-save-note="${escapeHtml(key)}">Save</button>
    </div>` : "";

  return { detailHtml, footerHtml };
}

function populateAlertModal(alert) {
  if (!alert) return;

  const stage = alert.stage || "forming";
  const status = alert.journal_status || "pending";
  const dirHead =
    stage === "forming"
      ? `${directionLabel(alert.direction)} setup · FORM`
      : directionLabel(alert.direction);

  if (els.modalTitle) els.modalTitle.textContent = `${marketDisplay(alert.symbol)} · ${dirHead}`;
  if (els.modalSubtitle) {
    const { context, trigger } = resolveAlertTimeframes(alert);
    const proxy = marketProxyNote(alert.symbol);
    els.modalSubtitle.textContent = `${alert.setup_name} · ${context} → ${trigger} · ${stageLabel(stage)} · ${fmtTime(alert.time)}${proxy ? ` · ${proxy}` : ""}`;
  }

  const { detailHtml, footerHtml } = buildAlertModalContent(alert);
  if (els.modalDetail) els.modalDetail.innerHTML = detailHtml;
  if (els.modalFooter) els.modalFooter.innerHTML = footerHtml;
}

function openAlertModal(alert) {
  ensureAlertModal();
  if (!alert) {
    showToast("Not found.");
    return;
  }
  if (!els.alertModal) {
    showToast("Refresh page.");
    return;
  }

  state.modalOpen = true;
  state.selectedAlertKey = alert.alert_key || null;
  document.body.classList.add("modal-open");
  els.alertModal.classList.remove("hidden");
  els.alertModal.setAttribute("aria-hidden", "false");

  if (els.blotterBody) {
    els.blotterBody.querySelectorAll("[data-select='1']").forEach((row) => {
      row.classList.toggle("selected", row.dataset.alertKey === state.selectedAlertKey);
    });
  }

  populateAlertModal(alert);
  state.lastModalChartFingerprint = chartFingerprint(alert);
  void setModalImages(alert, { force: false });
}

function closeAlertModal() {
  closeChartLightbox();
  state.modalOpen = false;
  state.lastModalChartFingerprint = null;
  document.body.classList.remove("modal-open");
  if (els.alertModal) {
    els.alertModal.classList.add("hidden");
    els.alertModal.setAttribute("aria-hidden", "true");
  }
  destroyModalCharts();
  if (els.modalDetail) els.modalDetail.innerHTML = "";
  if (els.modalFooter) els.modalFooter.innerHTML = "";
}

function journalEntryAsAlert(entry) {
  return {
    symbol: entry.symbol,
    setup_name: entry.setup_name,
    stage: entry.stage,
    direction: entry.direction,
    trade_plan: entry.trade_plan || {},
    candle_timestamp_ms: entry.candle_timestamp_ms,
    trigger_candle_timestamp_ms: entry.trigger_candle_timestamp_ms,
    updated_at: entry.updated_at,
    time: entry.time,
    context_timeframe: entry.context_timeframe,
    trigger_timeframe: entry.trigger_timeframe,
    timeframe: entry.timeframe,
    details: entry.details || [],
  };
}

async function setJournalModalImages(entry, { force = false } = {}) {
  const alert = journalEntryAsAlert(entry);
  const { context, trigger } = resolveAlertTimeframes(alert);

  if (els.jmTriggerLabel) els.jmTriggerLabel.textContent = `${trigger} · confirmation`;
  if (els.jmContextLabel) els.jmContextLabel.textContent = `${context} · HTF context`;
  if (els.jmContextPane) {
    els.jmContextPane.classList.toggle("hidden", !context || context === trigger);
  }

  const triggerUrl = chartImageUrl(alert, trigger, "trigger");
  const contextUrl = chartImageUrl(alert, context, "context");
  await Promise.all([
    loadChartCanvas(els.jmShotTrigger, triggerUrl, trigger, { force }),
    context && context !== trigger
      ? loadChartCanvas(els.jmShotContext, contextUrl, context, { force })
      : Promise.resolve(null),
  ]);
}

function clearJournalModalImages() {
  for (const el of [els.jmShotContext, els.jmShotTrigger]) {
    if (el) {
      delete el.dataset.chartUrl;
      delete el.dataset.loadingUrl;
      el.innerHTML = "";
    }
  }
}

function buildJournalModalContent(entry, draftStatus) {
  const plan = entry.trade_plan || {};
  const key = entry.alert_key || "";
  const status = draftStatus || entry.status || "pending";
  const archived = isArchivedJournalEntry(entry) || status === "skipped";
  const gradeInfo = setupGradeFromEntry(entry);
  const storyAlert = journalEntryAsAlert(entry);
  const storyHtml = (entry.details || []).length ? buildAlertStoryHtml(storyAlert) : "";
  const plannedEntry = plan.entry;
  const actualEntry = entry.actual_entry;
  const plannedStop = plan.stop;
  const actualExit = entry.actual_exit;
  const rResult = entry.r_result;
  const pnlPct = entry.pnl_pct;

  const gradeBanner = gradeInfo?.grade
    ? `<div class="setup-grade-banner ${gradeClass(gradeInfo.grade)}">
        <strong class="setup-grade-letter">${escapeHtml(gradeInfo.grade)}</strong>
        <span>${escapeHtml(gradeInfo.action || "")}</span>
      </div>`
    : "";

  const levels = [
    ["Entry", plan.entry],
    ["Invalid", plan.stop],
    ["TP1", plan.tp1],
    [plan.tp2_source ? `TP2 · ${targetSourceLabel(plan.tp2_source)}` : "TP2", plan.tp2],
    ["Final draw", plan.final_target],
  ].filter(([, v]) => v != null);

  const detailHtml = `
    ${gradeBanner}
    <div class="journal-review-strip">
      <div><span>Status</span><strong class="${statusClass(status)}">${escapeHtml(archived ? "Archived" : journalLabel(status))}</strong></div>
      <div><span>Outcome</span><strong class="${outcomeClass(entry.outcome)}">${escapeHtml(outcomeLabel(entry.outcome || "none"))}</strong></div>
      <div><span>R result</span><strong class="${journalMetricClass(rResult)}">${rResult == null ? "—" : fmtR(rResult)}</strong></div>
      <div><span>PnL %</span><strong class="${journalMetricClass(pnlPct)}">${pnlPct == null ? "—" : fmtPct(pnlPct)}</strong></div>
    </div>
    <div class="compare-grid journal-compare">
      <div class="compare-cell plan"><span>Planned entry</span><strong>${plannedEntry == null ? "—" : fmtNum(plannedEntry)}</strong></div>
      <div class="compare-cell actual"><span>Actual entry</span><strong>${actualEntry == null ? "—" : fmtNum(actualEntry)}</strong></div>
      <div class="compare-cell result ${journalMetricClass(rResult)}"><span>Result</span><strong>${rResult == null ? "—" : fmtR(rResult)}</strong></div>
      <div class="compare-cell plan"><span>Invalidation</span><strong>${plannedStop == null ? "—" : fmtNum(plannedStop)}</strong></div>
      <div class="compare-cell actual"><span>Exit</span><strong>${actualExit == null ? "—" : fmtNum(actualExit)}</strong></div>
      <div class="compare-cell result ${journalMetricClass(pnlPct)}"><span>PnL</span><strong>${pnlPct == null ? "—" : fmtPct(pnlPct)}</strong></div>
    </div>
    ${storyHtml}
    ${levels.length ? `<div class="level-grid">${levels.map(([label, val]) => `
      <div class="level"><span>${escapeHtml(label)}</span><strong>${escapeHtml(fmtNum(val))}</strong></div>
    `).join("")}</div>` : ""}`;

  const outcomeOptions = Object.entries(OUTCOME_LABELS)
    .filter(([value]) => value !== "none")
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${entry.outcome === value ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");

  let tradeFields = "";
  if (status === "taken") {
    tradeFields = `
      <div class="form-grid journal-form-grid">
        <div class="form-field">
          <label for="jm-entry">Entry</label>
          <input id="jm-entry" name="actual_entry" type="number" step="any" value="${entry.actual_entry ?? ""}" placeholder="${escapeHtml(String(plan.entry ?? ""))}">
    </div>
        <div class="form-field">
          <label for="jm-exit">Exit</label>
          <input id="jm-exit" name="actual_exit" type="number" step="any" value="${entry.actual_exit ?? ""}">
        </div>
        <div class="form-field">
          <label for="jm-size">Size</label>
          <input id="jm-size" name="position_size" type="number" step="any" value="${entry.position_size ?? ""}">
        </div>
        <div class="form-field">
          <label for="jm-r">R</label>
          <input id="jm-r" name="r_result" type="number" step="any" value="${entry.r_result ?? ""}" placeholder="Auto">
        </div>
        <div class="form-field">
          <label for="jm-pnl">PnL %</label>
          <input id="jm-pnl" name="pnl_pct" type="number" step="any" value="${entry.pnl_pct ?? ""}" placeholder="Auto">
        </div>
        <div class="form-field">
          <label for="jm-outcome">Result</label>
          <select id="jm-outcome" name="outcome">
            <option value="none" ${entry.outcome === "none" || !entry.outcome ? "selected" : ""}>—</option>
            ${outcomeOptions}
          </select>
        </div>
        <div class="form-field span-2">
          <label for="jm-exit-reason">Reason</label>
          <select id="jm-exit-reason" name="exit_reason">
            ${Object.entries(EXIT_REASONS).map(([value, label]) =>
              `<option value="${escapeHtml(value)}" ${entry.exit_reason === value ? "selected" : ""}>${escapeHtml(label)}</option>`
            ).join("")}
          </select>
        </div>
      </div>`;
  }

  const decisionHtml = status === "pending" ? `
      <div class="action-row decision-row">
        <button type="button" class="btn btn-outline jd-status active-pending" data-status="pending">Wait</button>
        <button type="button" class="btn btn-outline jd-status" data-status="taken">Taken</button>
        <button type="button" class="btn btn-outline jd-status" data-status="skipped">Skip</button>
      </div>` : "";

  const footerHtml = archived ? `
    <form class="journal-form archived-review" data-alert-key="${escapeHtml(key)}" data-current-status="${escapeHtml(status)}">
      <div class="archive-note">
        <strong>Archived setup</strong>
        <span>This setup is no longer active. No Taken / Skip decision is needed.</span>
      </div>
      <textarea class="note-input" name="notes" placeholder="Review note...">${escapeHtml(entry.notes || "")}</textarea>
      <div class="action-row">
        <button type="submit" class="btn btn-go">Save note</button>
      </div>
    </form>` : `
    <form class="journal-form" data-alert-key="${escapeHtml(key)}" data-current-status="${escapeHtml(status)}">
      ${decisionHtml}
      ${tradeFields}
      <textarea class="note-input" name="notes" placeholder="${status === "skipped" ? "Why skip?" : "Note..."}">${escapeHtml(entry.notes || "")}</textarea>
      <div class="action-row">
        ${status === "taken" ? `<button type="button" class="btn btn-outline" data-auto-r="1">Auto R</button>` : ""}
        <button type="submit" class="btn btn-go">Save</button>
      </div>
    </form>`;

  return { detailHtml, footerHtml };
}

function populateJournalModal(entry, draftStatus) {
  if (!entry) return;

  const gradeInfo = setupGradeFromEntry(entry);
  if (els.jmTitle) {
    els.jmTitle.textContent = `${marketDisplay(entry.symbol)} · ${directionLabel(entry.direction)}`;
  }
  if (els.jmSubtitle) {
    const gradePart = gradeInfo?.grade ? ` · ${gradeInfo.grade}` : "";
    const proxy = marketProxyNote(entry.symbol);
    els.jmSubtitle.textContent = `${setupDisplayName(entry.setup_name)} · ${stageLabel(entry.stage)} · ${fmtTime(entry.time)}${gradePart}${proxy ? ` · ${proxy}` : ""}`;
  }

  const { detailHtml, footerHtml } = buildJournalModalContent(entry, draftStatus);
  if (els.jmDetail) els.jmDetail.innerHTML = detailHtml;
  if (els.jmFooter) els.jmFooter.innerHTML = footerHtml;
}

function openJournalModal(entry) {
  if (!entry || !els.journalModal) return;
  state.journalModalOpen = true;
  state.selectedJournalKey = entry.alert_key || null;
  state.lastJournalChartFingerprint = chartFingerprint(journalEntryAsAlert(entry));
  document.body.classList.add("modal-open");
  els.journalModal.classList.remove("hidden");
  els.journalModal.setAttribute("aria-hidden", "false");
  populateJournalModal(entry);
  void setJournalModalImages(entry, { force: false });

  if (els.journalBody) {
    els.journalBody.querySelectorAll("[data-journal-select]").forEach((row) => {
      row.classList.toggle("selected", row.dataset.journalKey === state.selectedJournalKey);
    });
  }
}

function closeJournalModal() {
  closeChartLightbox();
  state.journalModalOpen = false;
  state.lastJournalChartFingerprint = null;
  document.body.classList.remove("modal-open");
  if (els.journalModal) {
    els.journalModal.classList.add("hidden");
    els.journalModal.setAttribute("aria-hidden", "true");
  }
  clearJournalModalImages();
  if (els.jmDetail) els.jmDetail.innerHTML = "";
  if (els.jmFooter) els.jmFooter.innerHTML = "";
}

function renderJournalRow(entry) {
  const key = entry.alert_key || "";
  const selected = key === state.selectedJournalKey ? "selected" : "";
  const status = entry.status || "pending";
  const archived = isArchivedJournalEntry(entry) || status === "skipped";
  const rResult = entry.r_result;
  const gradeInfo = setupGradeFromEntry(entry);
  const planSnapshot = journalPlanSnapshot(entry);
  const outcomeText = journalOutcomeText(entry);
  const note = String(entry.notes || "").trim();
  const route = [entry.profile, entry.context_timeframe && entry.trigger_timeframe ? `${entry.context_timeframe}→${entry.trigger_timeframe}` : entry.timeframe].filter(Boolean).join(" · ");
  const proxy = marketProxyNote(entry.symbol);
  const marketLine = proxy ? `${marketDisplay(entry.symbol)} · ${entry.symbol}` : marketDisplay(entry.symbol);
  const gradeCell = gradeInfo?.grade
    ? `<span class="grade-badge ${gradeClass(gradeInfo.grade)}" title="${escapeHtml(gradeInfo.action || "")}">${escapeHtml(gradeInfo.grade)}</span>`
    : `<span class="muted">—</span>`;

  let rCell = `<span class="muted">—</span>`;
  if (status === "taken") {
    if (rResult != null) {
      rCell = `<strong class="${Number(rResult) >= 0 ? "dir-long" : "dir-short"}">${escapeHtml(fmtR(rResult))}</strong>`;
    } else if (entry.outcome && entry.outcome !== "none") {
      rCell = `<span class="${outcomeClass(entry.outcome)}">${escapeHtml(outcomeLabel(entry.outcome))}</span>`;
    } else {
      rCell = `<span class="status-open">Open</span>`;
    }
  }
  const actionHtml = archived
    ? `<span class="archive-label">Archived</span>`
    : status === "pending"
      ? `<div class="cell-actions" data-alert-key="${escapeHtml(key)}">
          <button type="button" class="icon-btn journal-mark ${status === "taken" ? "on" : ""}" data-status="taken" title="Taken">✓</button>
          <button type="button" class="icon-btn journal-mark ${status === "skipped" ? "off" : ""}" data-status="skipped" title="Skip">✕</button>
        </div>`
      : `<span class="archive-label live">Manage trade</span>`;

  return `
    <div class="journal-card ${selected} status-${escapeHtml(status)} ${archived ? "archived" : ""}" data-journal-select="1" data-journal-key="${escapeHtml(key)}" title="Open">
      <div class="journal-card-main">
        <div>
          <strong class="journal-symbol">${escapeHtml(marketLine)}</strong>
          <span class="journal-time mono">${escapeHtml(fmtTime(entry.time))}</span>
        </div>
        <div class="journal-result">
          <span class="mono">${rCell}</span>
          <span class="${statusClass(status)}">${escapeHtml(archived ? "Archived" : journalLabel(status))}</span>
        </div>
      </div>
      <div class="journal-card-meta">
        <span class="${directionClass(entry.direction)}">${escapeHtml(directionLabel(entry.direction))}</span>
        ${gradeCell}
        <span class="${outcomeClass(entry.outcome)}">${escapeHtml(outcomeText)}</span>
        ${route ? `<span class="mono">${escapeHtml(route)}</span>` : ""}
      </div>
      ${(planSnapshot || note) ? `<p class="journal-note-line">${escapeHtml((note || planSnapshot).slice(0, 92))}${(note || planSnapshot).length > 92 ? "..." : ""}</p>` : ""}
      <div class="journal-card-actions">
        ${actionHtml}
      </div>
    </div>`;
}

function populateJournalFilters(filters) {
  if (!filters || !els.journalSymbolFilter) return;
  const current = state.journalSymbol;
  els.journalSymbolFilter.innerHTML = `<option value="">Symbols</option>${(filters.symbols || [])
    .map((s) => `<option value="${escapeHtml(s)}" ${s === current ? "selected" : ""}>${escapeHtml(s)}</option>`)
    .join("")}`;
}

function renderJournal(payload) {
  const rawEntries = payload.entries || [];
  const entries = filterJournalEntries(rawEntries, state.journalFilter);
  const counts = payload.counts || {};
  state.journalCache = entries;
  state.journalStats = payload.stats || null;

  if (els.journalChip) els.journalChip.textContent = `${entries.length}`;
  renderJournalHeroStats(payload.stats);
  renderJournalStats(payload.stats, counts);
  if (els.journalSummary) {
    els.journalSummary.textContent = journalSummaryText(payload.stats, counts) || "No records.";
  }
  renderJournalReviewPanel(payload.stats, counts);
  renderJournalEdge(payload.stats);

  populateJournalFilters(payload.filters);

  const has = entries.length > 0;
  if (els.journalEmpty) {
    els.journalEmpty.classList.toggle("hidden", has);
    if (els.journalEmptyHint) {
      els.journalEmptyHint.textContent = journalEmptyHintForFilter(state.journalFilter);
    }
  }
  if (els.journalBody) {
    const rowsHtml = has ? entries.map(renderJournalRow).join("") : "";
    if (state.journalRowsHtml !== rowsHtml) {
      els.journalBody.innerHTML = rowsHtml;
      state.journalRowsHtml = rowsHtml;
    }
  }

  if (state.journalModalOpen && state.selectedJournalKey) {
    const openEntry = entries.find((e) => e.alert_key === state.selectedJournalKey);
    if (!openEntry) {
      closeJournalModal();
      return;
    }
    const fp = chartFingerprint(journalEntryAsAlert(openEntry));
    if (fp !== state.lastJournalChartFingerprint) {
      state.lastJournalChartFingerprint = fp;
      populateJournalModal(openEntry);
      void setJournalModalImages(openEntry, { force: true });
    }
  }
}

function renderActivity(payload) {
  const current = payload.current || {};
  const events = payload.events || [];
  const phase = current.phase || "idle";
  const scanning = state.scanInProgress;

  if (els.activityChip) {
    els.activityChip.textContent = scanning ? "Scanning" : (PHASE_LABELS[phase] || phase);
  }
  if (els.activityCurrent) {
    const currentMessage = compactAppText(current.message || (scanning ? "Scanning" : "Ready"));
    const currentDetail = compactAppText(current.detail || (scanning ? "Live steps." : "Start or scan once."));
    els.activityCurrent.innerHTML = `
      <strong>${escapeHtml(currentMessage)}</strong>
      <p>${escapeHtml(currentDetail)}</p>
      ${diagnosticMiniHtml(current.diagnostic)}`;
  }
  if (els.activityFeed) {
    els.activityFeed.innerHTML = events.length
      ? events.slice(0, 24).map((e) => `
          <div class="feed-row">
            <span class="feed-time">${escapeHtml(fmtLogTime(e.time))}</span>
            <span>
              ${escapeHtml(compactAppText(e.message || ""))}
              ${e.diagnostic?.headline ? `<small>${escapeHtml(e.diagnostic.headline)}</small>` : ""}
            </span>
          </div>`).join("")
      : `<p class="muted">No steps yet.</p>`;
  }
}

function diagnosticMiniHtml(diagnostic) {
  if (!diagnostic) return "";
  const checks = diagnostic.checks || [];
  const dirs = diagnostic.directions || [];
  const next = diagnostic.next_steps || [];
  const checkHtml = checks.slice(0, 4).map((item) => `
    <span class="diag-chip ${escapeHtml(item.status || "info")}">
      ${escapeHtml(item.label || "Check")}: ${escapeHtml(item.detail || "")}
    </span>`).join("");
  const dirHtml = dirs.slice(0, 2).map((item) => {
    const side = item.direction === "bullish" ? "LONG" : item.direction === "bearish" ? "SHORT" : "SIDE";
    const target = item.objective?.level != null ? fmtNum(item.objective.level) : "—";
    return `
      <div class="diag-direction">
        <strong>${escapeHtml(side)}</strong>
        <span>Draw ${escapeHtml(target)} · ${escapeHtml(item.alignment || "HTF")}</span>
        <small>${escapeHtml(item.next_step || "")}</small>
      </div>`;
  }).join("");
  const nextHtml = next.length ? `<p class="diag-next">${escapeHtml(next[0])}</p>` : "";
  return `
    <div class="diagnostic-mini">
      ${checkHtml ? `<div class="diag-chips">${checkHtml}</div>` : ""}
      ${dirHtml}
      ${nextHtml}
    </div>`;
}

function compactAppText(value) {
  return String(value || "")
    .replace("Idle. Start the engine or run a one-off scan.", "Idle")
    .replace("Start the engine or run a one-off scan.", "Start or scan once.")
    .replace("The scanner will show which symbol, strategy, and timeframe it is checking here.", "Waiting for scan.")
    .replace("Scan in progress...", "Scanning")
    .trim();
}

function appendLogs(payload) {
  if (!els.logs) return;
  const logs = payload.logs || [];
  if (!logs.length) return;
  const nearBottom = els.logs.scrollTop + els.logs.clientHeight >= els.logs.scrollHeight - 20;
  for (const log of logs) {
    state.lastLogId = Math.max(state.lastLogId, log.id);
    const row = document.createElement("div");
    row.className = "log-row";
    row.innerHTML = `
      <span>${escapeHtml(fmtLogTime(log.time))}</span>
      <span class="log-level ${escapeHtml(log.level)}">${escapeHtml(log.level)}</span>
      <span>${escapeHtml(log.message)}</span>`;
    els.logs.appendChild(row);
  }
  while (els.logs.children.length > 300) els.logs.removeChild(els.logs.firstChild);
  if (nearBottom) els.logs.scrollTop = els.logs.scrollHeight;
  if (els.logChip) els.logChip.textContent = String(state.lastLogId);
}

function journalQuery() {
  const params = new URLSearchParams();
  if (state.journalFilter === "open") {
    params.set("status", "taken");
    params.set("outcome", "open");
  } else if (state.journalFilter === "taken") {
    params.set("status", "taken");
  } else if (state.journalFilter === "archive" || state.journalFilter === "skipped") {
    params.set("status", "skipped");
  } else if (state.journalFilter && !["review", "all"].includes(state.journalFilter)) {
    params.set("status", state.journalFilter);
  }
  if (state.journalSymbol) params.set("symbol", state.journalSymbol);
  if (state.journalOutcome && state.journalFilter !== "open") params.set("outcome", state.journalOutcome);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function readJournalForm(form) {
  const data = new FormData(form);
  const payload = {
    status: form.dataset.currentStatus || undefined,
    notes: data.get("notes") ?? "",
    actual_entry: data.get("actual_entry") || null,
    actual_exit: data.get("actual_exit") || null,
    position_size: data.get("position_size") || null,
    r_result: data.get("r_result") || null,
    pnl_pct: data.get("pnl_pct") || null,
    outcome: data.get("outcome") || "none",
    exit_reason: data.get("exit_reason") || "",
  };
  if (!payload.status) delete payload.status;
  return payload;
}

async function dismissAlert(alertId) {
  const dismissedKey = state.alertsCache.find((a) => a.id === alertId)?.alert_key;
  const result = await api(`/api/alerts/${alertId}/dismiss`, { method: "POST" });
  showToast(result.message || "Hidden.");
  if (dismissedKey && dismissedKey === state.selectedAlertKey) {
    state.selectedAlertKey = null;
    closeAlertModal();
  }
  await Promise.all([refreshAlerts(), refreshStatus()]);
}

async function updateJournalEntry(alertKey, payload) {
  const result = await api(`/api/journal/${encodeURIComponent(alertKey)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (result.ok === false) {
    showToast(result.message || "Save failed.");
    return null;
  }
  showToast(result.message || "Saved");
  await Promise.all([refreshAlerts(), refreshJournal(), refreshStatus()]);
  return result.entry;
}

async function refreshStatus() {
  const res = await apiSafe("/api/status");
  if (res.ok) {
    renderStatus(res.data);
    setBootError("");
    return res.data;
  }
  setBootError(`API offline: ${res.error}`);
  return null;
}

async function refreshLiveDuringScan() {
  await Promise.all([refreshStatus(), refreshActivity(), refreshLogs(), refreshAlerts()]);
}

async function refreshConfig() {
  const res = await apiSafe("/api/config");
  if (res.ok) renderConfig(res.data);
}

async function refreshAlerts() {
  const res = await apiSafe("/api/alerts");
  if (!res.ok) return;
  renderBlotter(res.data.alerts || []);
}

async function refreshJournal() {
  const res = await apiSafe(`/api/journal${journalQuery()}`);
  if (res.ok) renderJournal(res.data);
}

async function refreshActivity() {
  const res = await apiSafe("/api/activity");
  if (res.ok) renderActivity(res.data);
}

async function refreshDesk({ force = false } = {}) {
  if (!els.deskFeed || (state.deskLoading && !force)) return;
  state.deskLoading = true;
  if (els.deskRefreshBtn) {
    els.deskRefreshBtn.disabled = true;
    els.deskRefreshBtn.textContent = "Refreshing";
  }
  if (!state.deskCache.length && els.deskFeed) {
    els.deskFeed.innerHTML = `<div class="desk-state">Building local ICT desk notes...</div>`;
  }
  try {
    const res = await apiSafe(`/api/desk${force ? "?refresh=1" : ""}`);
    if (res.ok) {
      renderDesk(res.data);
    } else if (els.deskFeed) {
      els.deskFeed.innerHTML = `<div class="desk-state">Desk offline: ${escapeHtml(res.error || "request failed")}</div>`;
    }
  } finally {
    state.deskLoading = false;
    if (els.deskRefreshBtn) {
      els.deskRefreshBtn.disabled = false;
      els.deskRefreshBtn.textContent = "Refresh Desk";
    }
  }
}

async function refreshLogs() {
  const res = await apiSafe(`/api/logs?since=${state.lastLogId}`);
  if (res.ok) appendLogs(res.data);
}

async function runReplay() {
  if (state.replayRunning) return;
  state.replayRunning = true;
  if (els.replayBtn) {
    els.replayBtn.disabled = true;
    els.replayBtn.textContent = "Running";
  }
  if (els.replayResults) {
    els.replayResults.innerHTML = `<p class="muted">Replaying recent candles...</p>`;
  }
  try {
    const bars = Number(els.replayBars?.value || 120);
    const result = await api("/api/replay", {
      method: "POST",
      body: JSON.stringify({ bars }),
    });
    renderReplay(result);
  } catch (error) {
    if (els.replayResults) {
      els.replayResults.innerHTML = `<p class="muted">Replay failed: ${escapeHtml(error.message)}</p>`;
    }
  } finally {
    state.replayRunning = false;
    if (els.replayBtn) {
      els.replayBtn.disabled = false;
      els.replayBtn.textContent = "Run Replay";
    }
  }
}

function renderReplay(result) {
  if (!els.replayResults) return;
  if (!result?.ok) {
    els.replayResults.innerHTML = `<p class="muted">${escapeHtml(result?.message || "Replay failed.")}</p>`;
    return;
  }
  const totals = result.totals || {};
  const findings = result.findings || [];
  const summaries = result.summaries || [];
  const summaryRows = summaries.slice(0, 10).map((item) => `
    <div class="replay-row">
      <strong>${escapeHtml(item.symbol)} · ${escapeHtml(item.profile || "profile")}</strong>
      <span>${escapeHtml(item.context_timeframe)}→${escapeHtml(item.trigger_timeframe)}</span>
      <span>F ${Number(item.counts?.forming || 0)}</span>
      <span>C ${Number(item.counts?.confirmed || 0)}</span>
    </div>`).join("");
  const findingRows = findings.slice(0, 8).map((item) => `
    <div class="replay-finding">
      <strong>${escapeHtml(item.symbol)} ${escapeHtml(directionLabel(item.direction))}</strong>
      <span>${escapeHtml(stageLabel(item.stage))} · ${escapeHtml(item.profile || "")} · ${escapeHtml(fmtTime(item.time))}</span>
      <small>${escapeHtml(item.summary || "")}</small>
    </div>`).join("");
  els.replayResults.innerHTML = `
    <div class="replay-total">
      <span>Forming <strong>${Number(totals.forming || 0)}</strong></span>
      <span>Confirmed <strong>${Number(totals.confirmed || 0)}</strong></span>
      <span>Invalid <strong>${Number(totals.invalidated || 0)}</strong></span>
    </div>
    ${summaryRows ? `<div class="replay-table">${summaryRows}</div>` : ""}
    ${findingRows ? `<div class="replay-findings">${findingRows}</div>` : `<p class="muted">No historical triggers in this window.</p>`}
  `;
}

async function refreshAll() {
  if (state.cloudReadOnly) {
    await Promise.all([refreshStatus(), refreshConfig()]);
    if (state.activeView !== "desk") switchView("desk");
    return;
  }
  await Promise.all([
    refreshStatus(),
    refreshConfig(),
    refreshAlerts(),
    refreshJournal(),
    refreshActivity(),
    refreshLogs(),
  ]);
}

function switchView(viewId) {
  if (state.cloudReadOnly && viewId !== "desk") viewId = "desk";
  state.activeView = viewId;
  document.body.classList.remove("view-signals", "view-desk", "view-journal", "view-config");
  document.body.classList.add(`view-${viewId}`);
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  els.views.forEach((view) => view.classList.toggle("active", view.dataset.view === viewId));
  if (viewId === "desk") refreshDesk();
  if (viewId === "journal") refreshJournal();
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.view));
});

if (els.journalSymbolFilter) {
  els.journalSymbolFilter.addEventListener("change", async () => {
    state.journalSymbol = els.journalSymbolFilter.value;
    closeJournalModal();
    await refreshJournal();
  });
}

if (els.journalOutcomeFilter) {
  els.journalOutcomeFilter.addEventListener("change", async () => {
    state.journalOutcome = els.journalOutcomeFilter.value;
    closeJournalModal();
    await refreshJournal();
  });
}

els.journalFilters.forEach((btn) => {
  btn.addEventListener("click", async () => {
    state.journalFilter = btn.dataset.filter || "review";
    closeJournalModal();
    els.journalFilters.forEach((b) => b.classList.toggle("active", b === btn));
    await refreshJournal();
  });
});

if (els.startBtn) els.startBtn.addEventListener("click", () => postAction("/api/start"));
if (els.stopBtn) els.stopBtn.addEventListener("click", () => postAction("/api/stop"));
if (els.scanBtn) els.scanBtn.addEventListener("click", () => postAction("/api/scan-once"));
if (els.replayBtn) els.replayBtn.addEventListener("click", () => runReplay());
if (els.deskRefreshBtn) els.deskRefreshBtn.addEventListener("click", () => refreshDesk({ force: true }));

document.addEventListener("click", async (event) => {
  const deskSessionTab = event.target.closest("[data-desk-session-symbol]");
  if (deskSessionTab) {
    state.deskSessionSymbol = deskSessionTab.dataset.deskSessionSymbol || "";
    if (state.deskPayload?.session_projection) {
      renderDeskSessions(state.deskPayload.session_projection);
    }
    return;
  }

  const deskMarketBtn = event.target.closest(".desk-market-btn");
  if (deskMarketBtn) {
    state.deskSymbol = deskMarketBtn.dataset.deskSymbol || "";
    if (state.deskPayload) renderDesk(state.deskPayload);
    return;
  }

  const closeChartLightboxBtn = event.target.closest("[data-close-chart-lightbox]");
  if (closeChartLightboxBtn) {
    closeChartLightbox();
    return;
  }

  const chartCanvas = event.target.closest(".screenshot-canvas.expandable-chart");
  if (chartCanvas && chartCanvas.querySelector("svg")) {
    openChartLightbox(chartCanvas);
    return;
  }

  const jRow = event.target.closest("[data-journal-select='1']");
  if (jRow && !event.target.closest(".journal-mark")) {
    const entry = state.journalCache.find((e) => e.alert_key === jRow.dataset.journalKey);
    if (entry) openJournalModal(entry);
    return;
  }

  const openJournalModalBtn = event.target.closest("[data-open-journal-modal]");
  if (openJournalModalBtn) {
    const key = openJournalModalBtn.dataset.openJournalModal;
    let entry = state.journalCache.find((e) => e.alert_key === key);
    if (!entry) {
      const alert = state.alertsCache.find((a) => a.alert_key === key);
      if (alert) {
        entry = {
          alert_key: key,
          symbol: alert.symbol,
          direction: alert.direction,
          stage: alert.stage,
          setup_name: alert.setup_name,
          timeframe: alert.timeframe,
          time: alert.time,
          status: alert.journal_status || "pending",
          notes: alert.journal_notes || "",
          trade_plan: alert.trade_plan || {},
          context_timeframe: alert.context_timeframe,
          trigger_timeframe: alert.trigger_timeframe,
          candle_timestamp_ms: alert.candle_timestamp_ms,
          details: alert.details || [],
        };
      }
    }
    if (entry) {
      closeAlertModal();
      openJournalModal(entry);
    }
    return;
  }

  const closeJournalModalBtn = event.target.closest("[data-close-journal-modal]");
  if (closeJournalModalBtn) {
    closeJournalModal();
    return;
  }

  const row = event.target.closest("[data-select='1']");
  if (row && !event.target.closest(".journal-mark") && !event.target.closest(".alert-dismiss")) {
    const alert = findAlertFromRow(row);
    if (alert) {
      state.selectedAlertKey = alert.alert_key || null;
      openAlertModal(alert);
    } else {
      showToast("Open failed.");
    }
    return;
  }

  const closeModal = event.target.closest("[data-close-modal]");
  if (closeModal) {
    closeAlertModal();
    return;
  }

  if (event.target.closest(".quick-scan")) {
    await postAction("/api/scan-once");
    return;
  }

  const dismiss = event.target.closest(".alert-dismiss");
  if (dismiss) {
    event.stopPropagation();
    const alertId = Number(dismiss.dataset.alertId);
    if (alertId) await dismissAlert(alertId);
    return;
  }

  const jdStatus = event.target.closest(".jd-status");
  if (jdStatus) {
    const form = jdStatus.closest(".journal-form");
    const alertKey = form?.dataset.alertKey;
    if (!alertKey) return;
    const newStatus = jdStatus.dataset.status;
    const entry = state.journalCache.find((e) => e.alert_key === alertKey);
    if (entry) populateJournalModal(entry, newStatus);
    return;
  }

  const autoR = event.target.closest("[data-auto-r]");
  if (autoR) {
    const form = autoR.closest(".journal-form");
    const alertKey = form?.dataset.alertKey;
    if (!alertKey) return;
    const payload = readJournalForm(form);
    payload.auto_compute = true;
    if (form.dataset.currentStatus) payload.status = form.dataset.currentStatus;
    const entry = await updateJournalEntry(alertKey, payload);
    if (entry) populateJournalModal(entry);
    return;
  }

  const mark = event.target.closest(".journal-mark");
  if (mark) {
    event.stopPropagation();
    const wrap = mark.closest("[data-alert-key]");
    const alertKey = wrap?.dataset.alertKey;
    if (alertKey) {
      const noteEl = document.querySelector(`[data-note-for="${CSS.escape(alertKey)}"]`);
      await updateJournalEntry(alertKey, {
        status: mark.dataset.status,
        notes: noteEl ? noteEl.value : undefined,
      });
    }
    return;
  }

  const save = event.target.closest(".journal-save");
  if (save) {
    event.stopPropagation();
    const alertKey = save.dataset.saveNote;
    const noteEl = document.querySelector(`[data-note-for="${CSS.escape(alertKey)}"]`);
    const row = save.closest("[data-status]");
    if (alertKey && noteEl) {
      await updateJournalEntry(alertKey, {
        status: row?.dataset.status || undefined,
        notes: noteEl.value,
      });
    }
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".journal-form");
  if (!form) return;
  event.preventDefault();
  const alertKey = form.dataset.alertKey;
  if (!alertKey) return;
  const payload = readJournalForm(form);
  if (form.dataset.currentStatus) payload.status = form.dataset.currentStatus;
  else {
    const entry = state.journalCache.find((e) => e.alert_key === alertKey);
    if (entry?.status) payload.status = entry.status;
  }
  const entry = await updateJournalEntry(alertKey, payload);
  if (entry) {
    state.selectedJournalKey = alertKey;
    populateJournalModal(entry, payload.status || entry.status);
  }
});

document.addEventListener("keydown", (event) => {
  const chartCanvas = event.target.closest?.(".screenshot-canvas.expandable-chart");
  if ((event.key === "Enter" || event.key === " ") && chartCanvas && chartCanvas.querySelector("svg")) {
    event.preventDefault();
    openChartLightbox(chartCanvas);
    return;
  }
  if (event.key !== "Escape") return;
  if (state.chartLightboxOpen) closeChartLightbox();
  else if (state.journalModalOpen) closeJournalModal();
  else if (state.modalOpen) closeAlertModal();
});

async function pollLoop() {
  const status = await refreshStatus();
  if (!status) return;
  if (status.cloud_readonly) {
    if (!state.cloudBootstrapped) {
      state.cloudBootstrapped = true;
      await refreshConfig();
      switchView("desk");
    }
    return;
  }
  if (status.scan_in_progress) {
    await Promise.all([refreshActivity(), refreshLogs(), refreshAlerts()]);
    return;
  }
  await Promise.all([
    refreshConfig(),
    refreshJournal(),
    refreshActivity(),
    refreshLogs(),
    refreshAlerts(),
  ]);
}

ensureAlertModal();
tickClock();
setInterval(tickClock, 1000);
pollLoop();
setInterval(() => {
  if (!state.cloudReadOnly) pollLoop();
}, 700);
setInterval(() => {
  if (state.cloudReadOnly) pollLoop();
}, 30000);
