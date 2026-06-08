from __future__ import annotations

import logging
from typing import Any, Callable

from tradebot.journal import make_alert_key
from tradebot.kod import KodSignal, KodTurtleSoupEvaluator, signal_meets_telegram_grade
from tradebot.models import Alert, Candle
from tradebot.setups import SetupEvaluator
from tradebot.state import StateStore
from tradebot.telegram import TelegramNotifier
from tradebot.telegram_chart import build_alert_chart_png


logger = logging.getLogger(__name__)
ScanEventSink = Callable[[dict[str, Any]], None]


class Scanner:
    def __init__(
        self,
        config: AppConfig,
        exchange: ExchangeClient,
        notifier: TelegramNotifier,
        state: StateStore,
        event_sink: ScanEventSink | None = None,
    ):
        self.config = config
        self.exchange = exchange
        self.notifier = notifier
        self.state = state
        self.evaluator = SetupEvaluator()
        self.kod_evaluator = KodTurtleSoupEvaluator()
        self.event_sink = event_sink

    def scan_once(self) -> int:
        alert_count = 0
        enabled_setups = [setup for setup in self.config.setups if setup.enabled]
        self._emit(
            "scan_start",
            "Scan cycle started.",
            detail=f"Checking {len(self.config.scanner.symbols)} symbol(s) across {len(enabled_setups)} active strategy setup(s).",
        )

        for symbol in self.config.scanner.symbols:
            candle_cache: dict[str, list[Candle]] = {}
            self._emit("symbol", f"Scanning {symbol}.", symbol=symbol)

            for setup in self.config.setups:
                if not setup.enabled:
                    continue

                if setup.type == "kod_turtle_soup":
                    alert_count += self._scan_kod_setup(symbol, setup, candle_cache)
                    continue

                self._emit(
                    "strategy",
                    f"Checking {setup.name} on {symbol}.",
                    symbol=symbol,
                    setup=setup.name,
                    timeframe=self.config.scanner.timeframe,
                    looking_for=_condition_brief(setup.conditions),
                    confirmation="All configured rules must be true on the latest closed candle.",
                )
                candles = self._fetch_symbol_candles(symbol, self.config.scanner.timeframe, candle_cache)
                if not candles:
                    continue

                evaluation = self.evaluator.evaluate(setup, candles)
                if not evaluation.matched:
                    logger.info("%s %s did not match: %s", symbol, setup.name, "; ".join(evaluation.details))
                    self._emit(
                        "no_signal",
                        f"{symbol} · {setup.name}: no signal.",
                        symbol=symbol,
                        setup=setup.name,
                        timeframe=self.config.scanner.timeframe,
                        detail="The latest candle does not match the configured rules.",
                    )
                    continue

                candle = candles[-1]
                if not self.state.should_alert(
                    setup.name,
                    symbol,
                    self.config.scanner.timeframe,
                    candle.timestamp_ms,
                    setup.cooldown_minutes,
                ):
                    logger.info("%s %s matched but is inside cooldown", symbol, setup.name)
                    self._emit(
                        "cooldown",
                        f"{symbol} · {setup.name} matched but cooldown is active.",
                        symbol=symbol,
                        setup=setup.name,
                        timeframe=self.config.scanner.timeframe,
                    )
                    continue

                alert = Alert(
                    setup_name=setup.name,
                    symbol=symbol,
                    timeframe=self.config.scanner.timeframe,
                    candle=candle,
                    details=evaluation.details,
                )
                self.notifier.send(alert)
                if not _notifier_dry_run(self.notifier):
                    self.state.mark_alerted(
                        setup.name,
                        symbol,
                        self.config.scanner.timeframe,
                        candle.timestamp_ms,
                    )
                self._emit(
                    "signal",
                    f"{symbol} · {setup.name} signal recorded.",
                    symbol=symbol,
                    setup=setup.name,
                    timeframe=self.config.scanner.timeframe,
                )
                alert_count += 1

        self._emit("scan_complete", "Scan cycle complete.", detail=f"{alert_count} alert(s) generated.")
        return alert_count

    def _scan_kod_setup(self, symbol: str, setup, candle_cache: dict[str, list[Candle]]) -> int:
        alert_count = 0
        profiles = setup.params.get("profiles", [])

        for profile in profiles:
            profile_name = str(profile.get("name") or "profile")
            context_timeframe = str(profile["context_timeframe"])
            trigger_timeframe = str(profile["trigger_timeframe"])
            self._emit(
                "strategy",
                f"Looking for KOD Turtle Soup Reclaim on {symbol}.",
                symbol=symbol,
                setup=setup.name,
                profile=profile_name,
                context_timeframe=context_timeframe,
                trigger_timeframe=trigger_timeframe,
                looking_for=[
                    "YTL/HTF bias: trigger signal must agree with HTF liquidity direction.",
                    "Nearby unclaimed HTF swing/equal liquidity objective.",
                    f"Context CRT: important {context_timeframe} candle high/low must be raided and reclaimed first.",
                    f"Trigger: fast {trigger_timeframe} MSB close or iFVG reclaim after Context CRT.",
                    "Displacement guard: trigger candle must show real directional expansion, not a weak close.",
                    "Session quality: London / New York killzone receives higher grade; outside session is marked weaker.",
                    _freshness_brief(setup.params, profile_name, trigger_timeframe),
                    "No-chase guard: hide setups already beyond the configured ATR/R distance from entry.",
                    "Fresh FVG is confluence only; confirmation requires MSB or iFVG reclaim.",
                    "Target guard: TP2 must be meaningful in R terms; weak target maps are blocked or downgraded.",
                ],
                confirmation=f"Wait for {context_timeframe} Context CRT first, then {trigger_timeframe} MSB or iFVG confirmation.",
            )
            context_candles = self._fetch_symbol_candles(
                symbol,
                context_timeframe,
                candle_cache,
                include_open=bool(setup.params.get("previous_candle_sweep", True)),
            )
            trigger_candles = self._fetch_symbol_candles(symbol, trigger_timeframe, candle_cache)
            if not context_candles or not trigger_candles:
                continue

            self._hide_missed_kod_alerts(symbol, setup, profile_name, trigger_timeframe, trigger_candles[-1].close)
            self._auto_invalidate_kod_alerts(symbol, setup, profile_name, trigger_timeframe, trigger_candles[-1].close)
            signals = self.kod_evaluator.evaluate(setup, profile, context_candles, trigger_candles)
            if not signals:
                diagnostic = self.kod_evaluator.diagnose(setup, profile, context_candles, trigger_candles)
                self._hide_inactive_kod_forming_alerts(symbol, setup, profile_name, trigger_timeframe)
                logger.info(
                    "%s %s produced no KOD signals for %s/%s",
                    symbol,
                    setup.name,
                    context_timeframe,
                    trigger_timeframe,
                )
                self._emit(
                    "no_signal",
                    f"{symbol} · {profile_name}: no KOD signal.",
                    symbol=symbol,
                    setup=setup.name,
                    profile=profile_name,
                    context_timeframe=context_timeframe,
                    trigger_timeframe=trigger_timeframe,
                    detail=diagnostic.get("headline") or "HTF sweep, liquidity objective, and trigger confirmation are not aligned right now.",
                    diagnostic=diagnostic,
                )
                continue

            for signal in signals:
                if self._send_kod_signal(symbol, setup, signal, trigger_candles):
                    alert_count += 1

        return alert_count

    def _hide_missed_kod_alerts(
        self,
        symbol: str,
        setup,
        profile_name: str,
        trigger_timeframe: str,
        current_price: float,
    ) -> None:
        if not bool(setup.params.get("hide_missed_setups", True)):
            return
        dismiss_missed = getattr(self.notifier, "dismiss_missed_setups", None)
        if not callable(dismiss_missed):
            return
        dismissed = dismiss_missed(
            setup_name=setup.name,
            symbol=symbol,
            timeframe=trigger_timeframe,
            profile=profile_name,
            current_price=current_price,
            max_chase_atr=float(setup.params.get("max_chase_atr", 0.75)),
            max_chase_r=float(setup.params.get("max_chase_r", 0.75)),
        )
        if dismissed:
            self._emit(
                "cleanup",
                f"{symbol} · {profile_name}: hidden {len(dismissed)} missed setup(s).",
                symbol=symbol,
                setup=setup.name,
                profile=profile_name,
                timeframe=trigger_timeframe,
                detail="Price moved too far from the planned entry, so the dashboard removed stale actionable alerts.",
            )

    def _hide_inactive_kod_forming_alerts(
        self,
        symbol: str,
        setup,
        profile_name: str,
        trigger_timeframe: str,
    ) -> None:
        dismiss_inactive = getattr(self.notifier, "dismiss_inactive_forming_setups", None)
        if not callable(dismiss_inactive):
            return
        dismissed = dismiss_inactive(
            setup_name=setup.name,
            symbol=symbol,
            timeframe=trigger_timeframe,
            profile=profile_name,
            reason="no_current_signal",
        )
        if dismissed:
            self._emit(
                "cleanup",
                f"{symbol} · {profile_name}: hidden {len(dismissed)} stale forming setup(s).",
                symbol=symbol,
                setup=setup.name,
                profile=profile_name,
                timeframe=trigger_timeframe,
                detail="The latest scan no longer matches the setup, so the dashboard removed the old forming alert.",
            )

    def _auto_invalidate_kod_alerts(
        self,
        symbol: str,
        setup,
        profile_name: str,
        trigger_timeframe: str,
        current_price: float,
    ) -> None:
        dismiss_invalidated = getattr(self.notifier, "dismiss_invalidated_setups", None)
        if not callable(dismiss_invalidated):
            return
        dismissed = dismiss_invalidated(
            setup_name=setup.name,
            symbol=symbol,
            timeframe=trigger_timeframe,
            profile=profile_name,
            current_price=current_price,
        )
        if dismissed:
            self._emit(
                "cleanup",
                f"{symbol} · {profile_name}: invalidated {len(dismissed)} active setup(s).",
                symbol=symbol,
                setup=setup.name,
                profile=profile_name,
                timeframe=trigger_timeframe,
                detail="Price traded beyond the planned invalidation area, so the dashboard removed stale active alerts.",
            )

    def _send_kod_signal(self, symbol: str, setup, signal: KodSignal, trigger_candles: list[Candle]) -> bool:
        trade_plan = dict(signal.trade_plan or {})
        alert_key = _kod_alert_key(symbol, setup, signal, trade_plan)
        if trade_plan.get("raid_timestamp_ms") is not None:
            trade_plan["lifecycle_key"] = alert_key
        telegram_enabled = signal_meets_telegram_grade(signal, setup.params)
        alert = Alert(
            setup_name=setup.name,
            symbol=symbol,
            timeframe=signal.trigger_timeframe,
            candle=signal.candle,
            details=signal.details,
            stage=signal.stage,
            direction=signal.direction,
            profile=signal.profile_name,
            context_timeframe=signal.context_timeframe,
            trigger_timeframe=signal.trigger_timeframe,
            trade_plan=trade_plan,
            alert_key=alert_key,
            signal_alert_id=signal.alert_id,
            trigger_candle=signal.trigger_candle,
            telegram_enabled=telegram_enabled,
        )
        chart_png = None
        try:
            chart_png = build_alert_chart_png(alert, trigger_candles)
        except Exception:
            logger.exception("failed to build Telegram chart for %s %s", symbol, signal.alert_id)
        if chart_png:
            alert = Alert(
                setup_name=alert.setup_name,
                symbol=alert.symbol,
                timeframe=alert.timeframe,
                candle=alert.candle,
                details=alert.details,
                stage=alert.stage,
                direction=alert.direction,
                profile=alert.profile,
                context_timeframe=alert.context_timeframe,
                trigger_timeframe=alert.trigger_timeframe,
                trade_plan=alert.trade_plan,
                alert_key=alert.alert_key,
                signal_alert_id=alert.signal_alert_id,
                trigger_candle=alert.trigger_candle,
                chart_png=chart_png,
                chart_caption=f"{symbol} · {signal.profile_name} · {signal.stage.upper()} · {signal.trigger_timeframe} chart",
                telegram_enabled=alert.telegram_enabled,
            )
        cooldown_candle_ms = int(trade_plan.get("raid_timestamp_ms") or signal.candle.timestamp_ms)
        cooldown_alert_id = f"{alert_key}:{signal.stage}" if trade_plan.get("raid_timestamp_ms") is not None else signal.alert_id
        should_notify = self.state.should_alert(
            setup.name,
            symbol,
            signal.trigger_timeframe,
            cooldown_candle_ms,
            setup.cooldown_minutes,
            alert_id=cooldown_alert_id,
        )
        self.notifier.send(alert, refresh_only=not should_notify)
        if not should_notify:
            logger.info("%s %s %s is inside cooldown (refreshed store)", symbol, setup.name, signal.alert_id)
            self._emit(
                "cooldown",
                f"{setup.name} · {signal.stage} signal is in cooldown; details were refreshed.",
                symbol=symbol,
                setup=setup.name,
                profile=signal.profile_name,
                timeframe=signal.trigger_timeframe,
            )
            return False

        if not _notifier_dry_run(self.notifier):
            self.state.mark_alerted(
                setup.name,
                symbol,
                signal.trigger_timeframe,
                cooldown_candle_ms,
                alert_id=cooldown_alert_id,
            )
        stage_labels = {"forming": "forming", "confirmed": "confirmed", "invalidated": "invalidated"}
        stage_label = stage_labels.get(signal.stage, signal.stage)
        self._emit(
            "signal",
            f"{symbol} · KOD signal recorded ({stage_label}).",
            symbol=symbol,
            setup=setup.name,
            profile=signal.profile_name,
            timeframe=signal.trigger_timeframe,
            detail="Entry, stop, targets, and explanation are available in the Signals panel.",
        )
        return True

    def _fetch_symbol_candles(
        self,
        symbol: str,
        timeframe: str,
        candle_cache: dict[str, list[Candle]],
        include_open: bool = False,
    ) -> list[Candle]:
        cache_key = f"{timeframe}:open={include_open}"
        if cache_key in candle_cache:
            return candle_cache[cache_key]

        limit = self.config.scanner.candle_limit + (1 if self.config.scanner.use_closed_candle else 0)
        self._emit(
            "data",
            f"Loading {timeframe} candles for {symbol}.",
            symbol=symbol,
            timeframe=timeframe,
            detail=f"Requesting up to {limit} candles from the exchange.",
        )
        try:
            candles = self.exchange.fetch_candles(symbol, timeframe, limit)
        except Exception:
            logger.exception("failed to fetch candles for %s %s", symbol, timeframe)
            self._emit(
                "error",
                f"Failed to load {timeframe} candles for {symbol}.",
                symbol=symbol,
                timeframe=timeframe,
                detail="The exchange request failed. Check system logs for details.",
            )
            return []

        if self.config.scanner.use_closed_candle and candles and not include_open:
            candles = candles[:-1]

        candle_cache[cache_key] = candles
        logger.info("fetched %s candles for %s %s", len(candles), symbol, timeframe)
        return candles

    def _emit(self, phase: str, message: str, **fields: Any) -> None:
        if self.event_sink is None:
            return
        event = {"phase": phase, "message": message, **fields}
        self.event_sink(event)


