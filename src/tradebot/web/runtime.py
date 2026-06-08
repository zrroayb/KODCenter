from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from dotenv import load_dotenv

from tradebot.alert_store import PersistentAlertStore
from tradebot.config import AppConfig, ConfigError, SetupConfig, load_config
from tradebot.analysis import ANALYSIS_TIMEFRAMES, analyze_symbol
from tradebot.kod import KodTurtleSoupEvaluator, enrich_alert_grade, normalize_setup_grade
from tradebot.journal import JOURNAL_PENDING, JOURNAL_SKIPPED, JOURNAL_TAKEN, TradeJournalStore, alert_snapshot
from tradebot.exchange import ExchangeClient
from tradebot.models import Alert
from tradebot.web.chart_image import build_chart_svg, build_session_chart_svg
from tradebot.scanner import Scanner
from tradebot.state import StateStore
from tradebot.telegram import TelegramNotifier


logger = logging.getLogger(__name__)


class DashboardLogHandler(logging.Handler):
    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self._records: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._next_id = 1
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        item = {
            "id": 0,
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        with self._lock:
            item["id"] = self._next_id
            self._next_id += 1
            self._records.append(item)

    def since(self, last_id: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            return [item for item in self._records if item["id"] > last_id]


class AlertStore(PersistentAlertStore):
    """Disk-backed alert feed; alerts stay until the user dismisses them."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._lock = threading.Lock()

    def add(self, alert: Alert, delivered: bool, error: str | None = None) -> dict[str, Any]:
        with self._lock:
            return super().add(alert, delivered, error=error)

    def latest(self, limit: int = 100, journal: TradeJournalStore | None = None) -> list[dict[str, Any]]:
        with self._lock:
            alerts = [
                alert
                for alert in (enrich_alert_grade(entry) for entry in self.list_active(limit=limit))
                if _active_alert_allowed(alert)
            ]
        if journal is None:
            return alerts
        return [_merge_journal(alert, journal) for alert in alerts]

    def count(self) -> int:
        with self._lock:
            return sum(
                1
                for alert in (enrich_alert_grade(entry) for entry in self.list_active(limit=1000))
                if _active_alert_allowed(alert)
            )

    def dismiss(self, alert_id: int) -> dict[str, Any] | None:
        with self._lock:
            return super().dismiss(alert_id)

    def dismiss_missed_setups(self, **kwargs) -> list[dict[str, Any]]:
        with self._lock:
            return super().dismiss_missed_setups(**kwargs)

    def dismiss_inactive_forming_setups(self, **kwargs) -> list[dict[str, Any]]:
        with self._lock:
            return super().dismiss_inactive_forming_setups(**kwargs)

    def dismiss_invalidated_setups(self, **kwargs) -> list[dict[str, Any]]:
        with self._lock:
            return super().dismiss_invalidated_setups(**kwargs)


class ActivityStore:
    def __init__(self, capacity: int = 160):
        self._items: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._current: dict[str, Any] = {
            "id": 0,
            "phase": "idle",
            "message": "Idle",
            "detail": "Start or scan once.",
            "looking_for": [],
        }
        self._next_id = 1
        self._lock = threading.Lock()

    def add(self, event: dict[str, Any]) -> None:
        item = {
            "id": 0,
            "time": datetime.now(timezone.utc).isoformat(),
            "phase": event.get("phase", "activity"),
            "message": event.get("message", "Scanner activity updated."),
            "detail": event.get("detail", ""),
            "symbol": event.get("symbol", ""),
            "setup": event.get("setup", ""),
            "profile": event.get("profile", ""),
            "timeframe": event.get("timeframe", ""),
            "context_timeframe": event.get("context_timeframe", ""),
            "trigger_timeframe": event.get("trigger_timeframe", ""),
            "confirmation": event.get("confirmation", ""),
            "looking_for": list(event.get("looking_for", [])),
            "diagnostic": event.get("diagnostic") or None,
        }
        with self._lock:
            item["id"] = self._next_id
            self._next_id += 1
            self._current = item
            self._items.appendleft(item)

    def snapshot(self, limit: int = 40) -> dict[str, Any]:
        with self._lock:
            return {
                "current": dict(self._current),
                "events": list(self._items)[:limit],
            }


class WebNotifier:
    def __init__(self, telegram: TelegramNotifier, alerts: AlertStore, journal: TradeJournalStore, framework_fn=None):
        self.telegram = telegram
        self.alerts = alerts
        self.journal = journal
        self.framework_fn = framework_fn

    def send(self, alert: Alert, *, refresh_only: bool = False) -> None:
        if refresh_only:
            stored = self.alerts.add(alert, delivered=False, error=None)
            self._record_journal(alert, stored)
            logger.info("alert refreshed for %s %s %s", alert.symbol, alert.setup_name, alert.stage or "alert")
            return

        if not getattr(alert, "telegram_enabled", True):
            stored = self.alerts.add(alert, delivered=False, error=None)
            self._record_journal(alert, stored)
            logger.info("alert recorded without Telegram for %s %s %s", alert.symbol, alert.setup_name, alert.stage or "alert")
            return

        try:
            self.telegram.send(alert)
        except Exception as exc:
            stored = self.alerts.add(alert, delivered=False, error=str(exc))
            self._record_journal(alert, stored)
            logger.exception("failed to deliver Telegram alert for %s %s", alert.symbol, alert.setup_name)
            return

        stored = self.alerts.add(alert, delivered=not self.telegram.dry_run)
        self._record_journal(alert, stored)
        logger.info("alert recorded for %s %s %s", alert.symbol, alert.setup_name, alert.stage or "alert")

    def dismiss_missed_setups(self, **kwargs) -> list[dict[str, Any]]:
        dismissed = self.alerts.dismiss_missed_setups(**kwargs)
        if dismissed:
            self._mark_pending_journal_skipped(dismissed, "Auto skipped: setup already moved away")
            logger.info("auto-hidden %s missed setup alert(s)", len(dismissed))
        return dismissed

    def dismiss_inactive_forming_setups(self, **kwargs) -> list[dict[str, Any]]:
        dismissed = self.alerts.dismiss_inactive_forming_setups(**kwargs)
        if dismissed:
            self._mark_pending_journal_skipped(dismissed, "Auto skipped: setup is no longer active")
            logger.info("auto-hidden %s inactive forming setup alert(s)", len(dismissed))
        return dismissed

    def dismiss_invalidated_setups(self, **kwargs) -> list[dict[str, Any]]:
        dismissed = self.alerts.dismiss_invalidated_setups(**kwargs)
        if dismissed:
            logger.info("auto-hidden %s invalidated setup alert(s)", len(dismissed))
            self._mark_pending_journal_skipped(dismissed, "Auto skipped: invalidated")
        return dismissed

    def _mark_pending_journal_skipped(self, alerts: list[dict[str, Any]], prefix: str) -> None:
        for item in alerts:
            alert_key = item.get("alert_key")
            if not alert_key:
                continue
            entry = self.journal.get(alert_key)
            if not entry or entry.get("status", JOURNAL_PENDING) != JOURNAL_PENDING:
                continue
            reason = item.get("dismissed_reason") or prefix
            note = _auto_skip_note(entry.get("notes"), f"{prefix}: {reason}")
            try:
                self.journal.set_status(alert_key, JOURNAL_SKIPPED, notes=note)
            except Exception:
                logger.exception("failed to auto-skip stale journal entry %s", alert_key)

    def _record_journal(self, alert: Alert, stored: dict[str, Any]) -> None:
        alert_key = alert.alert_key or stored.get("alert_key")
        if not alert_key:
            return
        snapshot = alert_snapshot(alert)
        snapshot["time"] = stored.get("time", snapshot["time"])
        snapshot["dashboard_id"] = stored.get("id")
        if self.framework_fn is not None:
            try:
                fw = self.framework_fn(alert.symbol)
                if fw:
                    snapshot["framework_grade"] = fw.get("grade")
                    snapshot["framework_decision"] = fw.get("decision")
            except Exception:
                logger.exception("framework grade stamp failed for %s", alert.symbol)
        self.journal.upsert_from_alert(alert_key, snapshot)


class BotController:
    def __init__(
        self,
        config_path: Path,
        env_file: Path,
        state_file: Path,
        journal_file: Path | None = None,
        alerts_file: Path | None = None,
        dry_run: bool = False,
        cloud_readonly: bool = False,
    ):
        self.config_path = config_path
        self.env_file = env_file
        self.state_file = state_file
        self.journal_file = journal_file or Path(".tradebot_journal.json")
        self.alerts_file = alerts_file or Path(".tradebot_alerts.json")
        self.dry_run = dry_run
        self.cloud_readonly = cloud_readonly
        self.logs = DashboardLogHandler()
        self.alerts = AlertStore.load(self.alerts_file)
        self.activity = ActivityStore()
        self.journal = TradeJournalStore.load(self.journal_file)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._running = False
        self._scan_in_progress = False
        self._scan_started_at: str | None = None
        self._started_at: str | None = None
        self._last_scan_at: str | None = None
        self._last_error: str | None = None
        self._cycles = 0
        self._last_alert_count = 0
        self._last_config: AppConfig | None = None
        self._manual_scan_thread: threading.Thread | None = None
        self._exchange: ExchangeClient | None = None
        self._desk_cache: dict[str, Any] | None = None
        self._desk_cache_at = 0.0
        self._desk_cache_ttl = 45.0
        self._analysis_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._analysis_cache_ttl = 60.0

    def start(self) -> dict[str, Any]:
        if self.cloud_readonly:
            return {"ok": False, "message": "Cloud read-only mode scans only when the Desk is opened."}
        with self._lock:
            if self._scan_in_progress:
                return {"ok": False, "message": "Scan already in progress. Wait for it to finish."}
            if self._running:
                return {"ok": False, "message": "Engine is already running."}
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, name="tradebot-web-loop", daemon=True)
            self._running = True
            self._started_at = _now()
            self._last_error = None
            self._thread.start()
        logger.info("web bot loop requested start")
        return {"ok": True, "message": "Automatic scanning started."}

    def stop(self) -> dict[str, Any]:
        if self.cloud_readonly:
            return {"ok": False, "message": "Cloud read-only mode has no background engine to stop."}
        thread: threading.Thread | None
        with self._lock:
            if not self._running:
                return {"ok": False, "message": "Engine is already stopped."}
            self._stop_event.set()
            thread = self._thread
        if thread is not None:
            thread.join(timeout=3)
        with self._lock:
            self._running = False
            self._thread = None
        logger.info("web bot loop stopped")
        return {"ok": True, "message": "Engine stopped."}

    def scan_once(self) -> dict[str, Any]:
        if self.cloud_readonly:
            with self._lock:
                self._desk_cache = None
                self._desk_cache_at = 0.0
            return {"ok": True, "message": "Cloud read-only mode refreshes from the Desk page."}
        with self._lock:
            if self._scan_in_progress:
                return {"ok": False, "message": "Scan already in progress."}
            self._scan_in_progress = True
            self._scan_started_at = _now()
            self._manual_scan_thread = threading.Thread(
                target=self._run_manual_scan,
                name="tradebot-manual-scan",
                daemon=True,
            )
            thread = self._manual_scan_thread
            thread.start()
        self.activity.add(
            {
                "phase": "scan_start",
                "message": "Manual scan started.",
                "detail": "Loading exchange candles and checking strategy rules.",
            }
        )
        logger.info("manual scan requested")
        return {"ok": True, "message": "Scan started. Watch the live scanner feed."}

    def _run_manual_scan(self) -> None:
        try:
            scanner, config = self._build_scanner()
            alert_count = scanner.scan_once()
            with self._lock:
                self._last_config = config
                self._last_scan_at = _now()
                self._last_alert_count = alert_count
                self._cycles += 1
                self._last_error = None
            logger.info("manual scan complete: %s alert(s)", alert_count)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            logger.exception("manual scan failed")
            self.activity.add(
                {
                    "phase": "error",
                    "message": "Manual scan failed.",
                    "detail": str(exc),
                }
            )
        finally:
            with self._lock:
                self._scan_in_progress = False
                self._scan_started_at = None
                self._manual_scan_thread = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            thread_alive = self._thread.is_alive() if self._thread else False
            config = self._last_config

        if config is None:
            try:
                config = load_config(self.config_path)
                with self._lock:
                    self._last_config = config
            except Exception:
                config = None

        with self._lock:
            journal_counts = _empty_journal_counts() if self.cloud_readonly else self.journal.counts()
            return {
                "running": False if self.cloud_readonly else self._running and thread_alive,
                "scan_in_progress": self._scan_in_progress,
                "scan_started_at": self._scan_started_at,
                "started_at": self._started_at,
                "last_scan_at": self._last_scan_at,
                "last_error": self._last_error,
                "cycles": self._cycles,
                "last_alert_count": self._last_alert_count,
                "stored_alerts": 0 if self.cloud_readonly else self.alerts.count(),
                "config_path": str(self.config_path),
                "env_file": str(self.env_file),
                "state_file": str(self.state_file),
                "journal_file": str(self.journal_file),
                "alerts_file": str(self.alerts_file),
                "dry_run": True if self.cloud_readonly else self.dry_run or bool(config.telegram.dry_run if config else False),
                "cloud_readonly": self.cloud_readonly,
                "poll_seconds": config.scanner.poll_seconds if config else None,
                "symbols": list(config.scanner.symbols) if config else [],
                "journal_counts": journal_counts,
            }

    def alerts_snapshot(self) -> list[dict[str, Any]]:
        if self.cloud_readonly:
            return []
        entries = self.alerts.latest(journal=self.journal)
        summaries: dict[str, Any] = {}
        for entry in entries:
            symbol = entry.get("symbol")
            if not symbol:
                continue
            if symbol not in summaries:
                try:
                    summaries[symbol] = self._framework_summary(self._cached_analysis(symbol))
                except Exception:
                    logger.exception("framework analysis failed for %s", symbol)
                    summaries[symbol] = None
            if summaries[symbol]:
                entry["framework"] = summaries[symbol]
        return entries

    def dismiss_alert(self, alert_id: int) -> dict[str, Any]:
        if self.cloud_readonly:
            return {"ok": False, "message": "Cloud read-only mode does not store alerts."}
        entry = self.alerts.dismiss(alert_id)
        if entry is None:
            return {"ok": False, "message": "Alert not found."}
        return {"ok": True, "message": "Alert dismissed.", "alert": entry}

    def chart_data(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 120,
        at_ms: int | None = None,
    ) -> dict[str, Any]:
        candles, error = self._fetch_chart_candles(symbol, timeframe, limit, at_ms)
        if error:
            return {"ok": False, "error": error}
        return {
            "ok": True,
            "symbol": symbol,
            "timeframe": timeframe,
            "signal_at": at_ms,
            "candles": candles,
        }

    def chart_png(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 120,
        at_ms: int | None = None,
        direction: str = "",
        levels: dict[str, float | None] | None = None,
        role: str = "",
        stage: str = "",
        snapshot: bool = False,
        annotations: dict[str, Any] | None = None,
    ) -> str:
        candles, error = self._fetch_chart_candles(symbol, timeframe, limit, at_ms, snapshot=snapshot)
        title = f"{symbol} · {timeframe}"
        if error:
            return build_chart_svg([], title=title, message=error)
        annotations = annotations or {}
        return build_chart_svg(
            candles,
            signal_at_ms=at_ms,
            direction=direction,
            levels=levels,
            title=title,
            role=role,
            stage=stage,
            reference_level=annotations.get("reference_level"),
            sweep_extreme=annotations.get("sweep_extreme"),
            htf_target=annotations.get("htf_target"),
            msb_level=annotations.get("msb_level"),
            msb_at_ms=annotations.get("msb_at_ms"),
            structure_stop=annotations.get("structure_stop"),
            raid_level=annotations.get("raid_level"),
            raid_extreme=annotations.get("raid_extreme"),
            htf_raid_at_ms=annotations.get("htf_raid_at_ms"),
            htf_raid_label=str(annotations.get("htf_raid_label") or ""),
            zones=annotations.get("zones") or None,
            wait_text=str(annotations.get("wait_text") or ""),
            setup_label=str(annotations.get("setup_label") or ""),
            trigger_mode=str(annotations.get("trigger_mode") or ""),
            decision_status=str(annotations.get("decision_status") or ""),
            decision_label=str(annotations.get("decision_label") or ""),
            decision_subtitle=str(annotations.get("decision_subtitle") or ""),
            checklist=annotations.get("checklist") or None,
            framework=self._framework_summary(self._cached_analysis(symbol)),
        )

    def session_chart_png(self, symbol: str) -> str:
        try:
            config = self._last_config or load_config(self.config_path)
            exchange = self._get_exchange()
        except Exception as exc:
            return build_session_chart_svg([], symbol=symbol, message=str(exc))

        candles = exchange.fetch_candles(symbol, "15m", 220)
        if config.scanner.use_closed_candle and candles:
            candles = candles[:-1]
        projection = _desk_session_projection(symbol, candles)
        if not projection:
            return build_session_chart_svg([], symbol=symbol, message="No session data for this symbol")
        payload = [
            {
                "t": candle.timestamp_ms,
                "o": candle.open,
                "h": candle.high,
                "l": candle.low,
                "c": candle.close,
                "v": candle.volume,
            }
            for candle in candles
        ]
        return build_session_chart_svg(payload, symbol=symbol, projection=projection)

    def analysis_snapshot(self, symbol: str) -> dict[str, Any]:
        """Cached, feed-free ICT/CRT analysis for a single symbol (the trade framework)."""
        return self._cached_analysis(symbol)

    def _cached_analysis(self, symbol: str) -> dict[str, Any]:
        now_ts = time.time()
        with self._lock:
            cached = self._analysis_cache.get(symbol)
        if cached is not None and (now_ts - cached[0]) < self._analysis_cache_ttl:
            return cached[1]
        result = self._compute_analysis(symbol)
        with self._lock:
            self._analysis_cache[symbol] = (time.time(), result)
        return result

    def _compute_analysis(self, symbol: str) -> dict[str, Any]:
        try:
            config = self._last_config or load_config(self.config_path)
            exchange = self._get_exchange()
        except Exception as exc:
            return {"asset": symbol, "error": str(exc)}

        tf_limits = {"1M": 24, "1w": 60, "1d": 150, "4h": 200, "1h": 240, "15m": 240}
        use_closed = bool(config.scanner.use_closed_candle)
        tf_candles: dict[str, list] = {}
        errors: list[str] = []
        for tf in ANALYSIS_TIMEFRAMES:
            try:
                candles = exchange.fetch_candles(symbol, tf, tf_limits[tf])
                if use_closed and candles:
                    candles = candles[:-1]
                if candles:
                    tf_candles[tf] = candles
            except Exception as exc:
                errors.append(f"{tf}: {type(exc).__name__}")
                continue

        if not tf_candles:
            return {"asset": symbol, "error": "No candles available. " + "; ".join(errors)}

        result = analyze_symbol(symbol, tf_candles)
        if errors:
            result.setdefault("meta", {})["timeframe_errors"] = errors
        return result

    def _framework_summary(self, analysis: dict[str, Any] | None) -> dict[str, Any] | None:
        """Compact framework read attached to every signal and desk card."""
        if not analysis or analysis.get("error"):
            return None
        crt = analysis.get("crt_setup") or {}
        return {
            "macro_bias": analysis.get("macro_bias"),
            "weekly_bias": analysis.get("weekly_bias"),
            "daily_bias": analysis.get("daily_bias"),
            "h4_bias": analysis.get("4h_bias"),
            "one_h_bias": analysis.get("1h_bias"),
            "m15_bias": analysis.get("15m_bias"),
            "timeframes": analysis.get("timeframes") or {},
            "market_structure": analysis.get("market_structure"),
            "dealing_range": analysis.get("dealing_range") or {},
            "reference_levels": analysis.get("reference_levels") or {},
            "session": analysis.get("current_session"),
            "killzone": analysis.get("current_killzone"),
            "po3_phase": analysis.get("po3_phase"),
            "po3": analysis.get("po3") or {},
            "liquidity_objective": analysis.get("liquidity_objective"),
            "liquidity_map": analysis.get("liquidity_map") or [],
            "liquidity_ranking": analysis.get("liquidity_ranking") or analysis.get("liquidity_map") or [],
            "latest_sweep": analysis.get("latest_sweep"),
            "sweeps": analysis.get("sweeps") or [],
            "displacement": analysis.get("displacement") or {},
            "mss": analysis.get("mss"),
            "mss_detail": analysis.get("mss_detail") or {},
            "choch": analysis.get("choch"),
            "choch_detail": analysis.get("choch_detail") or {},
            "fvg": analysis.get("fvg") or [],
            "order_blocks": analysis.get("order_blocks") or [],
            "breaker_blocks": analysis.get("breaker_blocks") or [],
            "mitigation_blocks": analysis.get("mitigation_blocks") or [],
            "grade": analysis.get("trade_grade"),
            "score": analysis.get("probability_score"),
            "decision": analysis.get("trade_decision"),
            "crt": {
                "type": crt.get("type"),
                "confidence": crt.get("confidence"),
                "entry": crt.get("entry"),
                "stop": crt.get("stop"),
                "target": crt.get("target"),
                "rr": crt.get("rr"),
            },
            "risk_notes": (analysis.get("risk_notes") or [])[:3],
            "reasoning": (analysis.get("reasoning") or [])[:3],
            "meta": analysis.get("meta") or {},
        }

    def _fetch_chart_candles(
        self,
        symbol: str,
        timeframe: str,
        limit: int,
        at_ms: int | None,
        snapshot: bool = False,
    ) -> tuple[list[dict[str, Any]], str | None]:
        try:
            exchange = self._get_exchange()
        except Exception as exc:
            return [], str(exc)

        fetch_limit = min(300, limit)
        since_ms = None
        if at_ms is not None:
            bar_ms = max(_timeframe_window_ms(timeframe, 1), 1)
            if snapshot:
                before_bars = max(12, min(limit - 1, int(limit * 0.82)))
                fetch_limit = min(300, max(limit + 8, before_bars + 8))
                since_ms = max(0, int(at_ms) - bar_ms * before_bars)
            else:
                now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                bars_since_signal = max(0, (now_ms - int(at_ms)) // bar_ms)
                fetch_limit = min(300, max(limit, bars_since_signal + 50))
                since_ms = max(0, int(at_ms) - _timeframe_window_ms(timeframe, 30))

        try:
            candles = exchange.fetch_candles(symbol, timeframe, fetch_limit, since_ms=since_ms)
        except Exception as exc:
            logger.exception("chart fetch failed for %s %s", symbol, timeframe)
            return [], str(exc)

        if snapshot and at_ms is not None:
            candles = [candle for candle in candles if candle.timestamp_ms <= int(at_ms)]
            candles = candles[-limit:]

        if not candles:
            try:
                candles = exchange.fetch_candles(symbol, timeframe, min(300, limit))
            except Exception as exc:
                return [], str(exc)
            if snapshot and at_ms is not None:
                candles = [candle for candle in candles if candle.timestamp_ms <= int(at_ms)]
                candles = candles[-limit:]

        payload = [
            {
                "t": candle.timestamp_ms,
                "o": candle.open,
                "h": candle.high,
                "l": candle.low,
                "c": candle.close,
                "v": candle.volume,
            }
            for candle in candles
        ]
        if not payload:
            return [], "No candle data returned."
        return payload, None

    def _get_exchange(self) -> ExchangeClient:
        if self._exchange is not None:
            return self._exchange
        load_dotenv(self.env_file)
        config = load_config(self.config_path)
        self._exchange = ExchangeClient(config.exchange)
        with self._lock:
            self._last_config = config
        return self._exchange

    def journal_list(
        self,
        status: str | None = None,
        symbol: str | None = None,
        setup: str | None = None,
        direction: str | None = None,
        outcome: str | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        if self.cloud_readonly:
            return {
                "entries": [],
                "counts": _empty_journal_counts(),
                "stats": _empty_journal_stats(),
                "filters": {"symbols": [], "setups": []},
                "journal_file": "disabled in cloud read-only mode",
            }
        self._auto_skip_inactive_pending_journal_entries()
        entries = self.journal.list_entries(
            limit=limit,
            status=status,
            symbol=symbol,
            setup=setup,
            direction=direction,
            outcome=outcome,
        )
        entries = [self._hydrate_journal_entry(entry) for entry in entries]
        symbols = sorted({entry.get("symbol") for entry in self.journal.entries.values() if entry.get("symbol")})
        setups = sorted({entry.get("setup_name") for entry in self.journal.entries.values() if entry.get("setup_name")})
        return {
            "entries": entries,
            "counts": self.journal.counts(),
            "stats": self.journal.stats(),
            "filters": {"symbols": symbols, "setups": setups},
            "journal_file": str(self.journal_file),
        }

    def _auto_skip_inactive_pending_journal_entries(self) -> int:
        active_alerts = [enrich_alert_grade(entry) for entry in self.alerts.list_active(limit=1000)]
        active_keys = {
            item.get("alert_key")
            for item in active_alerts
            if item.get("alert_key") and _active_alert_allowed(item)
        }
        alerts_by_key = {
            item.get("alert_key"): item
            for item in self.alerts.alerts
            if item.get("alert_key")
        }
        changed = 0
        for alert_key, entry in list(self.journal.entries.items()):
            if entry.get("status", JOURNAL_PENDING) != JOURNAL_PENDING:
                continue
            if alert_key in active_keys:
                continue
            if entry.get("stage") not in {"forming", "confirmed", "alert"}:
                continue
            alert = alerts_by_key.get(alert_key) or {}
            reason = alert.get("dismissed_reason") or "setup is no longer active"
            note = _auto_skip_note(entry.get("notes"), f"Auto skipped: {reason}")
            try:
                self.journal.set_status(alert_key, JOURNAL_SKIPPED, notes=note)
                changed += 1
            except Exception:
                logger.exception("failed to auto-skip inactive journal entry %s", alert_key)
        if changed:
            logger.info("auto-skipped %s inactive pending journal entry(s)", changed)
        return changed

    def journal_update(self, alert_key: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.cloud_readonly:
            return {"ok": False, "message": "Cloud read-only mode has no journal storage."}
        try:
            entry = self.journal.update_entry(alert_key, payload)
        except KeyError:
            return {"ok": False, "message": "Journal entry not found."}
        except ValueError as exc:
            return {"ok": False, "message": str(exc)}

        status = entry.get("status", JOURNAL_PENDING)
        label = "Taken" if status == JOURNAL_TAKEN else "Skipped" if status == JOURNAL_SKIPPED else "Pending"
        return {"ok": True, "message": f"Journal updated · {label}", "entry": self._hydrate_journal_entry(entry)}

    def replay_recent(self, bars: int = 120) -> dict[str, Any]:
        if self.cloud_readonly:
            return {"ok": False, "message": "Replay is disabled in cloud read-only mode."}
        try:
            config = load_config(self.config_path)
            exchange = self._get_exchange()
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

        bars = max(20, min(int(bars or 120), 220))
        evaluator = KodTurtleSoupEvaluator()
        summaries: list[dict[str, Any]] = []
        findings: list[dict[str, Any]] = []
        seen: set[str] = set()

        for setup in config.setups:
            if not setup.enabled or setup.type != "kod_turtle_soup":
                continue
            for symbol in config.scanner.symbols:
                cache: dict[str, list[Any]] = {}
                for profile in setup.params.get("profiles", []):
                    context_tf = str(profile["context_timeframe"])
                    trigger_tf = str(profile["trigger_timeframe"])
                    context = cache.get(context_tf)
                    if context is None:
                        context = exchange.fetch_candles(symbol, context_tf, min(config.scanner.candle_limit, 300))
                        if config.scanner.use_closed_candle and context:
                            context = context[:-1]
                        cache[context_tf] = context
                    trigger = cache.get(trigger_tf)
                    if trigger is None:
                        trigger = exchange.fetch_candles(symbol, trigger_tf, min(config.scanner.candle_limit, 300))
                        if config.scanner.use_closed_candle and trigger:
                            trigger = trigger[:-1]
                        cache[trigger_tf] = trigger
                    if not context or not trigger:
                        continue

                    start = max(30, len(trigger) - bars)
                    profile_counts = {"forming": 0, "confirmed": 0, "invalidated": 0}
                    for index in range(start, len(trigger)):
                        trigger_slice = trigger[: index + 1]
                        current_time = trigger_slice[-1].timestamp_ms
                        context_slice = [candle for candle in context if candle.timestamp_ms <= current_time]
                        signals = evaluator.evaluate(setup, profile, context_slice, trigger_slice)
                        for signal in signals:
                            key = f"{symbol}|{profile.get('name')}|{signal.alert_id}|{signal.candle.timestamp_ms}"
                            if key in seen:
                                continue
                            seen.add(key)
                            profile_counts[signal.stage] = profile_counts.get(signal.stage, 0) + 1
                            if len(findings) < 80:
                                findings.append(
                                    {
                                        "symbol": symbol,
                                        "profile": profile.get("name") or "",
                                        "stage": signal.stage,
                                        "direction": signal.direction,
                                        "timeframe": signal.trigger_timeframe,
                                        "time": signal.candle.opened_at.isoformat(),
                                        "grade": (signal.trade_plan or {}).get("setup_grade"),
                                        "rr_final": (signal.trade_plan or {}).get("rr_final"),
                                        "summary": next(
                                            (line.split(":", 1)[1].strip() for line in signal.details if str(line).startswith("Summary:")),
                                            "KOD setup",
                                        ),
                                    }
                                )
                    summaries.append(
                        {
                            "symbol": symbol,
                            "profile": profile.get("name") or "",
                            "context_timeframe": context_tf,
                            "trigger_timeframe": trigger_tf,
                            "bars": len(trigger[-bars:]),
                            "counts": profile_counts,
                        }
                    )

        totals = {"forming": 0, "confirmed": 0, "invalidated": 0}
        for item in summaries:
            for stage, value in (item.get("counts") or {}).items():
                totals[stage] = totals.get(stage, 0) + int(value or 0)

        return {
            "ok": True,
            "bars": bars,
            "totals": totals,
            "summaries": summaries,
            "findings": findings,
            "message": f"Replay scanned last {bars} trigger candles per profile.",
        }

    def _hydrate_journal_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        if entry.get("details"):
            return entry
        alert_key = entry.get("alert_key")
        if not alert_key:
            return entry
        match = next((alert for alert in self.alerts.alerts if alert.get("alert_key") == alert_key), None)
        if not match or not match.get("details"):
            return entry

        hydrated = dict(entry)
        for key in (
            "details",
            "error",
            "open",
            "high",
            "low",
            "context_timeframe",
            "trigger_timeframe",
            "candle_timestamp_ms",
            "trigger_candle_timestamp_ms",
            "trade_plan",
        ):
            if key in match and (key != "trade_plan" or not hydrated.get("trade_plan")):
                hydrated[key] = match[key]
        return hydrated

    def config_snapshot(self) -> dict[str, Any]:
        try:
            config = load_config(self.config_path)
        except Exception as exc:
            return {"ok": False, "error": str(exc), "config_path": str(self.config_path)}

        return {
            "ok": True,
            "config_path": str(self.config_path),
            "exchange": asdict(config.exchange),
            "scanner": asdict(config.scanner),
            "telegram": {
                "bot_token_env": config.telegram.bot_token_env,
                "chat_id_env": config.telegram.chat_id_env,
                "dry_run": config.telegram.dry_run,
            },
            "setups": [_setup_summary(setup) for setup in config.setups],
        }

    def desk_snapshot(self, force: bool = False) -> dict[str, Any]:
        now_ts = time.time()
        with self._lock:
            cached = self._desk_cache
            cache_age = now_ts - self._desk_cache_at
        if not force and cached is not None and cache_age < self._desk_cache_ttl:
            return {**cached, "cached": True, "cache_age_seconds": round(cache_age, 1)}

        try:
            config = load_config(self.config_path)
            exchange = self._get_exchange()
        except Exception as exc:
            return {"ok": False, "message": str(exc), "posts": []}

        evaluator = KodTurtleSoupEvaluator()
        posts: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        session_projections: list[dict[str, Any]] = []
        session_projection_by_symbol: dict[str, dict[str, Any]] = {}

        for symbol in config.scanner.symbols:
            cache: dict[str, list[Any]] = {}
            try:
                framework_summary = self._framework_summary(self._cached_analysis(symbol))
            except Exception:
                logger.exception("framework analysis failed for %s", symbol)
                framework_summary = None
            if _session_projection_enabled(symbol):
                try:
                    projection_candles = _cached_desk_candles(cache, exchange, symbol, "15m", 220, config.scanner.use_closed_candle)
                    projection = _desk_session_projection(symbol, projection_candles)
                    if projection:
                        session_projections.append(projection)
                        session_projection_by_symbol[symbol] = projection
                except Exception as exc:
                    logger.exception("desk session projection failed for %s", symbol)
                    errors.append({"symbol": symbol, "profile": "session_projection", "message": str(exc)})
            for setup in config.setups:
                if not setup.enabled or setup.type != "kod_turtle_soup":
                    continue
                for profile in setup.params.get("profiles", []):
                    context_tf = str(profile.get("context_timeframe") or "")
                    trigger_tf = str(profile.get("trigger_timeframe") or "")
                    profile_name = str(profile.get("name") or f"{context_tf}-{trigger_tf}")
                    if not context_tf or not trigger_tf:
                        continue
                    try:
                        context = _cached_desk_candles(cache, exchange, symbol, context_tf, config.scanner.candle_limit, config.scanner.use_closed_candle)
                        trigger = _cached_desk_candles(cache, exchange, symbol, trigger_tf, config.scanner.candle_limit, config.scanner.use_closed_candle)
                        diagnostic = evaluator.diagnose(setup, profile, context, trigger)
                        post = _desk_post(
                            symbol,
                            setup.name,
                            profile_name,
                            context_tf,
                            trigger_tf,
                            context,
                            trigger,
                            diagnostic,
                            session_projection=session_projection_by_symbol.get(symbol),
                        )
                        if framework_summary:
                            post["framework"] = framework_summary
                        posts.append(post)
                    except Exception as exc:
                        logger.exception("desk analysis failed for %s %s/%s", symbol, context_tf, trigger_tf)
                        errors.append({"symbol": symbol, "profile": profile_name, "message": str(exc)})

        snapshot = {
            "ok": True,
            "generated_at": _now(),
            "posts": posts,
            "session_projection": session_projections,
            "errors": errors,
            "message": f"{len(posts)} desk thread(s) generated.",
            "cached": False,
            "cache_age_seconds": 0,
        }
        with self._lock:
            self._desk_cache = snapshot
            self._desk_cache_at = time.time()
        return snapshot

    def _run_loop(self) -> None:
        try:
            scanner, config = self._build_scanner()
            with self._lock:
                self._last_config = config
            logger.info("web bot loop started")

            while not self._stop_event.is_set():
                with self._lock:
                    self._scan_in_progress = True
                    self._scan_started_at = _now()
                try:
                    alert_count = scanner.scan_once()
                    with self._lock:
                        self._last_scan_at = _now()
                        self._last_alert_count = alert_count
                        self._cycles += 1
                        self._last_error = None
                    logger.info("web scan complete: %s alert(s)", alert_count)
                except Exception as exc:
                    with self._lock:
                        self._last_error = str(exc)
                    logger.exception("web scan failed")
                finally:
                    with self._lock:
                        self._scan_in_progress = False
                        self._scan_started_at = None

                if self._stop_event.wait(config.scanner.poll_seconds):
                    break
        except ConfigError as exc:
            with self._lock:
                self._last_error = str(exc)
            logger.error("config error: %s", exc)
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)
            logger.exception("web bot loop crashed")
        finally:
            with self._lock:
                self._running = False
                self._scan_in_progress = False
                self._scan_started_at = None

    def _build_scanner(self) -> tuple[Scanner, AppConfig]:
        load_dotenv(self.env_file)
        config = load_config(self.config_path)
        exchange = ExchangeClient(config.exchange)
        telegram = TelegramNotifier(config.telegram, force_dry_run=self.dry_run)
        notifier = WebNotifier(
            telegram,
            self.alerts,
            self.journal,
            framework_fn=lambda sym: self._framework_summary(self._cached_analysis(sym)),
        )
        state = StateStore.load(self.state_file)
        return Scanner(config, exchange, notifier, state, event_sink=self.activity.add), config


def _setup_summary(setup: SetupConfig) -> dict[str, Any]:
    return {
        "name": setup.name,
        "enabled": setup.enabled,
        "type": setup.type,
        "brief": _setup_brief(setup),
        "cooldown_minutes": setup.cooldown_minutes,
        "profiles": setup.params.get("profiles", []),
        "alert_stages": setup.params.get("alert_stages", []),
    }


def _setup_brief(setup: SetupConfig) -> str:
    if setup.type == "kod_turtle_soup":
        return "YTL/HTF bias, Context CRT, fast trigger-timeframe MSB or iFVG confirmation, ATR risk, and structure-based target map."
    if setup.type == "conditions":
        return "Configured indicator stack on the latest closed candle."
    return "Configured strategy rules."


def _cached_desk_candles(
    cache: dict[str, list[Any]],
    exchange: ExchangeClient,
    symbol: str,
    timeframe: str,
    limit: int,
    use_closed_candle: bool,
) -> list[Any]:
    if timeframe in cache:
        return cache[timeframe]
    candles = exchange.fetch_candles(symbol, timeframe, min(int(limit or 300), 300))
    if use_closed_candle and candles:
        candles = candles[:-1]
    cache[timeframe] = candles
    return candles


SESSION_PROJECTION_SYMBOLS = {"NAS100", "EUR/USD", "GBP/USD"}
SESSION_WINDOWS = [
    {"key": "asia", "name": "Asia", "start": 0, "end": 5 * 60},
    {"key": "london", "name": "London", "start": 7 * 60, "end": 10 * 60},
    {"key": "ny_am", "name": "NY AM", "start": 12 * 60 + 30, "end": 16 * 60},
    {"key": "ny_pm", "name": "NY PM", "start": 18 * 60, "end": 20 * 60},
]


def _session_projection_enabled(symbol: str) -> bool:
    return symbol in SESSION_PROJECTION_SYMBOLS


def _desk_session_projection(symbol: str, candles: list[Any]) -> dict[str, Any] | None:
    if len(candles) < 12:
        return None
    latest = candles[-1]
    latest_dt = datetime.fromtimestamp(latest.timestamp_ms / 1000, tz=timezone.utc)
    ranges = _session_ranges(candles, latest_dt)
    event = _latest_session_event(candles, ranges, latest.close)
    direction = event.get("direction") if event else "neutral"
    likely_draw = _session_likely_draw(direction, latest.close, ranges)
    current_session, next_session = _current_next_session(latest_dt)
    focus = "NY AM focus" if symbol == "NAS100" else "London / NY focus"
    trigger = _projection_trigger_text(direction)
    invalidation = _projection_invalidation_text(direction, event)
    taken = event.get("label") if event else "No clean raid/reclaim yet"
    draw_label = likely_draw.get("label") or "Wait"
    draw_level = likely_draw.get("level")
    draw_text = f"{draw_label} @ {_price_text(draw_level)}" if draw_level is not None else draw_label
    expectations = [
        {"key": "taken", "title": "Liquidity taken", "text": taken},
        {"key": "draw", "title": "Likely draw", "text": draw_text},
        {"key": "trigger", "title": "Wait for", "text": trigger},
        {"key": "invalid", "title": "Invalid if", "text": invalidation},
    ]
    return {
        "symbol": symbol,
        "focus": focus,
        "timeframe": "15m",
        "status": direction,
        "current_session": current_session,
        "next_session": next_session,
        "latest_price": latest.close,
        "ranges": ranges,
        "taken_liquidity": taken,
        "likely_draw": likely_draw,
        "trigger": trigger,
        "invalidation": invalidation,
        "expectations": expectations,
        "chart_url": f"/api/chart/session?{urlencode({'symbol': symbol})}",
        "note": "Session projection only — must align with KOD before trading.",
    }


def _session_ranges(candles: list[Any], latest_dt: datetime) -> list[dict[str, Any]]:
    dates = sorted({datetime.fromtimestamp(candle.timestamp_ms / 1000, tz=timezone.utc).date() for candle in candles})
    recent_dates = dates[-2:]
    ranges: list[dict[str, Any]] = []
    for window in SESSION_WINDOWS:
        selected = None
        for day in reversed(recent_dates):
            items = [
                candle
                for candle in candles
                if datetime.fromtimestamp(candle.timestamp_ms / 1000, tz=timezone.utc).date() == day
                and window["start"] <= _minute_of_day(candle.timestamp_ms) < window["end"]
            ]
            if items:
                selected = (day, items)
                break
        if not selected:
            continue
        day, items = selected
        high = max(item.high for item in items)
        low = min(item.low for item in items)
        active = day == latest_dt.date() and window["start"] <= latest_dt.hour * 60 + latest_dt.minute < window["end"]
        ranges.append(
            {
                "key": window["key"],
                "name": window["name"],
                "date": day.isoformat(),
                "high": high,
                "low": low,
                "active": active,
                "complete": not active,
                "start_ms": _session_bound_ms(day, int(window["start"])),
                "end_ms": _session_bound_ms(day, int(window["end"])),
            }
        )
    return ranges


def _latest_session_event(candles: list[Any], ranges: list[dict[str, Any]], latest_close: float) -> dict[str, Any] | None:
    events: list[dict[str, Any]] = []
    for item in ranges:
        if not item.get("complete"):
            continue
        tail = [candle for candle in candles if candle.timestamp_ms >= int(item["end_ms"])]
        if not tail:
            continue
        buy_sweep = max((candle.high for candle in tail), default=item["high"]) > float(item["high"])
        sell_sweep = min((candle.low for candle in tail), default=item["low"]) < float(item["low"])
        if buy_sweep and latest_close < float(item["high"]):
            swept = max(tail, key=lambda candle: candle.high)
            events.append(
                {
                    "direction": "bearish",
                    "level": item["high"],
                    "timestamp_ms": swept.timestamp_ms,
                    "label": f"{item['name']} high swept and reclaimed",
                    "invalid_level": item["high"],
                }
            )
        if sell_sweep and latest_close > float(item["low"]):
            swept = min(tail, key=lambda candle: candle.low)
            events.append(
                {
                    "direction": "bullish",
                    "level": item["low"],
                    "timestamp_ms": swept.timestamp_ms,
                    "label": f"{item['name']} low swept and reclaimed",
                    "invalid_level": item["low"],
                }
            )
    if not events:
        return None
    return sorted(events, key=lambda item: int(item["timestamp_ms"]), reverse=True)[0]


def _session_likely_draw(direction: str, latest_close: float, ranges: list[dict[str, Any]]) -> dict[str, Any]:
    if direction == "bullish":
        candidates = [item for item in ranges if float(item["high"]) > latest_close]
        key = "high"
        fallback = max(ranges, key=lambda item: float(item["high"]), default=None)
    elif direction == "bearish":
        candidates = [item for item in ranges if float(item["low"]) < latest_close]
        key = "low"
        fallback = min(ranges, key=lambda item: float(item["low"]), default=None)
    else:
        return {"direction": "neutral", "label": "Wait for a session raid/reclaim", "level": None}
    selected = min(candidates, key=lambda item: abs(float(item[key]) - latest_close), default=fallback)
    if not selected:
        return {"direction": direction, "label": "No clean draw", "level": None}
    side = "high" if key == "high" else "low"
    return {
        "direction": direction,
        "label": f"{selected['name']} {side}",
        "level": selected[key],
    }


def _current_next_session(moment: datetime) -> tuple[str, str]:
    minute = moment.hour * 60 + moment.minute
    for index, window in enumerate(SESSION_WINDOWS):
        if window["start"] <= minute < window["end"]:
            next_window = SESSION_WINDOWS[(index + 1) % len(SESSION_WINDOWS)]
            return str(window["name"]), str(next_window["name"])
    for window in SESSION_WINDOWS:
        if minute < window["start"]:
            return "Between sessions", str(window["name"])
    return "Between sessions", "Asia"


def _projection_trigger_text(direction: str) -> str:
    if direction == "bullish":
        return "Wait for 15m bullish MSB or FVG/iFVG displacement."
    if direction == "bearish":
        return "Wait for 15m bearish MSB or FVG/iFVG displacement."
    return "No entry. Wait for session high/low raid and reclaim first."


def _projection_invalidation_text(direction: str, event: dict[str, Any] | None) -> str:
    if not event:
        return "No invalidation until a raid/reclaim forms."
    level = _price_text(event.get("invalid_level"))
    if direction == "bullish":
        return f"Lose reclaimed low {level}."
    if direction == "bearish":
        return f"Reclaim above swept high {level}."
    return "Wait."


def _projection_aligns_with_bias(projection: dict[str, Any] | None, side: str) -> bool:
    if not projection or side not in {"bullish", "bearish"}:
        return False
    return projection.get("status") == side


def _minute_of_day(timestamp_ms: int) -> int:
    moment = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
    return moment.hour * 60 + moment.minute


def _session_bound_ms(day: Any, minute: int) -> int:
    moment = datetime(day.year, day.month, day.day, minute // 60, minute % 60, tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def _desk_post(
    symbol: str,
    setup_name: str,
    profile_name: str,
    context_tf: str,
    trigger_tf: str,
    context: list[Any],
    trigger: list[Any],
    diagnostic: dict[str, Any],
    session_projection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    direction = _desk_direction(diagnostic.get("directions") or [])
    latest = trigger[-1] if trigger else None
    latest_close = getattr(latest, "close", None)
    at_ms = getattr(latest, "timestamp_ms", None)
    side = direction.get("direction", "")
    objective = direction.get("objective") or {}
    gate = direction.get("gate") or {}
    raid = direction.get("raid") or {}
    displacement = direction.get("displacement") or {}
    blockers = list(gate.get("blockers") or direction.get("blockers") or [])
    reasons = list(direction.get("reasons") or [])
    status = _desk_status(direction, diagnostic)
    quality = direction.get("quality") or {}
    grade = quality.get("grade") or "—"
    htf_target = objective.get("level")
    msb_level = direction.get("msb_level")
    msb_at_ms = direction.get("msb_timestamp_ms")
    wait_text = _desk_wait_text(direction, diagnostic, trigger_tf)
    decision = _desk_decision(status, side, objective, raid, blockers, wait_text)
    priority_score = _desk_priority_score(status, grade, objective, raid, blockers, decision["checklist"])
    if _projection_aligns_with_bias(session_projection, side):
        priority_score = min(100, priority_score + 10)
    context_summary = _desk_context_summary(context_tf, trigger_tf, side, objective, raid, blockers)
    chart_url = _desk_chart_url(
        symbol,
        trigger_tf,
        at_ms,
        side,
        htf_target=htf_target,
        reference_level=(raid or {}).get("level"),
        sweep_extreme=(raid or {}).get("sweep_extreme"),
        msb_level=msb_level,
        msb_at_ms=msb_at_ms,
        fvg_zone=direction.get("fvg"),
        ifvg_zone=direction.get("ifvg"),
        wait_text=wait_text,
        setup_label=f"{symbol} {profile_name}: {side or 'neutral'} scenario",
        decision=decision,
    )
    context_chart_url = _desk_chart_url(
        symbol,
        context_tf,
        getattr(context[-1], "timestamp_ms", None) if context else None,
        side,
        role="context",
        htf_target=htf_target,
        reference_level=(raid or {}).get("level"),
        sweep_extreme=(raid or {}).get("sweep_extreme"),
        htf_raid_at_ms=(raid or {}).get("timestamp_ms"),
        wait_text=f"HTF map: bias + Context CRT. Confirm on {trigger_tf} MSB/iFVG.",
        setup_label=f"{symbol} HTF context",
        decision=decision,
    )
    scenarios = _desk_scenarios(side, objective, msb_level, raid, trigger_tf, latest_close)
    return {
        "id": f"{symbol}|{profile_name}|{context_tf}|{trigger_tf}",
        "symbol": symbol,
        "setup": setup_name,
        "profile": profile_name,
        "context_timeframe": context_tf,
        "trigger_timeframe": trigger_tf,
        "time": latest.opened_at.isoformat() if latest else "",
        "price": latest_close,
        "headline": diagnostic.get("headline") or "Waiting for clean ICT context.",
        "status": status,
        "bias": side or "neutral",
        "grade": grade,
        "high_potential": _desk_high_potential(status, grade),
        "priority_score": priority_score,
        "priority_label": _desk_priority_label(priority_score, status),
        "session_projection_alignment": _projection_aligns_with_bias(session_projection, side),
        "quality_action": quality.get("action") or "",
        "decision": decision,
        "context_summary": context_summary,
        "checklist": decision["checklist"],
        "objective": objective,
        "raid": raid,
        "msb_level": msb_level,
        "displacement": displacement,
        "reasons": reasons[:4],
        "blockers": blockers[:6],
        "what_now": _desk_what_now(status, wait_text, blockers),
        "scenarios": scenarios,
        "chart_url": chart_url,
        "context_chart_url": context_chart_url,
        "checks": diagnostic.get("checks") or [],
        "data_note": "Local chart uses exchange candles. No TradingView screenshot or macro/sentiment feed is connected.",
    }


def _desk_direction(directions: list[dict[str, Any]]) -> dict[str, Any]:
    if not directions:
        return {}
    rank = {"pass": 4, "wait": 3, "block": 2, "blocked": 1}

    def score(item: dict[str, Any]) -> tuple[int, float]:
        gate = item.get("gate") or {}
        status = str(item.get("status") or gate.get("status") or "")
        quality = item.get("quality") or {}
        objective = item.get("objective") or {}
        gate_ok = 1 if gate.get("status") == "passed" else 0
        return (
            gate_ok * 10 + rank.get(status, 0),
            float(quality.get("score") or 0) - float(objective.get("distance_atr") or 9),
        )

    return sorted(directions, key=score, reverse=True)[0]


def _desk_status(direction: dict[str, Any], diagnostic: dict[str, Any]) -> str:
    if not direction:
        return "waiting"
    gate = direction.get("gate") or {}
    if gate.get("status") == "passed":
        return "ready"
    if direction.get("status") == "block" or gate.get("status") == "blocked":
        return "blocked"
    if direction.get("raid"):
        return "armed"
    return "waiting"


def _desk_high_potential(status: str, grade: Any) -> bool:
    normalized_grade = str(grade or "").upper().replace(" ", "")
    return status in {"ready", "armed"} and normalized_grade in {"A", "A+"}


def _desk_priority_score(
    status: str,
    grade: Any,
    objective: dict[str, Any],
    raid: dict[str, Any],
    blockers: list[str],
    checklist: list[dict[str, Any]],
) -> int:
    score = 0
    if status == "ready":
        score += 70
    elif status == "armed":
        score += 52
    elif status == "waiting":
        score += 18
    normalized_grade = str(grade or "").upper().replace(" ", "")
    score += {"A+": 24, "A": 18, "B": 9, "C": 3}.get(normalized_grade, 0)
    if objective.get("level") is not None:
        score += 10
        try:
            distance_atr = float(objective.get("distance_atr"))
        except (TypeError, ValueError):
            distance_atr = None
        if distance_atr is not None:
            if distance_atr <= 0.8:
                score += 8
            elif distance_atr <= 1.2:
                score += 4
    if raid:
        score += 12
    pass_count = sum(1 for item in checklist if item.get("status") == "pass")
    wait_count = sum(1 for item in checklist if item.get("status") == "wait")
    block_count = sum(1 for item in checklist if item.get("status") == "block")
    score += pass_count * 4 + wait_count
    score -= block_count * 12
    score -= min(len(blockers), 4) * 5
    if status != "ready":
        score = min(score, 24)
    return max(0, min(100, int(score)))


def _desk_priority_label(score: int, status: str) -> str:
    if status == "ready" or score >= 78:
        return "Focus now"
    if status == "armed" or score >= 58:
        return "Close watch"
    if score >= 35:
        return "Build watch"
    return "Low priority"


def _desk_decision(
    status: str,
    side: str,
    objective: dict[str, Any],
    raid: dict[str, Any],
    blockers: list[str],
    wait_text: str,
) -> dict[str, Any]:
    blocker_text = " | ".join(str(item) for item in blockers).lower()
    has_draw = objective.get("level") is not None
    htf_blocked = (
        "htf bias" in blocker_text
        or "wrong htf location" in blocker_text
        or "opposite" in blocker_text
        or "no same-direction htf" in blocker_text
    )
    wrong_location = "wrong htf location" in blocker_text or "premium" in blocker_text and "discount" in blocker_text
    missing_trigger = "missing" in blocker_text and "msb/ifvg" in blocker_text
    weak_trigger = "weak displacement" in blocker_text or "weak trigger" in blocker_text or missing_trigger
    no_raid = "missing context crt" in blocker_text or "no fresh htf raid" in blocker_text or "no fresh htf raid/reclaim" in blocker_text
    risk_blocked = "risk" in blocker_text and ("wide" in blocker_text or "geniş" in blocker_text or "blocked" in blocker_text)

    if status == "ready":
        label = "READY: PLAN VALID"
        subtitle = "Manual execution only. Check entry, invalidation and targets."
    elif blockers:
        label = "NO TRADE: BLOCKED"
        subtitle = blockers[0]
    elif not has_draw:
        label = "NO TRADE: HTF DRAW MISSING"
        subtitle = "Do not hunt trigger until a clean higher-timeframe objective exists."
    else:
        label = "WAIT: TRIGGER NOT READY"
        subtitle = wait_text

    checklist = [
        {"key": "bias", "label": "HTF bias", "status": "block" if htf_blocked else "pass" if has_draw else "wait"},
        {
            "key": "location",
            "label": "PD array",
            "status": "block" if wrong_location else "pass" if has_draw else "wait",
        },
        {
            "key": "context_crt",
            "label": "Context CRT",
            "status": "pass" if raid else "block" if no_raid and has_draw else "wait",
        },
        {
            "key": "trigger",
            "label": "MSB/iFVG",
            "status": "pass" if status == "ready" else "block" if weak_trigger or raid else "wait",
        },
        {
            "key": "risk",
            "label": "Risk",
            "status": "block" if risk_blocked else "pass" if status == "ready" else "wait",
        },
    ]
    return {
        "status": status,
        "side": side or "neutral",
        "label": label,
        "subtitle": subtitle,
        "checklist": checklist,
    }


def _desk_context_summary(
    context_tf: str,
    trigger_tf: str,
    side: str,
    objective: dict[str, Any],
    raid: dict[str, Any],
    blockers: list[str],
) -> dict[str, str]:
    direction = "Bullish" if side == "bullish" else "Bearish" if side == "bearish" else "Neutral"
    draw = objective.get("level")
    raid_level = (raid or {}).get("level")
    if draw is not None and raid:
        read = f"{context_tf} bias and draw are mapped; Context CRT is on the chart."
    elif draw is not None:
        read = f"{context_tf} draw exists; waiting for clean Context CRT."
    elif blockers:
        read = f"{context_tf} is blocked: {blockers[0]}"
    else:
        read = f"{context_tf} has no clean draw yet."
    return {
        "title": f"{context_tf} context",
        "bias": direction,
        "draw": _price_text(draw),
        "raid": _price_text(raid_level),
        "context_crt": _price_text(raid_level),
        "trigger": f"Confirm on {trigger_tf}",
        "read": read,
    }


def _desk_wait_text(direction: dict[str, Any], diagnostic: dict[str, Any], trigger_tf: str) -> str:
    if direction.get("next_step"):
        return str(direction["next_step"])
    steps = diagnostic.get("next_steps") or []
    if steps:
        return str(steps[0])
    return f"Wait for {trigger_tf} MSB or iFVG reclaim after Context CRT is clean."


def _desk_what_now(status: str, wait_text: str, blockers: list[str]) -> str:
    if status == "ready":
        return "Plan is clean enough to monitor on the chart. Manual execution only."
    if blockers:
        return f"No trade. Main blocker: {blockers[0]}"
    return wait_text


def _desk_scenarios(
    side: str,
    objective: dict[str, Any],
    msb_level: Any,
    raid: dict[str, Any],
    trigger_tf: str,
    latest_close: Any,
) -> list[dict[str, str]]:
    target = objective.get("level")
    target_text = _price_text(target)
    msb_text = _price_text(msb_level)
    raid_level = _price_text((raid or {}).get("level"))
    if side == "bullish":
        primary = {
            "title": "Bullish case",
            "text": f"Need sell-side Context CRT to hold, then {trigger_tf} close above MSB {msb_text} or reclaim iFVG. Target draw: {target_text}.",
        }
        opposite = {
            "title": "Bearish failure",
            "text": f"If price loses the Context CRT level {raid_level} or cannot reclaim structure, stand down and wait for a fresh HTF draw.",
        }
    elif side == "bearish":
        primary = {
            "title": "Bearish case",
            "text": f"Need buy-side Context CRT to hold, then {trigger_tf} close below MSB {msb_text} or reclaim iFVG. Target draw: {target_text}.",
        }
        opposite = {
            "title": "Bullish failure",
            "text": f"If price reclaims above the Context CRT level {raid_level} or cannot reclaim structure, stand down and wait for a fresh HTF draw.",
        }
    else:
        primary = {
            "title": "Bullish case",
            "text": f"Wait for HTF draw above price, discount location, sell-side Context CRT, then {trigger_tf} bullish MSB/iFVG.",
        }
        opposite = {
            "title": "Bearish case",
            "text": f"Wait for HTF draw below price, premium location, buy-side Context CRT, then {trigger_tf} bearish MSB/iFVG.",
        }
    neutral = {
        "title": "No trade rule",
        "text": f"Current price {_price_text(latest_close)} is only context. No entry without closed displacement and valid invalidation.",
    }
    return [primary, opposite, neutral]


def _desk_chart_url(
    symbol: str,
    timeframe: str,
    at_ms: int | None,
    direction: str,
    *,
    role: str = "trigger",
    htf_target: Any = None,
    reference_level: Any = None,
    sweep_extreme: Any = None,
    msb_level: Any = None,
    msb_at_ms: Any = None,
    htf_raid_at_ms: Any = None,
    fvg_zone: Any = None,
    ifvg_zone: Any = None,
    opposing_zone: Any = None,
    wait_text: str = "",
    setup_label: str = "",
    decision: dict[str, Any] | None = None,
) -> str:
    decision = decision or {}
    params: dict[str, Any] = {
        "symbol": symbol,
        "timeframe": timeframe,
        "limit": 140,
        "role": role,
        "stage": "forming",
        "direction": direction,
        "wait_text": wait_text,
        "setup_label": setup_label,
        "trigger_mode": _desk_trigger_mode(role, reference_level, msb_level, fvg_zone, ifvg_zone),
        "decision_status": decision.get("status") or "",
    }
    if at_ms is not None:
        params["at"] = int(at_ms)
    for key, value in {
        "htf_target": htf_target,
        "reference_level": reference_level,
        "raid_level": reference_level,
        "sweep_extreme": sweep_extreme,
        "raid_extreme": sweep_extreme,
        "msb_level": msb_level,
        "msb_at_ms": msb_at_ms,
        "htf_raid_at_ms": htf_raid_at_ms,
    }.items():
        if value not in (None, ""):
            params[key] = value
    _add_zone_query_params(params, "fvg_zone", fvg_zone)
    _add_zone_query_params(params, "ifvg_zone", ifvg_zone)
    _add_zone_query_params(params, "opposing_zone", opposing_zone)
    return f"/api/chart/png?{urlencode(params)}"


def _desk_trigger_mode(role: str, reference_level: Any, msb_level: Any, fvg_zone: Any, ifvg_zone: Any) -> str:
    if role != "trigger":
        return ""
    if reference_level not in (None, ""):
        return "raid_msb_or_fvg"
    if msb_level not in (None, ""):
        return "msb"
    if ifvg_zone:
        return "ifvg"
    return ""


def _add_zone_query_params(params: dict[str, Any], prefix: str, zone: Any) -> None:
    if not isinstance(zone, dict):
        return
    low = zone.get("low")
    high = zone.get("high")
    if low in (None, "") or high in (None, ""):
        return
    params[f"{prefix}_low"] = low
    params[f"{prefix}_high"] = high
    params[f"{prefix}_kind"] = zone.get("kind") or ""
    params[f"{prefix}_direction"] = zone.get("direction") or ""


def _price_text(value: Any) -> str:
    try:
        if value is None:
            return "n/a"
        number = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if abs(number) >= 100:
        return f"{number:,.2f}"
    if abs(number) >= 1:
        return f"{number:.5f}".rstrip("0").rstrip(".")
    return f"{number:.7f}".rstrip("0").rstrip(".")


def _timeframe_window_ms(timeframe: str, bars: int) -> int:
    unit = timeframe[-1]
    try:
        amount = int(timeframe[:-1])
    except ValueError:
        amount = 15
    minutes = amount
    if unit == "h":
        minutes = amount * 60
    elif unit == "d":
        minutes = amount * 24 * 60
    elif unit == "w":
        minutes = amount * 7 * 24 * 60
    return minutes * 60 * 1000 * max(bars, 1)


def _empty_journal_counts() -> dict[str, int]:
    return {
        JOURNAL_PENDING: 0,
        JOURNAL_TAKEN: 0,
        JOURNAL_SKIPPED: 0,
        "total": 0,
    }


def _empty_journal_stats() -> dict[str, Any]:
    return {
        "taken": 0,
        "closed": 0,
        "open": 0,
        "wins": 0,
        "losses": 0,
        "breakevens": 0,
        "win_rate": None,
        "efficient": 0,
        "evaluated": 0,
        "efficiency_rate": None,
        "avg_r": None,
        "expectancy_r": None,
        "total_r": None,
        "best_r": None,
        "worst_r": None,
        "open_avg_r": None,
        "open_total_r": None,
        "avg_pnl_pct": None,
        "by_setup": {},
        "by_symbol": {},
        "by_grade": {},
        "by_framework_grade": {},
        "by_session": {},
        "by_profile": {},
        "by_direction": {},
        "by_trigger": {},
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _merge_journal(alert: dict[str, Any], journal: TradeJournalStore) -> dict[str, Any]:
    merged = dict(alert)
    alert_key = alert.get("alert_key")
    if not alert_key:
        merged["journal_status"] = "pending"
        merged["journal_notes"] = ""
        return merged

    entry = journal.get(alert_key)
    if entry is None:
        merged["journal_status"] = "pending"
        merged["journal_notes"] = ""
        return merged

    merged["journal_status"] = entry.get("status", "pending")
    merged["journal_notes"] = entry.get("notes", "")
    for key in (
        "outcome",
        "actual_entry",
        "actual_exit",
        "position_size",
        "r_result",
        "pnl_pct",
        "exit_reason",
        "decided_at",
        "closed_at",
    ):
        if key in entry:
            merged[f"journal_{key}"] = entry[key]
    return merged


def _active_alert_allowed(alert: dict[str, Any]) -> bool:
    plan = alert.get("trade_plan") or {}
    grade = normalize_setup_grade(plan.get("setup_grade"))
    return grade not in {"CB", "ML"}


def _auto_skip_note(existing: Any, note: str) -> str:
    existing_text = str(existing or "").strip()
    if not existing_text:
        return note
    if note in existing_text:
        return existing_text
    return f"{existing_text}\n{note}"