def _condition_brief(conditions: dict[str, Any]) -> list[str]:
    names = _condition_names(conditions)
    if not names:
        return ["Configured condition stack on the latest closed candle."]
    return names


def _notifier_dry_run(notifier: Any) -> bool:
    if hasattr(notifier, "dry_run"):
        return bool(getattr(notifier, "dry_run"))
    telegram = getattr(notifier, "telegram", None)
    return bool(getattr(telegram, "dry_run", False))


def _kod_alert_key(symbol: str, setup: Any, signal: KodSignal, trade_plan: dict[str, Any]) -> str:
    if bool(setup.params.get("one_alert_per_raid", False)) and trade_plan.get("raid_timestamp_ms") is not None:
        return "|".join(
            [
                setup.name,
                symbol,
                signal.profile_name,
                signal.direction,
                str(int(trade_plan["raid_timestamp_ms"])),
            ]
        )
    return make_alert_key(
        setup.name,
        symbol,
        signal.trigger_timeframe,
        signal.stage,
        signal.direction,
        signal.profile_name,
        signal.candle.timestamp_ms,
        signal.alert_id,
    )


def _freshness_brief(params: dict[str, Any], profile_name: str, trigger_timeframe: str) -> str:
    by_profile = params.get("freshness_bars_by_profile")
    bars = None
    if isinstance(by_profile, dict):
        try:
            bars = int(by_profile.get(str(profile_name).lower()))
        except (TypeError, ValueError):
            bars = None
    if bars is None:
        try:
            bars = int(params.get("htf_raid_confirmation_bars", 8))
        except (TypeError, ValueError):
            bars = 8
    return f"Freshness: confirmation must happen within {max(1, bars)} {trigger_timeframe} bars after Context CRT."


def _condition_names(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    if "all" in node:
        return [item for child in node["all"] for item in _condition_names(child)]
    if "any" in node:
        return [item for child in node["any"] for item in _condition_names(child)]

    indicator = node.get("indicator")
    if indicator == "ema_cross":
        return [f"EMA{node.get('fast', 9)} / EMA{node.get('slow', 21)} {node.get('direction', 'bullish')} cross."]
    if indicator == "rsi":
        return [f"RSI{node.get('period', 14)} {node.get('operator', '>=')} {node.get('value')}."]
    if indicator == "price_vs_ema":
        return [f"Price {node.get('relation', 'above')} EMA{node.get('period', 200)}."]
    if indicator == "volume_spike":
        return [f"Volume spike versus {node.get('lookback', 20)}-bar average."]
    if indicator == "macd_cross":
        return [f"MACD {node.get('direction', 'bullish')} cross."]
    if indicator:
        return [f"{indicator} condition."]
    return []


def _uses_msb_profile(profile_name: str, context_timeframe: str, trigger_timeframe: str, params: dict[str, Any]) -> bool:
    msb_profiles = {str(item).lower() for item in params.get("msb_profiles", ["swing"])}
    profile_key = str(profile_name or "").lower()
    context_key = str(context_timeframe or "").lower()
    trigger_key = str(trigger_timeframe or "").lower()
    return (
        profile_key in msb_profiles
        or (context_key == "1d" and trigger_key == "1h")
        or (context_key == "4h" and trigger_key == "15m")
    )
