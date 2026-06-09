from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tradebot.config import SetupConfig
from tradebot.indicators import atr, sma
from tradebot.models import Candle


STAGE_FORMING = "forming"
STAGE_CONFIRMED = "confirmed"
STAGE_INVALIDATED = "invalidated"
TOP_SETUP_GRADE = "A+"
GRADE_A = "A"
GRADE_CB = "CB"
GRADE_ML = "ML"
VISIBLE_SETUP_GRADES = {TOP_SETUP_GRADE, GRADE_A, GRADE_CB, GRADE_ML}
LEGACY_GRADE_MAP = {"B": GRADE_A, "C": GRADE_CB, "D": GRADE_ML}
GRADE_ORDER = {GRADE_ML: 0, GRADE_CB: 1, GRADE_A: 2, TOP_SETUP_GRADE: 3}
CRT_FRAMEWORK_VERSION = "crt_secrets_pdf_v1"
CRT_SOURCE_DOCUMENT = "CRT Secrets Series - Book"
CRT_SOURCE_SHA256 = "e0f62372112170ada2f78ba79f3954ddd11eda68a8889b5964a0bde47e1c4ae6"


@dataclass(frozen=True)
class KodSignal:
    stage: str
    direction: str
    profile_name: str
    context_timeframe: str
    trigger_timeframe: str
    candle: Candle
    alert_id: str
    details: list[str]
    trade_plan: dict[str, Any] | None = None
    trigger_candle: Candle | None = None


@dataclass(frozen=True)
class QualityResult:
    grade: str
    action: str
    lines: list[str]
    score: int = 0
    max_score: int = 0
    weak_points: list[str] | None = None


@dataclass(frozen=True)
class LiquidityObjective:
    direction: str
    level: float
    kind: str
    distance_atr: float


@dataclass(frozen=True)
class FvgZone:
    kind: str
    direction: str
    low: float
    high: float
    index: int

    @property
    def midpoint(self) -> float:
        return (self.low + self.high) / 2


@dataclass(frozen=True)
class HtfAlignment:
    direction: str
    status: str
    bias: str
    objective: LiquidityObjective | None
    reasons: list[str]
    blockers: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    @property
    def watch_only(self) -> bool:
        return self.status == "watch_only"


@dataclass(frozen=True)
class ReferenceLevel:
    level: float
    age: int
    range_high: float
    range_low: float


@dataclass(frozen=True)
class HtfRaid:
    direction: str
    candle: Candle
    level: float
    sweep_extreme: float
    trigger_index: int
    bars_since_raid: int
    candle_label: str


@dataclass(frozen=True)
class OrderBlockZone:
    kind: str
    direction: str
    low: float
    high: float
    index: int

    @property
    def midpoint(self) -> float:
        return (self.low + self.high) / 2


class KodTurtleSoupEvaluator:
    def diagnose(
        self,
        setup: SetupConfig,
        profile: dict[str, Any],
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        framework_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        settings = _settings(setup.params)
        profile_name = str(profile.get("name") or f"{profile.get('context_timeframe')}-{profile.get('trigger_timeframe')}")
        context_timeframe = str(profile.get("context_timeframe") or "")
        trigger_timeframe = str(profile.get("trigger_timeframe") or "")
        checks: list[dict[str, str]] = []
        directions: list[dict[str, Any]] = []

        min_context = settings["minimum_context_candles"]
        if len(context_candles) < min_context:
            return _diagnostic_payload(
                profile_name,
                context_timeframe,
                trigger_timeframe,
                "Not enough HTF candles yet.",
                [_diagnostic_check("HTF candles", "block", f"{len(context_candles)}/{min_context} loaded")],
                directions,
            )

        min_trigger = (
            max(settings["msb_lookback"], settings["msb_span"] * 2 + 6)
            if _uses_msb_trigger(profile_name, context_timeframe, trigger_timeframe, settings)
            else settings["lookback"] + 3
        )
        if len(trigger_candles) < min_trigger:
            return _diagnostic_payload(
                profile_name,
                context_timeframe,
                trigger_timeframe,
                "Not enough trigger candles yet.",
                [_diagnostic_check("Trigger candles", "block", f"{len(trigger_candles)}/{min_trigger} loaded")],
                directions,
            )

        context_atr = _latest_atr(context_candles)
        trigger_atr = _latest_atr(trigger_candles)
        if context_atr is None or trigger_atr is None or context_atr <= 0 or trigger_atr <= 0:
            return _diagnostic_payload(
                profile_name,
                context_timeframe,
                trigger_timeframe,
                "ATR is not ready yet.",
                [_diagnostic_check("ATR", "block", "Need enough candle history for context and trigger ATR.")],
                directions,
            )

        checks.append(_diagnostic_check("Data", "pass", f"{context_timeframe} and {trigger_timeframe} candles loaded."))
        checks.append(_diagnostic_check("ATR", "pass", f"{context_timeframe} {_fmt(context_atr)} · {trigger_timeframe} {_fmt(trigger_atr)}"))

        objectives = self._find_objectives(
            context_candles,
            context_atr,
            settings["objective_max_atr"],
            settings["objective_lookback"],
            settings["swing_span"],
        )
        if not objectives:
            checks.append(
                _diagnostic_check(
                    "HTF draw",
                    "wait",
                    f"No unclaimed swing/equal high or low within {settings['objective_max_atr']:.2f} ATR.",
                )
            )
            return _diagnostic_payload(
                profile_name,
                context_timeframe,
                trigger_timeframe,
                "Waiting for a nearby HTF draw.",
                checks,
                directions,
            )

        for objective in objectives:
            alignment = _htf_alignment(objective.direction, context_candles, objectives, settings)
            raid = None
            if alignment.passed:
                raid = _find_htf_raid(
                    context_candles,
                    trigger_candles,
                    objective.direction,
                    profile_name,
                    context_timeframe,
                    context_atr,
                    settings,
                )
            model1_signal = (
                _model1_signal(trigger_candles, objective.direction, raid.trigger_index, trigger_atr, settings)
                if raid is not None
                else None
            )
            mss_signal = _msb_signal(trigger_candles, objective.direction, trigger_atr, settings)
            trigger_signal = model1_signal or mss_signal
            trigger_confirmed = trigger_signal is not None
            msb = mss_signal or _next_msb_level(trigger_candles, objective.direction, settings)
            displacement = _displacement_result(trigger_candles[-1], objective.direction, trigger_atr, settings)
            quality = _assess_setup_quality(
                STAGE_CONFIRMED if trigger_confirmed else STAGE_FORMING,
                settings["filters"],
                objective.direction,
                context_candles,
                trigger_candles,
                settings,
            )
            zones = _fvg_zones(trigger_candles, settings["fvg_lookback"])
            supportive_fvg = _nearest_zone(zones, objective.direction, trigger_candles[-1].close, kind="fvg")
            supportive_ifvg = _nearest_zone(zones, objective.direction, trigger_candles[-1].close, kind="ifvg")
            diagnostic_trade_plan = _build_trade_plan(
                float((trigger_signal or {}).get("entry") or trigger_candles[-1].close),
                _stop_level(
                    objective.direction,
                    float(raid.sweep_extreme if raid is not None else trigger_candles[-1].low if objective.direction == "bullish" else trigger_candles[-1].high),
                    trigger_atr,
                    settings["stop_buffer_atr"],
                ),
                final_target=objective.level,
            )
            framework_gate = _pdf_framework_gate(
                objective.direction,
                objective,
                raid,
                trigger_signal,
                diagnostic_trade_plan,
                framework_context,
                context_timeframe,
                trigger_timeframe,
                trigger_candles,
                supportive_fvg=supportive_fvg,
                supportive_ifvg=supportive_ifvg,
            )
            diagnostic_gate = _diagnostic_gate(
                STAGE_FORMING,
                alignment,
                raid,
                displacement,
                quality,
                settings,
                trigger_confirmed=trigger_confirmed,
                trigger_timeframe=trigger_timeframe,
                framework_gate=framework_gate,
            )

            if not alignment.passed:
                next_step = "HTF bias is not clean enough."
                status = "block"
            elif raid is None:
                next_step = f"Waiting for {context_timeframe} Candle 2 Turtle Soup raid and reclaim."
                status = "block"
            elif trigger_confirmed:
                next_step = f"{trigger_timeframe} Candle 3 {str(trigger_signal.get('trigger_mode')).upper()} confirmed after Turtle Soup."
                status = "pass" if not diagnostic_gate["blockers"] else "block"
            elif msb is not None:
                close_side = "above" if objective.direction == "bullish" else "below"
                next_step = f"Need Candle 3 close {close_side} MSS level {_fmt(float(msb['level']))} or Model #1 trigger."
                status = "wait"
            else:
                next_step = f"Waiting for {trigger_timeframe} Candle 3 Model #1 or MSS after Turtle Soup."
                status = "wait"

            directions.append(
                {
                    "direction": objective.direction,
                    "status": status,
                    "objective": {
                        "level": objective.level,
                        "kind": objective.kind,
                        "distance_atr": round(objective.distance_atr, 2),
                    },
                    "alignment": alignment.status,
                    "raid": _diagnostic_raid(raid),
                    "context_crt": _diagnostic_raid(raid),
                    "msb_level": float(msb["level"]) if msb is not None else None,
                    "msb_timestamp_ms": int(msb["level_timestamp_ms"]) if msb is not None else None,
                    "trigger_mode": str((trigger_signal or {}).get("trigger_mode") or ""),
                    "trigger_confirmed": trigger_confirmed,
                    "framework_version": CRT_FRAMEWORK_VERSION,
                    "source_document": CRT_SOURCE_DOCUMENT,
                    "htf_narrative": framework_gate.get("htf_narrative"),
                    "key_level": framework_gate.get("key_level"),
                    "crt_phase": framework_gate.get("crt_phase"),
                    "candle_1": framework_gate.get("candle_1"),
                    "candle_2": framework_gate.get("candle_2"),
                    "candle_3": framework_gate.get("candle_3"),
                    "model1_trigger": framework_gate.get("model1_trigger"),
                    "mss_trigger": framework_gate.get("mss_trigger"),
                    "fvg_confluence": framework_gate.get("fvg_confluence"),
                    "smt_status": framework_gate.get("smt_status"),
                    "session_gate": framework_gate.get("session_gate"),
                    "target_50": framework_gate.get("target_50"),
                    "plan_b": framework_gate.get("plan_b"),
                    "displacement": {
                        "passed": bool(displacement["passed"]),
                        "body_ratio": round(float(displacement["body_ratio"]), 2),
                        "range_atr": round(float(displacement["range_atr"]), 2),
                        "reasons": list(displacement["reasons"]),
                    },
                    "quality": {
                        "grade": quality.grade,
                        "action": quality.action,
                        "score": quality.score,
                        "max_score": quality.max_score,
                        "warnings": list(quality.weak_points or []),
                    },
                    "gate": diagnostic_gate,
                    "fvg": _diagnostic_zone(supportive_fvg),
                    "ifvg": _diagnostic_zone(supportive_ifvg),
                    "next_step": next_step,
                    "blockers": list(alignment.blockers),
                    "reasons": list(alignment.reasons),
                }
            )

        headline = _diagnostic_headline(directions)
        checks.append(_diagnostic_check("HTF draw", "pass", f"{len(objectives)} objective(s) nearby."))
        return _diagnostic_payload(profile_name, context_timeframe, trigger_timeframe, headline, checks, directions)

    def evaluate(
        self,
        setup: SetupConfig,
        profile: dict[str, Any],
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        framework_context: dict[str, Any] | None = None,
    ) -> list[KodSignal]:
        settings = _settings(setup.params)
        if len(context_candles) < settings["minimum_context_candles"]:
            return []

        profile_name = str(profile.get("name") or f"{profile['context_timeframe']}-{profile['trigger_timeframe']}")
        context_timeframe = str(profile["context_timeframe"])
        trigger_timeframe = str(profile["trigger_timeframe"])
        if _uses_msb_trigger(profile_name, context_timeframe, trigger_timeframe, settings):
            min_trigger_candles = max(settings["msb_lookback"], settings["msb_span"] * 2 + 6)
        else:
            min_trigger_candles = settings["lookback"] + 3
        if len(trigger_candles) < min_trigger_candles:
            return []
        context_atr = _latest_atr(context_candles)
        trigger_atr = _latest_atr(trigger_candles)
        if context_atr is None or trigger_atr is None or context_atr <= 0 or trigger_atr <= 0:
            return []

        signals: list[KodSignal] = []

        objectives = self._find_objectives(
            context_candles,
            context_atr,
            settings["objective_max_atr"],
            settings["objective_lookback"],
            settings["swing_span"],
        )
        if not objectives:
            return signals

        for objective in objectives:
            signal = self._evaluate_direction(
                setup,
                profile_name,
                context_timeframe,
                trigger_timeframe,
                context_candles,
                trigger_candles,
                context_atr,
                trigger_atr,
                objective,
                objectives,
                settings,
                framework_context,
            )
            if signal is not None and signal.stage in settings["alert_stages"]:
                finalized = _finalize_kod_signal(signal, settings)
                if finalized is not None and _signal_allowed_by_stage_grade(finalized, settings):
                    signals.append(finalized)

        return signals

    def _previous_context_candle_signal(
        self,
        setup: SetupConfig,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        settings: dict[str, Any],
    ) -> KodSignal | None:
        if len(context_candles) < 4:
            return None

        # Use the last closed HTF candle so the warning does not repaint.
        current_context = context_candles[-2]
        previous_context = context_candles[-3]
        latest_trigger = trigger_candles[-1]
        bullish_sweep = current_context.low < previous_context.low
        bullish_reclaim = bullish_sweep and current_context.close > previous_context.low
        bearish_sweep = current_context.high > previous_context.high
        bearish_reclaim = bearish_sweep and current_context.close < previous_context.high

        if bullish_reclaim:
            direction = "bullish"
            level = previous_context.low
            sweep_extreme = current_context.low
            trigger_ok = latest_trigger.close > level
        elif bearish_reclaim:
            direction = "bearish"
            level = previous_context.high
            sweep_extreme = current_context.high
            trigger_ok = latest_trigger.close < level
        else:
            return None

        stop = _stop_level(direction, sweep_extreme, trigger_atr, settings["stop_buffer_atr"])
        stop_buffer = trigger_atr * settings["stop_buffer_atr"]
        entry_guide = level
        tp1 = entry_guide + abs(entry_guide - stop) if direction == "bullish" else entry_guide - abs(entry_guide - stop)

        objectives = self._find_objectives(
            context_candles,
            context_atr,
            settings["objective_max_atr"],
            settings["objective_lookback"],
            settings["swing_span"],
        )
        matching_objective = next((obj for obj in objectives if obj.direction == direction), None)
        alignment = _htf_alignment(direction, context_candles, objectives, settings)
        if not alignment.passed and not settings["htf_allow_forming_without_alignment"]:
            return None
        final_target = matching_objective.level if matching_objective else None

        trade_plan = _build_trade_plan(entry_guide, stop, tp1=tp1, final_target=final_target)
        trade_plan["reference_level"] = level
        trade_plan["sweep_extreme"] = sweep_extreme
        trade_plan["stop_buffer"] = stop_buffer
        trade_plan["trigger_atr"] = trigger_atr
        trade_plan["context_atr"] = context_atr
        _apply_alignment_to_trade_plan(trade_plan, alignment)
        if _missed_setup_reason(direction, latest_trigger.close, entry_guide, trigger_atr, trade_plan.get("risk"), settings):
            return None

        level_label = "low" if direction == "bullish" else "high"
        stop_side = "below the taken low plus ATR buffer" if direction == "bullish" else "above the taken high plus ATR buffer"
        quality = _assess_setup_quality(
            STAGE_FORMING,
            settings["filters"],
            direction,
            context_candles,
            trigger_candles,
            settings,
        )
        _apply_quality_to_trade_plan(trade_plan, quality)
        _apply_gate_to_trade_plan(trade_plan, _hard_quality_blockers(quality))
        _apply_institutional_context(
            trade_plan,
            direction,
            context_timeframe,
            trigger_timeframe,
            context_candles,
            trigger_candles,
            settings,
            objective=matching_objective,
            reference_level=level,
            sweep_extreme=sweep_extreme,
        )
        details = [
            "Summary: Early HTF warning only. No trigger confirmation yet; do not enter from this alert.",
            f"Side: {_direction_text(direction)} · Stage: FORMING",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            *_narrative_thesis(
                stage="previous_context",
                direction=direction,
                context_timeframe=context_timeframe,
                trigger_timeframe=trigger_timeframe,
                objective=matching_objective,
                level=level,
                sweep_extreme=sweep_extreme,
                lookback=settings["lookback"],
            ),
            *_htf_alignment_details(alignment),
            f"What happened?: The last closed {context_timeframe} candle took the previous {context_timeframe} {level_label} and closed back inside.",
            f"Reference level: {_fmt(level)} · Wick extreme: {_fmt(sweep_extreme)}",
            f"Stop guide: {_fmt(stop)} — {stop_side}",
            f"Entry guide: {_fmt(entry_guide)} (reclaim level) · Current {trigger_timeframe}: {_fmt(latest_trigger.close)}",
            f"TP1 guide: {_fmt(tp1)} — 1R from the guided entry",
            *_rr_details(trade_plan),
            f"HTF state: {context_timeframe} close {_fmt(current_context.close)} is back {'above' if direction == 'bullish' else 'below'} the reference level. This is still not a trade trigger.",
            f"Trigger state: latest {trigger_timeframe} close {_fmt(latest_trigger.close)} is {'back through' if trigger_ok else 'not back through'} the reference level. Location only; not confirmation.",
            (
                f"Confirmation needed: on {trigger_timeframe}, candle must close "
                f"{'above' if direction == 'bullish' else 'below'} the recent MSS level."
                if _uses_msb_trigger(profile_name, context_timeframe, trigger_timeframe, settings)
                else f"Confirmation needed: on {trigger_timeframe}, price must take the prior {settings['lookback']}-bar {'low' if direction == 'bullish' else 'high'} and close back through it."
            ),
            f"Volatility: {context_timeframe} ATR {_fmt(context_atr)} · {trigger_timeframe} ATR {_fmt(trigger_atr)}",
            *_institutional_detail_lines(trade_plan),
            "Note: The bot does not place orders. Treat this as watchlist context until a confirmed trigger appears.",
            *quality.lines,
        ]

        return KodSignal(
            stage=STAGE_FORMING,
            direction=direction,
            profile_name=profile_name,
            context_timeframe=context_timeframe,
            trigger_timeframe=trigger_timeframe,
            candle=current_context,
            trigger_candle=latest_trigger,
            alert_id=f"{_alert_id(setup, profile_name, direction, STAGE_FORMING)}:previous_context_candle",
            details=details,
            trade_plan=trade_plan,
        )

    def _find_objectives(
        self,
        candles: list[Candle],
        current_atr: float,
        objective_max_atr: float,
        lookback: int,
        swing_span: int,
    ) -> list[LiquidityObjective]:
        current_close = candles[-1].close
        tolerance = current_atr * 0.1
        start = max(0, len(candles) - lookback - 1)
        end = len(candles) - swing_span - 1
        swing_highs: list[float] = []
        swing_lows: list[float] = []

        for index in range(max(swing_span, start), end):
            window = candles[index - swing_span : index + swing_span + 1]
            candle = candles[index]
            if candle.high >= max(item.high for item in window):
                if not any(item.high > candle.high + tolerance for item in candles[index + 1 :]):
                    swing_highs.append(candle.high)
            if candle.low <= min(item.low for item in window):
                if not any(item.low < candle.low - tolerance for item in candles[index + 1 :]):
                    swing_lows.append(candle.low)

        objectives: list[LiquidityObjective] = []
        high_objective = _nearest_above(swing_highs, current_close, current_atr, objective_max_atr)
        if high_objective is not None:
            objectives.append(
                LiquidityObjective(
                    direction="bullish",
                    level=high_objective,
                    kind=_liquidity_kind(swing_highs, high_objective, tolerance, "high"),
                    distance_atr=(high_objective - current_close) / current_atr,
                )
            )

        low_objective = _nearest_below(swing_lows, current_close, current_atr, objective_max_atr)
        if low_objective is not None:
            objectives.append(
                LiquidityObjective(
                    direction="bearish",
                    level=low_objective,
                    kind=_liquidity_kind(swing_lows, low_objective, tolerance, "low"),
                    distance_atr=(current_close - low_objective) / current_atr,
                )
            )

        return objectives

    def _evaluate_direction(
        self,
        setup: SetupConfig,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        objectives: list[LiquidityObjective],
        settings: dict[str, Any],
        framework_context: dict[str, Any] | None,
    ) -> KodSignal | None:
        current = trigger_candles[-1]
        alignment = _htf_alignment(objective.direction, context_candles, objectives, settings)
        if not _uses_msb_trigger(profile_name, context_timeframe, trigger_timeframe, settings):
            return None
        return self._evaluate_msb_direction(
            setup,
            profile_name,
            context_timeframe,
            trigger_timeframe,
            context_candles,
            trigger_candles,
            context_atr,
            trigger_atr,
            objective,
            alignment,
            settings,
            framework_context,
        )

    def _evaluate_msb_direction(
        self,
        setup: SetupConfig,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        alignment: HtfAlignment,
        settings: dict[str, Any],
        framework_context: dict[str, Any] | None,
    ) -> KodSignal | None:
        current = trigger_candles[-1]
        if not alignment.passed:
            return None
        raid = _find_htf_raid(
            context_candles,
            trigger_candles,
            objective.direction,
            profile_name,
            context_timeframe,
            context_atr,
            settings,
        )
        if raid is None:
            return None

        model1 = _model1_signal(trigger_candles, objective.direction, raid.trigger_index, trigger_atr, settings)
        mss = _msb_signal(trigger_candles, objective.direction, trigger_atr, settings)
        zones = _fvg_zones(trigger_candles, settings["fvg_lookback"])
        supportive_fvg = _nearest_zone(zones, objective.direction, current.close, kind="fvg")
        supportive_ifvg = _nearest_zone(zones, objective.direction, current.close, kind="ifvg")

        if model1 is not None or mss is not None:
            trigger = model1 if model1 is not None else mss
            assert trigger is not None
            entry = float(trigger["entry"])
            stop_base = float(raid.sweep_extreme)
            stop = _stop_level(objective.direction, stop_base, trigger_atr, settings["stop_buffer_atr"])
            target_plan = _setup_targets(
                objective.direction,
                entry,
                stop,
                objective,
                trigger_candles,
                settings,
            )
            if target_plan.get("target_blocker"):
                return None
            trade_plan = _build_trade_plan(
                entry,
                stop,
                tp1=target_plan["tp1"],
                tp2=target_plan["tp2"],
                final_target=target_plan["final_target"],
            )
            _apply_target_plan(trade_plan, target_plan)
            trigger_mode = str(trigger.get("trigger_mode") or "msb")
            trade_plan["trigger_mode"] = trigger_mode
            if trigger_mode == "model1":
                trade_plan["model1_trigger"] = _model1_plan(trigger)
            if trigger_mode == "mss":
                trade_plan["mss_trigger"] = _mss_plan(trigger)
                trade_plan["msb_level"] = float(trigger["level"])
                if trigger.get("level_timestamp_ms") is not None:
                    trade_plan["msb_timestamp_ms"] = int(trigger["level_timestamp_ms"])
            trade_plan["structure_stop"] = stop_base
            trade_plan["trigger_atr"] = trigger_atr
            trade_plan["context_atr"] = context_atr
            trade_plan["reference_level"] = raid.level
            trade_plan["sweep_extreme"] = raid.sweep_extreme
            trade_plan["htf_raid_candle"] = _raid_candle_plan(raid)
            _apply_context_crt_to_trade_plan(trade_plan, raid)
            _apply_raid_lifecycle(trade_plan, raid)
            _apply_alignment_to_trade_plan(trade_plan, alignment)
            framework_gate = _pdf_framework_gate(
                objective.direction,
                objective,
                raid,
                trigger,
                trade_plan,
                framework_context,
                context_timeframe,
                trigger_timeframe,
                trigger_candles,
                supportive_fvg=supportive_fvg,
                supportive_ifvg=supportive_ifvg,
            )
            _apply_pdf_framework_to_trade_plan(trade_plan, framework_gate)
            if framework_gate["blockers"]:
                return None
            missed_reason = _missed_setup_reason(
                objective.direction,
                current.close,
                entry,
                trigger_atr,
                trade_plan.get("risk"),
                settings,
            )
            if missed_reason:
                return None
            quality = _assess_setup_quality(
                STAGE_CONFIRMED,
                settings["filters"],
                objective.direction,
                context_candles,
                trigger_candles,
                settings,
            )
            _apply_quality_to_trade_plan(trade_plan, quality)
            _apply_gate_to_trade_plan(trade_plan, _hard_quality_blockers(quality))
            _apply_institutional_context(
                trade_plan,
                objective.direction,
                context_timeframe,
                trigger_timeframe,
                context_candles,
                trigger_candles,
                settings,
                objective=objective,
                raid=raid,
                trigger=trigger,
            )
            details = self._msb_confirmed_details(
                setup,
                profile_name,
                context_timeframe,
                trigger_timeframe,
                context_candles,
                trigger_candles,
                context_atr,
                trigger_atr,
                objective,
                trigger,
                raid,
                stop,
                trade_plan,
                quality,
                alignment,
                settings,
            )
            return KodSignal(
                stage=STAGE_CONFIRMED,
                direction=objective.direction,
                profile_name=profile_name,
                context_timeframe=context_timeframe,
                trigger_timeframe=trigger_timeframe,
                candle=current,
                trigger_candle=current,
                alert_id=f"{_alert_id(setup, profile_name, objective.direction, STAGE_CONFIRMED)}:{trigger_mode}",
                details=details,
                trade_plan=trade_plan,
            )
        return None

    def _raid_forming_details(
        self,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        raid: HtfRaid,
        quality: QualityResult,
        alignment: HtfAlignment | None,
        settings: dict[str, Any],
    ) -> list[str]:
        close_side = "above" if objective.direction == "bullish" else "below"
        level_side = "low" if objective.direction == "bullish" else "high"
        return [
            f"Summary: Candle 2 Turtle Soup happened. No entry yet; wait for {trigger_timeframe} Candle 3 Model #1 or MSS confirmation.",
            f"Side: {_direction_text(objective.direction)}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            f"Why watch?: HTF direction is {_direction_word(objective.direction)} and price printed Turtle Soup on the important {context_timeframe} candle {level_side}.",
            *_htf_alignment_details(alignment),
            f"Candle 2 Turtle Soup: {raid.candle_label} {level_side} {_fmt(raid.level)} was taken and reclaimed; sweep extreme {_fmt(raid.sweep_extreme)}.",
            f"HTF target: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)} ({objective.distance_atr:.2f} ATR away)",
            f"Confirmation needed: closed {trigger_timeframe} Candle 3 Model #1 or MSS {close_side} structure.",
            f"Freshness: confirmation must happen within {_freshness_bars_for_profile(profile_name, settings)} {trigger_timeframe} bars after Turtle Soup; current age {raid.bars_since_raid} bars.",
            f"Volatility: {context_timeframe} ATR {_fmt(context_atr)} · {trigger_timeframe} ATR {_fmt(trigger_atr)}",
            *quality.lines,
        ]

    def _msb_forming_details(
        self,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        forming: dict[str, Any],
        quality: QualityResult,
        alignment: HtfAlignment | None,
    ) -> list[str]:
        latest = trigger_candles[-1]
        side = "high" if objective.direction == "bullish" else "low"
        close_side = "above" if objective.direction == "bullish" else "below"
        return [
            f"Summary: Setup is forming. {context_timeframe} context is active; wait for {trigger_timeframe} MSB confirmation.",
            f"Side: {_direction_text(objective.direction)}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            f"Why watch?: {context_timeframe} has {_liquidity_kind_text(objective.kind)} at {_fmt(objective.level)}; {trigger_timeframe} must confirm with market structure.",
            *_htf_alignment_details(alignment),
            f"HTF target: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)} ({objective.distance_atr:.2f} ATR away)",
            f"MSS level: recent {trigger_timeframe} structure {side} {_fmt(float(forming['level']))}",
            f"Confirmation needed: {trigger_timeframe} candle close {close_side} the MSS level",
            f"Current close: {_fmt(latest.close)} · {trigger_timeframe} ATR {_fmt(trigger_atr)} · {context_timeframe} ATR {_fmt(context_atr)}",
            *quality.lines,
        ]

    def _msb_confirmed_details(
        self,
        setup: SetupConfig,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        trigger: dict[str, Any],
        raid: HtfRaid | None,
        stop: float,
        trade_plan: dict[str, Any],
        quality: QualityResult,
        alignment: HtfAlignment | None,
        settings: dict[str, Any],
    ) -> list[str]:
        latest = trigger_candles[-1]
        entry = float(trigger["entry"])
        level = float(trigger["level"])
        stop_base = float(raid.sweep_extreme if raid is not None else trigger["stop_base"])
        risk = abs(entry - stop)
        wide_risk = risk > trigger_atr * settings["max_stop_atr"]
        tp1 = float(trade_plan["tp1"])
        tp2 = float(trade_plan["tp2"])
        side = "high" if objective.direction == "bullish" else "low"
        close_side = "above" if objective.direction == "bullish" else "below"
        trigger_mode = str(trigger.get("trigger_mode") or "msb")
        trigger_text = "Model #1" if trigger_mode == "model1" else "MSS" if trigger_mode == "mss" else str(trigger.get("label") or trigger_mode)
        displacement = trigger.get("displacement") or {}
        target_notes = list(trade_plan.get("target_notes") or [])
        fvg_notes = _fvg_plan_details(trade_plan)
        details = [
            f"Summary: Setup confirmed by {CRT_SOURCE_DOCUMENT}. {context_timeframe} Turtle Soup + {trigger_timeframe} Candle 3 {trigger_text} are aligned; the bot still does not place orders.",
            f"Side: {_direction_text(objective.direction)}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            f"Why {_direction_text(objective.direction).split()[0]}?: HTF narrative and key level point to {_liquidity_kind_text(objective.kind)} at {_fmt(objective.level)}; Candle 3 confirmed with {trigger_text}.",
            *_htf_alignment_details(alignment),
            *_pdf_framework_detail_lines(trade_plan),
            *(
                [
                    f"Candle 2 Turtle Soup: {raid.candle_label} {'low' if objective.direction == 'bullish' else 'high'} {_fmt(raid.level)} was taken and reclaimed; sweep extreme {_fmt(raid.sweep_extreme)}.",
                    f"Freshness: {trigger_text} came {raid.bars_since_raid} {trigger_timeframe} bars after Turtle Soup.",
                ]
                if raid is not None
                else []
            ),
            f"What happened?: {trigger_timeframe} confirmed {close_side} the relevant {side} at {_fmt(level)} with {trigger_text}.",
            f"Trigger level: {_fmt(level)} · Stop base: {_fmt(stop_base)}",
            (
                f"Displacement: body {float(displacement.get('body_ratio', 0)):.2f} · "
                f"range {float(displacement.get('range_atr', 0)):.2f} ATR"
                if displacement
                else "Displacement: confirmed"
            ),
            f"HTF target: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)} ({objective.distance_atr:.2f} ATR away)",
            f"Entry: {_fmt(entry)}",
            f"Stop: {_fmt(stop)} — beyond the Turtle Soup extreme plus ATR buffer",
            f"TP1: {_fmt(tp1)} ({trade_plan.get('tp1_reason', '1R')})",
            f"TP2: {_fmt(tp2)} — {trade_plan.get('tp2_reason', 'next internal target')}",
            f"Final target: {_fmt(objective.level)}",
            *target_notes,
            *fvg_notes,
            *_institutional_detail_lines(trade_plan),
            *_rr_details(trade_plan),
            f"Risk: {_fmt(risk)} ({risk / trigger_atr:.2f} ATR) — {'WIDE RISK' if wide_risk else 'normal'}",
            f"Latest close: {_fmt(latest.close)} · alert only, no automated order",
            "Management: after TP1, consider partial profit or tightening the stop.",
            *quality.lines,
        ]
        if setup.cooldown_minutes:
            details.append(f"Cooldown: same profile/side/stage will not notify again for {setup.cooldown_minutes} minutes")
        return details

    def _forming_details(
        self,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        reference: ReferenceLevel,
        settings: dict[str, Any],
        quality: QualityResult | None = None,
        alignment: HtfAlignment | None = None,
    ) -> list[str]:
        direction_text = _direction_text(objective.direction)
        latest = trigger_candles[-1]
        level_label = "low" if objective.direction == "bullish" else "high"
        confirmation = (
            f"take the prior {settings['lookback']}-bar low and close back above it"
            if objective.direction == "bullish"
            else f"take the prior {settings['lookback']}-bar high and close back below it"
        )
        invalidation = reference.level - trigger_atr * settings["stop_buffer_atr"] if objective.direction == "bullish" else reference.level + trigger_atr * settings["stop_buffer_atr"]
        if quality is None:
            quality = _assess_setup_quality(
                STAGE_FORMING,
                settings["filters"],
                objective.direction,
                context_candles,
                trigger_candles,
                settings,
            )

        return [
            "Summary: Setup is forming. No entry yet; wait for trigger confirmation.",
            f"Side: {direction_text}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            *_narrative_thesis(
                stage="forming",
                direction=objective.direction,
                context_timeframe=context_timeframe,
                trigger_timeframe=trigger_timeframe,
                objective=objective,
                reference=reference,
                lookback=settings["lookback"],
            ),
            *_htf_alignment_details(alignment),
            f"HTF target: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)} ({objective.distance_atr:.2f} ATR away)",
            f"Trigger reference: prior {settings['lookback']}-bar {level_label} {_fmt(reference.level)} · level is {reference.age} bars old",
            f"Confirmation needed: {confirmation}",
            f"Invalidation guide: setup is no longer fresh if price extends beyond {_fmt(invalidation)} before reclaiming",
            f"Current close: {_fmt(latest.close)} · {trigger_timeframe} ATR {_fmt(trigger_atr)} · {context_timeframe} ATR {_fmt(context_atr)}",
            *quality.lines,
        ]

    def _confirmed_details(
        self,
        setup: SetupConfig,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        context_candles: list[Candle],
        trigger_candles: list[Candle],
        context_atr: float,
        trigger_atr: float,
        objective: LiquidityObjective,
        confirmation: dict[str, Any],
        settings: dict[str, Any],
        trade_plan: dict[str, Any] | None = None,
        alignment: HtfAlignment | None = None,
    ) -> list[str]:
        direction_text = _direction_text(objective.direction)
        reference: ReferenceLevel = confirmation["reference"]
        entry = float(confirmation["entry"])
        sweep_extreme = float(confirmation["sweep_extreme"])
        stop = _stop_level(objective.direction, sweep_extreme, trigger_atr, settings["stop_buffer_atr"])
        stop_buffer = trigger_atr * settings["stop_buffer_atr"]
        risk = abs(entry - stop)
        wide_risk = risk > trigger_atr * settings["max_stop_atr"]
        if trade_plan is None:
            target_plan = _setup_targets(
                objective.direction,
                entry,
                stop,
                objective,
                trigger_candles,
                settings,
                reference=reference,
            )
            trade_plan = _build_trade_plan(
                entry,
                stop,
                tp1=target_plan["tp1"],
                tp2=target_plan["tp2"],
                final_target=target_plan["final_target"],
            )
            _apply_target_plan(trade_plan, target_plan)
        tp1 = float(trade_plan["tp1"])
        tp2 = float(trade_plan["tp2"])
        latest = trigger_candles[-1]
        range_warning = _range_expansion_warning(trigger_candles)
        quality = _assess_setup_quality(
            STAGE_CONFIRMED,
            settings["filters"],
            objective.direction,
            context_candles,
            trigger_candles,
            settings,
        )
        _apply_quality_to_trade_plan(trade_plan, quality)

        level_label = "low" if objective.direction == "bullish" else "high"
        details = [
            "Summary: Setup confirmed. Use the plan levels; the bot still does not place orders.",
            f"Side: {direction_text}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            *_narrative_thesis(
                stage="confirmed",
                direction=objective.direction,
                context_timeframe=context_timeframe,
                trigger_timeframe=trigger_timeframe,
                objective=objective,
                reference=reference,
                confirmation=confirmation,
                sweep_extreme=sweep_extreme,
                entry=entry,
                lookback=settings["lookback"],
            ),
            *_htf_alignment_details(alignment),
            f"What happened?: {_reason_text(str(confirmation['reason']))}",
            f"Trigger reference: prior {settings['lookback']}-bar {level_label} {_fmt(reference.level)} · level is {reference.age} bars old",
            f"Wick extreme: {_fmt(sweep_extreme)} · Entry close: {_fmt(entry)} · Reference level: {_fmt(reference.level)}",
            f"HTF target: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)} ({objective.distance_atr:.2f} ATR away)",
            f"Entry: {_fmt(entry)}",
            f"Stop: {_fmt(stop)} — wick extreme {_fmt(sweep_extreme)} "
            f"{'-' if objective.direction == 'bullish' else '+'}{_fmt(stop_buffer)} ATR buffer",
            f"TP1: {_fmt(tp1)} (1R)",
            f"TP2: {_fmt(tp2)} — {trade_plan.get('tp2_reason', 'next internal target')}",
            f"Final target: {_fmt(objective.level)}",
            *list(trade_plan.get("target_notes") or []),
            *_fvg_plan_details(trade_plan),
            *_institutional_detail_lines(trade_plan),
            *_rr_details(trade_plan),
            f"Risk: {_fmt(risk)} ({risk / trigger_atr:.2f} ATR) — {'WIDE RISK' if wide_risk else 'normal'}",
            f"Latest close: {_fmt(latest.close)} · alert only, no automated order",
            "Management: avoid adding to winners; after TP1, consider partial profit or tightening the stop.",
            *quality.lines,
        ]
        if range_warning:
            details.append(range_warning)
        if setup.cooldown_minutes:
            details.append(f"Cooldown: same profile/side/stage will not notify again for {setup.cooldown_minutes} minutes")
        return details

    def _invalidated_details(
        self,
        profile_name: str,
        context_timeframe: str,
        trigger_timeframe: str,
        objective: LiquidityObjective,
        reference: ReferenceLevel | None,
        trigger_atr: float,
        settings: dict[str, Any],
    ) -> list[str]:
        reference_text = "n/a" if reference is None else _fmt(reference.level)
        return [
            "Summary: Setup invalidated. The move extended before a valid reclaim.",
            f"Side: {_direction_text(objective.direction)}",
            f"Profile: {profile_name} ({context_timeframe} context -> {trigger_timeframe} trigger)",
            "What happened?: Price took the reference level but kept moving instead of reclaiming it.",
            f"HTF target still nearby: {_liquidity_kind_text(objective.kind)} — {_fmt(objective.level)}",
            f"Old reference level: {reference_text}",
            f"Next step: wait for a fresh prior {settings['lookback']}-bar high/low and a new reclaim.",
            f"Volatility ({trigger_timeframe} ATR): {_fmt(trigger_atr)}",
        ]


def _settings(params: dict[str, Any]) -> dict[str, Any]:
    htf_alignment = params.get("htf_alignment", {})
    if not isinstance(htf_alignment, dict):
        htf_alignment = {}
    require_premium_discount_for_forming = bool(params.get("require_premium_discount_for_forming", False))
    require_premium_discount_for_confirmed = bool(
        htf_alignment.get("require_premium_discount_for_confirmed", params.get("require_premium_discount_for_confirmed", False))
    )
    return {
        "profiles": params.get("profiles", []),
        "previous_candle_sweep": False,
        "lookback": int(params.get("lookback", 20)),
        "min_level_age": int(params.get("min_level_age", 4)),
        "objective_max_atr": float(params.get("objective_max_atr", 1.2)),
        "stop_buffer_atr": float(params.get("stop_buffer_atr", 0.1)),
        "max_stop_atr": float(params.get("max_stop_atr", 1.5)),
        "hide_missed_setups": bool(params.get("hide_missed_setups", True)),
        "max_chase_atr": float(params.get("max_chase_atr", 0.75)),
        "max_chase_r": float(params.get("max_chase_r", 0.75)),
        "alert_stages": set(params.get("alert_stages", [STAGE_FORMING, STAGE_CONFIRMED, STAGE_INVALIDATED])),
        "filters": set(params.get("filters", ["premium_discount", "candle_profile", "fvg", "ifvg"])),
        "forming_distance_atr": float(params.get("forming_distance_atr", 0.5)),
        "objective_lookback": int(params.get("objective_lookback", 120)),
        "target_lookback": int(params.get("target_lookback", 60)),
        "fvg_lookback": int(params.get("fvg_lookback", 50)),
        "swing_span": int(params.get("swing_span", 2)),
        "minimum_context_candles": int(params.get("minimum_context_candles", 40)),
        "msb_profiles": set(str(item).lower() for item in params.get("msb_profiles", ["swing"])),
        "msb_lookback": int(params.get("msb_lookback", 30)),
        "msb_span": int(params.get("msb_span", 2)),
        "msb_forming_distance_atr": float(params.get("msb_forming_distance_atr", params.get("forming_distance_atr", 0.5))),
        "require_htf_raid_confirmation": True,
        "htf_raid_lookback": int(params.get("htf_raid_lookback", 8)),
        "htf_raid_confirmation_bars": int(params.get("htf_raid_confirmation_bars", 8)),
        "freshness_bars_by_profile": _int_map(params.get("freshness_bars_by_profile"), {}),
        "important_candle_min_range_atr": float(params.get("important_candle_min_range_atr", 0.7)),
        "require_displacement_confirmation": bool(params.get("require_displacement_confirmation", True)),
        "displacement_min_body_ratio": float(params.get("displacement_min_body_ratio", 0.55)),
        "displacement_min_range_atr": float(params.get("displacement_min_range_atr", 0.65)),
        "displacement_close_ratio": float(params.get("displacement_close_ratio", 0.7)),
        "min_tp2_rr": float(params.get("min_tp2_rr", 1.25)),
        "min_final_rr": float(params.get("min_final_rr", 1.0)),
        "top_tier_only": bool(params.get("top_tier_only", False)),
        "min_alert_grade_by_stage": _grade_map(params.get("min_alert_grade_by_stage"), {}),
        "telegram_min_grade_by_stage": _grade_map(params.get("telegram_min_grade_by_stage"), {}),
        "require_premium_discount_for_forming": require_premium_discount_for_forming,
        "one_alert_per_raid": bool(params.get("one_alert_per_raid", False)),
        "htf_alignment_mode": str(htf_alignment.get("mode", params.get("htf_alignment_mode", "strict"))).lower(),
        "htf_require_objective_for_confirmed": bool(
            htf_alignment.get("require_objective_for_confirmed", params.get("require_objective_for_confirmed", True))
        ),
        "htf_allow_forming_without_alignment": bool(
            htf_alignment.get("allow_forming_without_alignment", params.get("allow_forming_without_alignment", True))
        ),
        "htf_block_opposite_reclaim": bool(
            htf_alignment.get("block_opposite_reclaim", params.get("block_opposite_reclaim", True))
        ),
        "htf_require_premium_discount": require_premium_discount_for_forming or require_premium_discount_for_confirmed,
    }


def _grade_map(value: Any, default: dict[str, str]) -> dict[str, str]:
    result = dict(default)
    if not isinstance(value, dict):
        return result
    for key, grade in value.items():
        normalized = _normalize_grade_token(grade)
        if normalized is not None:
            result[str(key).strip().lower()] = normalized
    return result


def _int_map(value: Any, default: dict[str, int]) -> dict[str, int]:
    result = dict(default)
    if not isinstance(value, dict):
        return result
    for key, raw in value.items():
        try:
            result[str(key).strip().lower()] = int(raw)
        except (TypeError, ValueError):
            continue
    return result


def _normalize_grade_token(value: Any) -> str | None:
    if value is None:
        return None
    token = str(value).strip().upper()
    if token in LEGACY_GRADE_MAP:
        return LEGACY_GRADE_MAP[token]
    if token in GRADE_ORDER:
        return token
    return None


def _diagnostic_payload(
    profile_name: str,
    context_timeframe: str,
    trigger_timeframe: str,
    headline: str,
    checks: list[dict[str, str]],
    directions: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "profile": profile_name,
        "context_timeframe": context_timeframe,
        "trigger_timeframe": trigger_timeframe,
        "headline": headline,
        "checks": checks,
        "directions": directions,
        "next_steps": [item["next_step"] for item in directions if item.get("next_step")][:3],
    }


def _diagnostic_check(label: str, status: str, detail: str) -> dict[str, str]:
    return {"label": label, "status": status, "detail": detail}


def _diagnostic_headline(directions: list[dict[str, Any]]) -> str:
    if not directions:
        return "Waiting for a clean CRT Secrets PDF setup."
    if any(item.get("status") == "block" for item in directions):
        return "CRT framework gate is blocking at least one side."
    if any(item.get("raid") for item in directions):
        return "Candle 2 Turtle Soup is active; waiting for Candle 3 confirmation."
    return "HTF narrative/key level exists; waiting for Turtle Soup and Candle 3."


def _diagnostic_raid(raid: HtfRaid | None) -> dict[str, Any] | None:
    if raid is None:
        return None
    return {
        "level": raid.level,
        "sweep_extreme": raid.sweep_extreme,
        "bars_since_raid": raid.bars_since_raid,
        "bars_since_crt": raid.bars_since_raid,
        "timestamp_ms": raid.candle.timestamp_ms,
        "label": raid.candle_label,
    }


def _diagnostic_gate(
    stage: str,
    alignment: HtfAlignment,
    raid: HtfRaid | None,
    displacement: dict[str, Any],
    quality: QualityResult,
    settings: dict[str, Any],
    *,
    trigger_confirmed: bool = False,
    trigger_timeframe: str = "",
    framework_gate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    blockers: list[str] = list(alignment.blockers)
    if not alignment.passed and not blockers:
        blockers.append("HTF bias is not aligned")
    if raid is None:
        blockers.append("Candle 2 Turtle Soup: missing")
    elif not trigger_confirmed:
        tf = trigger_timeframe or "trigger timeframe"
        blockers.append(f"Candle 3 Model #1/MSS: missing {tf} confirmation")
    if settings["require_displacement_confirmation"] and not displacement.get("passed"):
        reason = "; ".join(str(item) for item in displacement.get("reasons") or []) or "weak displacement"
        blockers.append(f"weak displacement: {reason}")
    blockers.extend(str(item) for item in (framework_gate or {}).get("blockers") or [])
    blockers.extend(_hard_quality_blockers(quality))
    minimum = settings["min_alert_grade_by_stage"].get(stage)
    if minimum and not grade_meets_minimum(quality.grade, minimum):
        blockers.append(f"below {stage} grade {minimum}: {quality.grade}")
    return {
        "status": "blocked" if blockers else "passed",
        "blockers": blockers,
        "min_grade": minimum or "",
    }


def _diagnostic_zone(zone: FvgZone | None) -> dict[str, Any] | None:
    if zone is None:
        return None
    return {
        "kind": zone.kind,
        "direction": zone.direction,
        "low": zone.low,
        "high": zone.high,
        "midpoint": zone.midpoint,
    }


def _pdf_framework_gate(
    direction: str,
    objective: LiquidityObjective,
    raid: HtfRaid | None,
    trigger: dict[str, Any] | None,
    trade_plan: dict[str, Any],
    framework_context: dict[str, Any] | None,
    context_timeframe: str,
    trigger_timeframe: str,
    trigger_candles: list[Candle],
    *,
    supportive_fvg: FvgZone | None,
    supportive_ifvg: FvgZone | None,
) -> dict[str, Any]:
    htf = _framework_htf_narrative(direction, framework_context)
    key_level = _framework_key_level(objective, framework_context)
    candle_1 = {
        "status": "mapped",
        "context_timeframe": context_timeframe,
        "range_high": objective.level if direction == "bearish" else None,
        "range_low": objective.level if direction == "bullish" else None,
        "note": "CRT range/objective is mapped from the context liquidity objective.",
    }
    candle_2 = {
        "status": "pass" if raid is not None else "block",
        "type": "turtle_soup",
        "level": raid.level if raid is not None else None,
        "sweep_extreme": raid.sweep_extreme if raid is not None else None,
        "timestamp_ms": raid.candle.timestamp_ms if raid is not None else None,
        "label": raid.candle_label if raid is not None else "",
    }
    trigger_mode = str((trigger or {}).get("trigger_mode") or "")
    candle_3 = {
        "status": "pass" if trigger_mode in {"model1", "mss"} else "block",
        "trigger_mode": trigger_mode,
        "trigger_timeframe": trigger_timeframe,
        "level": (trigger or {}).get("level"),
        "entry": (trigger or {}).get("entry"),
    }
    fvg = _framework_fvg_confluence(direction, framework_context, supportive_fvg, supportive_ifvg)
    smt = _framework_smt_status(direction, framework_context)
    session_gate = _framework_session_gate(framework_context, trigger_candles[-1] if trigger_candles else None)
    risk = _framework_risk_gate(trade_plan)
    target_50 = (
        _apply_target_50_to_plan(trade_plan)
        if framework_context is not None
        else {"level": trade_plan.get("tp1"), "detail": "Framework context not attached; legacy TP1 left unchanged."}
    )
    plan_b = _framework_plan_b(direction, trade_plan, objective, raid, trigger_timeframe)

    blockers: list[str] = []
    if framework_context is not None:
        for label, item in (
            ("HTF narrative", htf),
            ("Key level", key_level),
            ("Candle 2 Turtle Soup", candle_2),
            ("Candle 3 Model #1/MSS", candle_3),
            ("FVG", fvg),
            ("Session", session_gate),
            ("Risk", risk),
        ):
            if item.get("status") == "block":
                blockers.append(f"{label}: {item.get('detail') or item.get('note') or 'missing'}")
    if smt.get("status") == "block":
        blockers.append(f"SMT: {smt.get('detail')}")

    return {
        "framework_version": CRT_FRAMEWORK_VERSION,
        "source_document": CRT_SOURCE_DOCUMENT,
        "source_sha256": CRT_SOURCE_SHA256,
        "status": "blocked" if blockers else "passed",
        "blockers": blockers,
        "htf_narrative": htf,
        "key_level": key_level,
        "crt_phase": "candle_3" if candle_3["status"] == "pass" else "waiting_for_candle_3",
        "candle_1": candle_1,
        "candle_2": candle_2,
        "candle_3": candle_3,
        "model1_trigger": _model1_plan(trigger) if trigger_mode == "model1" and trigger is not None else {},
        "mss_trigger": _mss_plan(trigger) if trigger_mode == "mss" and trigger is not None else {},
        "fvg_confluence": fvg,
        "smt_status": smt,
        "session_gate": session_gate,
        "target_50": target_50,
        "plan_b": plan_b,
    }


def _apply_pdf_framework_to_trade_plan(trade_plan: dict[str, Any], framework_gate: dict[str, Any]) -> None:
    for key in (
        "framework_version",
        "source_document",
        "htf_narrative",
        "key_level",
        "crt_phase",
        "candle_1",
        "candle_2",
        "candle_3",
        "model1_trigger",
        "mss_trigger",
        "fvg_confluence",
        "smt_status",
        "session_gate",
        "target_50",
        "plan_b",
    ):
        trade_plan[key] = framework_gate.get(key)
    trade_plan["framework_source_sha256"] = framework_gate.get("source_sha256")
    if framework_gate.get("blockers"):
        _apply_gate_to_trade_plan(trade_plan, list(framework_gate["blockers"]))


def _framework_htf_narrative(direction: str, framework_context: dict[str, Any] | None) -> dict[str, Any]:
    if framework_context is None:
        return {"status": "pass", "direction": direction, "detail": "Framework context not attached in this evaluator call."}
    biases = {tf: _framework_bias(framework_context, tf) for tf in ("1M", "1w", "1d", "4h")}
    available = {tf: bias for tf, bias in biases.items() if bias in {"bullish", "bearish", "neutral"}}
    if len(available) < 3 or "1w" not in available or "4h" not in available:
        return {"status": "block", "direction": direction, "biases": biases, "detail": "missing HTF narrative"}
    opposing = {tf: bias for tf, bias in available.items() if bias == _opposite_direction(direction)}
    aligned = {tf: bias for tf, bias in available.items() if bias == direction}
    if opposing:
        return {"status": "block", "direction": direction, "biases": biases, "detail": f"opposing HTF bias {opposing}"}
    if not aligned:
        return {"status": "block", "direction": direction, "biases": biases, "detail": "no aligned HTF bias"}
    return {"status": "pass", "direction": direction, "biases": biases, "detail": "monthly/weekly/daily/4H narrative allows this side"}


def _framework_bias(framework_context: dict[str, Any], timeframe: str) -> str:
    timeframes = framework_context.get("timeframes") if isinstance(framework_context, dict) else {}
    if isinstance(timeframes, dict):
        item = timeframes.get(timeframe) or timeframes.get(timeframe.lower())
        if isinstance(item, dict) and item.get("bias"):
            return str(item["bias"]).lower()
    aliases = {
        "1M": ("monthly_bias", "month_bias"),
        "1w": ("weekly_bias",),
        "1d": ("daily_bias",),
        "4h": ("4h_bias", "h4_bias"),
    }
    for key in aliases.get(timeframe, ()):
        if framework_context.get(key):
            value = str(framework_context[key]).lower()
            if "bull" in value:
                return "bullish"
            if "bear" in value:
                return "bearish"
            if "neutral" in value:
                return "neutral"
    return "unavailable"


def _framework_key_level(objective: LiquidityObjective, framework_context: dict[str, Any] | None) -> dict[str, Any]:
    level = objective.level
    kind = objective.kind
    if framework_context is None:
        return {"status": "pass", "level": level, "kind": kind, "detail": "Context liquidity objective mapped."}
    if "swing" in kind or "equal" in kind:
        return {"status": "pass", "level": level, "kind": kind, "detail": "old/equal high-low key level"}
    for pool in framework_context.get("liquidity_map") or framework_context.get("liquidity_ranking") or []:
        if not isinstance(pool, dict) or pool.get("level") is None:
            continue
        try:
            if abs(float(pool["level"]) - float(level)) <= max(abs(float(level)) * 0.001, 1e-9):
                return {"status": "pass", "level": level, "kind": pool.get("source") or kind, "detail": "framework liquidity pool"}
        except (TypeError, ValueError):
            continue
    return {"status": "block", "level": level, "kind": kind, "detail": "missing key level"}


def _framework_fvg_confluence(
    direction: str,
    framework_context: dict[str, Any] | None,
    supportive_fvg: FvgZone | None,
    supportive_ifvg: FvgZone | None,
) -> dict[str, Any]:
    zone = supportive_fvg or supportive_ifvg
    if zone is not None:
        return {"status": "pass", "zone": _zone_plan(zone), "detail": f"{zone.kind} supports {direction}"}
    if framework_context is None:
        return {"status": "pass", "zone": None, "detail": "Framework FVG context not attached in this evaluator call."}
    for item in framework_context.get("fvg") or []:
        if isinstance(item, dict) and str(item.get("direction", "")).lower() == direction:
            return {"status": "pass", "zone": item, "detail": "framework FVG supports direction"}
    return {"status": "block", "zone": None, "detail": "missing same-direction FVG confluence"}


def _framework_smt_status(direction: str, framework_context: dict[str, Any] | None) -> dict[str, Any]:
    if framework_context is None:
        return {"status": "pass", "state": "unavailable", "detail": "SMT context not attached."}
    raw = framework_context.get("smt_status", framework_context.get("smt_signal", "unavailable"))
    if isinstance(raw, dict):
        state = str(raw.get("status") or raw.get("state") or "").lower()
        smt_direction = str(raw.get("direction") or "").lower()
        detail = str(raw.get("detail") or raw)
    else:
        state = str(raw).lower()
        smt_direction = "bullish" if "bull" in state else "bearish" if "bear" in state else ""
        detail = str(raw)
    if "unavailable" in state or "no intermarket" in state or not state:
        return {"status": "pass", "state": "unavailable", "detail": "SMT unavailable"}
    if smt_direction and smt_direction != direction:
        return {"status": "block", "state": state, "direction": smt_direction, "detail": "opposing SMT"}
    return {"status": "pass", "state": state, "direction": smt_direction or direction, "detail": detail}


def _framework_session_gate(framework_context: dict[str, Any] | None, candle: Candle | None) -> dict[str, Any]:
    if framework_context is None:
        return {"status": "pass", "session": "", "killzone": "", "detail": "Framework session context not attached in this evaluator call."}
    explicit = framework_context.get("session_gate")
    if isinstance(explicit, dict):
        status = str(explicit.get("status") or "").lower()
        if status in {"pass", "block"}:
            return {**explicit, "status": status}
    killzone = str(framework_context.get("killzone") or framework_context.get("current_killzone") or "")
    session = str(framework_context.get("session") or framework_context.get("current_session") or "")
    if not killzone and candle is not None:
        killzone = _session_name(candle.timestamp_ms)
    text = f"{session} {killzone}".lower()
    if "london" in text or "new york" in text or "ny " in text:
        return {"status": "pass", "session": session, "killzone": killzone, "detail": "London/New York session"}
    return {"status": "block", "session": session, "killzone": killzone, "detail": "outside London/New York killzone"}


def _framework_risk_gate(trade_plan: dict[str, Any]) -> dict[str, Any]:
    if trade_plan.get("target_blocker"):
        return {"status": "block", "detail": str(trade_plan["target_blocker"])}
    if trade_plan.get("entry") is None or trade_plan.get("stop") is None or trade_plan.get("final_target") is None:
        return {"status": "block", "detail": "entry, stop or final target missing"}
    return {"status": "pass", "detail": "stop and target map present"}


def _apply_target_50_to_plan(trade_plan: dict[str, Any]) -> dict[str, Any]:
    entry = _float_or_none(trade_plan.get("entry"))
    stop = _float_or_none(trade_plan.get("stop"))
    final_target = _float_or_none(trade_plan.get("final_target"))
    if entry is None or final_target is None:
        return {"level": None, "detail": "target unavailable"}
    target_50 = (entry + final_target) / 2
    trade_plan["target_50"] = target_50
    trade_plan["tp1"] = target_50
    trade_plan["tp1_reason"] = "50% mission target between entry and final CRT objective"
    trade_plan["rr_tp1"] = _rr_ratio(entry, stop, target_50) if stop is not None else None
    return {"level": target_50, "detail": "50% mission target"}


def _framework_plan_b(
    direction: str,
    trade_plan: dict[str, Any],
    objective: LiquidityObjective,
    raid: HtfRaid | None,
    trigger_timeframe: str,
) -> dict[str, Any]:
    invalidation = trade_plan.get("stop")
    raid_level = raid.level if raid is not None else trade_plan.get("reference_level")
    opposite = _opposite_direction(direction)
    return {
        "primary": f"{direction} Candle 3 continues toward CRT objective {_fmt(objective.level)}.",
        "alternate": f"If price invalidates through {_fmt(float(invalidation)) if invalidation is not None else 'stop'}, stand down and reassess {opposite}.",
        "stand_down": f"Lose the turtle soup reclaim level {_fmt(float(raid_level)) if raid_level is not None else 'n/a'} or fail to hold {trigger_timeframe} structure.",
    }


def _htf_alignment(
    direction: str,
    context_candles: list[Candle],
    objectives: list[LiquidityObjective],
    settings: dict[str, Any],
) -> HtfAlignment:
    objective = next((item for item in objectives if item.direction == direction), None)
    opposite_objective = next((item for item in objectives if item.direction == _opposite_direction(direction)), None)
    reasons: list[str] = []
    blockers: list[str] = []

    if objective is not None:
        reasons.append(
            f"same-direction HTF objective at {_fmt(objective.level)} ({objective.kind}, {objective.distance_atr:.2f} ATR away)"
        )
    elif settings["htf_require_objective_for_confirmed"]:
        blockers.append("no same-direction HTF liquidity objective")

    if opposite_objective is not None and objective is None:
        reasons.append(
            f"opposite HTF objective is closer/active at {_fmt(opposite_objective.level)} ({opposite_objective.kind})"
        )

    previous_reclaim = _previous_context_reclaim_direction(context_candles)
    if previous_reclaim == direction:
        reasons.append(f"previous closed HTF candle reclaimed in the {_direction_word(direction)} direction")
    elif previous_reclaim is not None and settings["htf_block_opposite_reclaim"]:
        blockers.append(
            f"previous closed HTF candle reclaimed {_direction_word(previous_reclaim)}, conflicting with {_direction_word(direction)}"
        )

    zone, zone_ok = _htf_premium_discount_state(direction, context_candles)
    if zone:
        if zone_ok:
            reasons.append(f"HTF location is {zone}, acceptable for {_direction_word(direction)}")
        elif settings["htf_require_premium_discount"]:
            required = "discount" if direction == "bullish" else "premium"
            blockers.append(f"wrong HTF location: {_direction_word(direction)} requires {required}, currently {zone}")
        else:
            reasons.append(f"HTF location is {zone}; treated as quality warning, not a hard blocker")

    status = "passed" if not blockers else "watch_only"
    if blockers and (not settings["htf_allow_forming_without_alignment"] or settings["htf_require_premium_discount"]):
        status = "blocked"

    bias = direction if status == "passed" else "pending"
    return HtfAlignment(
        direction=direction,
        status=status,
        bias=bias,
        objective=objective,
        reasons=reasons,
        blockers=blockers,
    )


def _apply_alignment_to_trade_plan(trade_plan: dict[str, Any] | None, alignment: HtfAlignment | None) -> None:
    if trade_plan is None or alignment is None:
        return
    trade_plan["htf_alignment"] = alignment.status
    trade_plan["htf_bias"] = alignment.bias
    trade_plan["htf_reasons"] = list(alignment.reasons)
    trade_plan["htf_blockers"] = list(alignment.blockers)


def _htf_alignment_details(alignment: HtfAlignment | None) -> list[str]:
    if alignment is None:
        return []
    status_label = {
        "passed": "PASSED",
        "watch_only": "WATCH ONLY",
        "blocked": "BLOCKED",
    }.get(alignment.status, alignment.status.upper())
    bias_label = alignment.bias.upper() if alignment.bias else "PENDING"
    lines = [f"YTL / HTF Alignment: {status_label} — HTF bias {bias_label}"]
    lines.extend(f"YTL reason: {reason}" for reason in alignment.reasons)
    lines.extend(f"YTL blocker: {blocker}" for blocker in alignment.blockers)
    if alignment.watch_only:
        lines.append("YTL note: watch-only alert; no trade until HTF direction and trigger confirmation agree")
    return lines


def _previous_context_reclaim_direction(context_candles: list[Candle]) -> str | None:
    if len(context_candles) < 4:
        return None
    current_context = context_candles[-2]
    previous_context = context_candles[-3]
    if current_context.low < previous_context.low and current_context.close > previous_context.low:
        return "bullish"
    if current_context.high > previous_context.high and current_context.close < previous_context.high:
        return "bearish"
    return None


def _htf_premium_discount_state(direction: str, context_candles: list[Candle]) -> tuple[str, bool]:
    if not context_candles:
        return "", False
    recent = context_candles[-20:] if len(context_candles) >= 20 else context_candles
    high = max(candle.high for candle in recent)
    low = min(candle.low for candle in recent)
    midpoint = (high + low) / 2
    latest = context_candles[-1]
    if latest.close <= midpoint:
        zone = "discount"
    else:
        zone = "premium"
    return zone, (zone == "discount" if direction == "bullish" else zone == "premium")


def _opposite_direction(direction: str) -> str:
    return "bearish" if direction == "bullish" else "bullish"


def _direction_word(direction: str) -> str:
    return "bullish" if direction == "bullish" else "bearish"


def _session_name(timestamp_ms: int) -> str:
    opened = Candle(timestamp_ms=timestamp_ms, open=0, high=0, low=0, close=0, volume=0).opened_at
    minutes = opened.hour * 60 + opened.minute
    windows = [
        ("London killzone", 7 * 60, 10 * 60),
        ("New York AM killzone", 12 * 60 + 30, 16 * 60),
        ("New York PM window", 18 * 60, 20 * 60),
    ]
    for name, start, end in windows:
        if start <= minutes <= end:
            return name
    return ""


def normalize_setup_grade(grade: str | None) -> str | None:
    if grade is None:
        return None
    return _normalize_grade_token(grade) or grade


def is_visible_setup_grade(grade: str | None) -> bool:
    normalized = normalize_setup_grade(grade)
    return normalized in VISIBLE_SETUP_GRADES


def is_top_tier_grade(grade: str | None) -> bool:
    return normalize_setup_grade(grade) == TOP_SETUP_GRADE


def grade_meets_minimum(grade: str | None, minimum: str | None) -> bool:
    min_grade = normalize_setup_grade(minimum)
    if min_grade is None:
        return True
    normalized = normalize_setup_grade(grade)
    if normalized is None:
        return False
    return GRADE_ORDER.get(normalized, -1) >= GRADE_ORDER.get(min_grade, 999)


def signal_meets_telegram_grade(signal: KodSignal, params: dict[str, Any]) -> bool:
    settings = _settings(params)
    minimum = settings["telegram_min_grade_by_stage"].get(str(signal.stage).lower())
    return grade_meets_minimum(_signal_grade(signal), minimum)


def _signal_grade(signal: KodSignal) -> str | None:
    if signal.trade_plan and signal.trade_plan.get("setup_grade"):
        return str(signal.trade_plan["setup_grade"])
    for line in signal.details:
        text = str(line)
        if not text.startswith("Setup:") and not text.startswith("Setup notu:"):
            continue
        payload = text.split(":", 1)[1].strip()
        for grade in (TOP_SETUP_GRADE, GRADE_A, GRADE_CB, GRADE_ML, "B", "C", "D"):
            if payload.startswith(grade):
                return normalize_setup_grade(grade)
    return None


def _finalize_kod_signal(signal: KodSignal | None, settings: dict[str, Any]) -> KodSignal | None:
    if signal is None:
        return None
    if not settings.get("top_tier_only", False):
        return signal
    if is_top_tier_grade(_signal_grade(signal)):
        return signal
    return None


def _signal_allowed_by_stage_grade(signal: KodSignal, settings: dict[str, Any]) -> bool:
    minimum = settings["min_alert_grade_by_stage"].get(str(signal.stage).lower())
    if not grade_meets_minimum(_signal_grade(signal), minimum):
        return False
    if minimum and signal.stage in {STAGE_FORMING, STAGE_CONFIRMED}:
        blockers = list((signal.trade_plan or {}).get("gate_blockers") or [])
        if blockers:
            return False
    return True


def _freshness_bars_for_profile(profile_name: str, settings: dict[str, Any]) -> int:
    profile_key = str(profile_name or "").strip().lower()
    by_profile = settings.get("freshness_bars_by_profile") or {}
    if profile_key in by_profile:
        return max(1, int(by_profile[profile_key]))
    return max(1, int(settings["htf_raid_confirmation_bars"]))


def _latest_atr(candles: list[Candle], period: int = 14) -> float | None:
    values = atr(
        [candle.high for candle in candles],
        [candle.low for candle in candles],
        [candle.close for candle in candles],
        period,
    )
    for value in reversed(values):
        if value is not None:
            return value
    return None


def _nearest_above(levels: list[float], close: float, current_atr: float, max_atr: float) -> float | None:
    candidates = [level for level in levels if level > close and (level - close) <= current_atr * max_atr]
    return min(candidates, default=None)


def _nearest_below(levels: list[float], close: float, current_atr: float, max_atr: float) -> float | None:
    candidates = [level for level in levels if level < close and (close - level) <= current_atr * max_atr]
    return max(candidates, default=None)


def _liquidity_kind(levels: list[float], level: float, tolerance: float, side: str) -> str:
    touches = sum(1 for item in levels if abs(item - level) <= tolerance)
    if touches >= 2:
        return f"unclaimed equal {side}"
    return f"unclaimed swing {side}"


def _uses_msb_trigger(profile_name: str, context_timeframe: str, trigger_timeframe: str, settings: dict[str, Any]) -> bool:
    profile_key = str(profile_name or "").lower()
    context_key = str(context_timeframe or "").lower()
    trigger_key = str(trigger_timeframe or "").lower()
    return (
        profile_key in settings["msb_profiles"]
        or (context_key == "1d" and trigger_key == "1h")
        or (context_key == "4h" and trigger_key == "15m")
    )


def _find_htf_raid(
    context_candles: list[Candle],
    trigger_candles: list[Candle],
    direction: str,
    profile_name: str,
    context_timeframe: str,
    context_atr: float,
    settings: dict[str, Any],
) -> HtfRaid | None:
    if not context_candles or not trigger_candles:
        return None

    lookback = max(1, settings["htf_raid_lookback"])
    recent_context = context_candles[-lookback:]
    important = _important_context_candles(recent_context, direction, context_atr, settings)

    timeframe_ms = _timeframe_ms(context_timeframe)
    confirmation_bars = _freshness_bars_for_profile(profile_name, settings)
    for candle in important:
        level = candle.low if direction == "bullish" else candle.high
        start_ms = candle.timestamp_ms + timeframe_ms
        scoped = [item for item in trigger_candles if item.timestamp_ms >= start_ms]
        if not scoped:
            scoped = trigger_candles

        scoped_start_index = len(trigger_candles) - len(scoped)
        recent = scoped[-(confirmation_bars + 1) :]
        recent_start_index = scoped_start_index + max(0, len(scoped) - len(recent))
        raid_indexes: list[int] = []
        if direction == "bullish":
            raid_indexes = [recent_start_index + idx for idx, item in enumerate(recent) if item.low < level]
        else:
            raid_indexes = [recent_start_index + idx for idx, item in enumerate(recent) if item.high > level]
        if not raid_indexes:
            continue

        raid_index = raid_indexes[-1]
        post_raid = trigger_candles[raid_index:]
        latest = trigger_candles[-1]
        if direction == "bullish":
            if latest.close <= level:
                continue
            sweep_extreme = min(item.low for item in post_raid)
            if sweep_extreme >= level:
                continue
            candle_label = "important daily candle" if context_timeframe.lower() == "1d" else f"important {context_timeframe} candle"
        else:
            if latest.close >= level:
                continue
            sweep_extreme = max(item.high for item in post_raid)
            if sweep_extreme <= level:
                continue
            candle_label = "important daily candle" if context_timeframe.lower() == "1d" else f"important {context_timeframe} candle"

        return HtfRaid(
            direction=direction,
            candle=candle,
            level=level,
            sweep_extreme=sweep_extreme,
            trigger_index=raid_index,
            bars_since_raid=len(trigger_candles) - 1 - raid_index,
            candle_label=candle_label,
        )

    return None


def _model1_signal(
    candles: list[Candle],
    direction: str,
    raid_index: int,
    trigger_atr: float,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    if len(candles) < max(settings["lookback"] + 1, 3):
        return None
    if len(candles) - 1 - raid_index > settings["htf_raid_confirmation_bars"]:
        return None

    current_ref = _reference_level(candles, direction, settings["lookback"], 0)
    if current_ref is None or current_ref.age < settings["min_level_age"]:
        return None
    current = candles[-1]
    displacement = _displacement_result(current, direction, trigger_atr, settings)
    if settings["require_displacement_confirmation"] and not displacement["passed"]:
        return None

    if direction == "bullish":
        swept = current.low < current_ref.level
        reclaimed = current.close > current_ref.level
        if not (swept and reclaimed):
            return None
        sweep_extreme = current.low
    else:
        swept = current.high > current_ref.level
        reclaimed = current.close < current_ref.level
        if not (swept and reclaimed):
            return None
        sweep_extreme = current.high

    return {
        "trigger_mode": "model1",
        "label": "Model #1",
        "level": current_ref.level,
        "level_timestamp_ms": candles[len(candles) - 1 - current_ref.age].timestamp_ms,
        "entry": current.close,
        "stop_base": sweep_extreme,
        "sweep_extreme": sweep_extreme,
        "reference": current_ref,
        "displacement": displacement,
    }


def _model1_plan(trigger: dict[str, Any]) -> dict[str, Any]:
    return {
        "level": trigger.get("level"),
        "entry": trigger.get("entry"),
        "sweep_extreme": trigger.get("sweep_extreme") or trigger.get("stop_base"),
        "timestamp_ms": trigger.get("level_timestamp_ms"),
        "label": trigger.get("label") or "Model #1",
    }


def _mss_plan(trigger: dict[str, Any]) -> dict[str, Any]:
    return {
        "level": trigger.get("level"),
        "entry": trigger.get("entry"),
        "timestamp_ms": trigger.get("level_timestamp_ms"),
        "label": trigger.get("label") or "MSS",
    }


def _important_context_candles(
    candles: list[Candle],
    direction: str,
    context_atr: float,
    settings: dict[str, Any],
) -> list[Candle]:
    if not candles:
        return []
    min_range = context_atr * settings["important_candle_min_range_atr"]
    scored: list[tuple[int, int, Candle]] = []
    for index, candle in enumerate(candles):
        candle_range = candle.high - candle.low
        body = abs(candle.close - candle.open)
        body_ratio = 0 if candle_range <= 0 else body / candle_range
        score = 0
        if candle_range >= min_range:
            score += 2
        if body_ratio >= 0.5:
            score += 1
        # ICT-style raid reference: prefer the candle that launched the move or left imbalance.
        if direction == "bullish" and candle.close < candle.open:
            score += 1
        if direction == "bearish" and candle.close > candle.open:
            score += 1
        if 0 < index < len(candles) - 1:
            previous = candles[index - 1]
            nxt = candles[index + 1]
            if previous.high < nxt.low or previous.low > nxt.high:
                score += 1
        if score:
            scored.append((score, index, candle))

    if not scored:
        return [max(candles, key=lambda item: item.high - item.low)]
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [item[2] for item in scored]


def _ifvg_raid_confirmation(
    candles: list[Candle],
    direction: str,
    raid_index: int,
    trigger_atr: float,
    settings: dict[str, Any],
    *,
    freshness_bars: int | None = None,
) -> dict[str, Any] | None:
    if len(candles) < 3:
        return None
    if len(candles) - 1 - raid_index > (freshness_bars or settings["htf_raid_confirmation_bars"]):
        return None

    current = candles[-1]
    displacement = _displacement_result(current, direction, trigger_atr, settings)
    if settings["require_displacement_confirmation"] and not displacement["passed"]:
        return None
    return _recent_ifvg_break(candles, direction, raid_index, settings)


def _recent_ifvg_break(
    candles: list[Candle],
    direction: str,
    raid_index: int,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    current = candles[-1]
    previous = candles[-2]
    start = max(2, raid_index - settings["fvg_lookback"])
    for index in range(len(candles) - 2, start - 1, -1):
        left = candles[index - 2]
        right = candles[index]
        if direction == "bullish" and left.low > right.high:
            low, high = right.high, left.low
            if previous.close <= high < current.close:
                return {
                    "trigger_mode": "ifvg",
                    "label": "bullish iFVG reclaim",
                    "level": high,
                    "entry": current.close,
                    "stop_base": min(item.low for item in candles[raid_index:]),
                    "displacement": _displacement_result(current, direction, _latest_atr(candles) or 0, settings),
                    "zone": _zone_plan(FvgZone(kind="ifvg", direction="bullish", low=low, high=high, index=index)),
                }
        if direction == "bearish" and left.high < right.low:
            low, high = left.high, right.low
            if previous.close >= low > current.close:
                return {
                    "trigger_mode": "ifvg",
                    "label": "bearish iFVG reclaim",
                    "level": low,
                    "entry": current.close,
                    "stop_base": max(item.high for item in candles[raid_index:]),
                    "displacement": _displacement_result(current, direction, _latest_atr(candles) or 0, settings),
                    "zone": _zone_plan(FvgZone(kind="ifvg", direction="bearish", low=low, high=high, index=index)),
                }
    return None


def _timeframe_ms(timeframe: str) -> int:
    value = str(timeframe or "").strip().lower()
    if not value:
        return 0
    unit = value[-1]
    try:
        amount = int(value[:-1])
    except ValueError:
        return 0
    multipliers = {
        "m": 60_000,
        "h": 3_600_000,
        "d": 86_400_000,
        "w": 604_800_000,
    }
    return amount * multipliers.get(unit, 0)


def _displacement_result(candle: Candle, direction: str, trigger_atr: float, settings: dict[str, Any]) -> dict[str, Any]:
    candle_range = candle.high - candle.low
    body = abs(candle.close - candle.open)
    body_ratio = 0.0 if candle_range <= 0 else body / candle_range
    range_atr = 0.0 if trigger_atr <= 0 else candle_range / trigger_atr
    close_position = 0.5 if candle_range <= 0 else (candle.close - candle.low) / candle_range
    if direction == "bullish":
        directional_close_ok = close_position >= settings["displacement_close_ratio"]
        directional_body_ok = candle.close > candle.open
    else:
        directional_close_ok = close_position <= 1 - settings["displacement_close_ratio"]
        directional_body_ok = candle.close < candle.open

    body_ok = body_ratio >= settings["displacement_min_body_ratio"]
    range_ok = range_atr >= settings["displacement_min_range_atr"]
    passed = body_ok and range_ok and directional_close_ok and directional_body_ok
    reasons: list[str] = []
    if not body_ok:
        reasons.append(f"body {body_ratio:.2f} < {settings['displacement_min_body_ratio']:.2f}")
    if not range_ok:
        reasons.append(f"range {range_atr:.2f} ATR < {settings['displacement_min_range_atr']:.2f} ATR")
    if not directional_close_ok:
        side = "upper" if direction == "bullish" else "lower"
        reasons.append(f"close not in {side} displacement zone")
    if not directional_body_ok:
        reasons.append("body direction does not match setup")
    return {
        "passed": passed,
        "body_ratio": body_ratio,
        "range_atr": range_atr,
        "close_position": close_position,
        "reasons": reasons,
    }


def _msb_signal(candles: list[Candle], direction: str, trigger_atr: float, settings: dict[str, Any]) -> dict[str, Any] | None:
    if len(candles) < settings["msb_span"] * 2 + 6:
        return None

    current = candles[-1]
    previous = candles[-2]
    displacement = _displacement_result(current, direction, trigger_atr, settings)
    if settings["require_displacement_confirmation"] and not displacement["passed"]:
        return None
    span = settings["msb_span"]
    lookback = settings["msb_lookback"]
    if direction == "bullish":
        levels = _structure_levels(candles, "high", span, lookback, end_index_exclusive=len(candles) - 1)
        structure = next(((index, level) for index, level in levels if previous.close <= level < current.close), None)
        if structure is None:
            return None
        structure_index, structure_level = structure
        if not (previous.close <= structure_level and current.close > structure_level):
            return None
        stop_base = _structure_stop_base(candles, "low", span, lookback)
    else:
        levels = _structure_levels(candles, "low", span, lookback, end_index_exclusive=len(candles) - 1)
        structure = next(((index, level) for index, level in levels if previous.close >= level > current.close), None)
        if structure is None:
            return None
        structure_index, structure_level = structure
        if not (previous.close >= structure_level and current.close < structure_level):
            return None
        stop_base = _structure_stop_base(candles, "high", span, lookback)

    if stop_base is None:
        return None
    return {
        "trigger_mode": "mss",
        "label": "MSS",
        "level": structure_level,
        "level_index": structure_index,
        "level_timestamp_ms": candles[structure_index].timestamp_ms,
        "entry": current.close,
        "stop_base": stop_base,
        "displacement": displacement,
    }


def _msb_forming_signal(
    candles: list[Candle],
    direction: str,
    trigger_atr: float,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    if len(candles) < settings["msb_span"] * 2 + 6:
        return None

    current = candles[-1]
    span = settings["msb_span"]
    lookback = settings["msb_lookback"]
    distance = trigger_atr * settings["msb_forming_distance_atr"]
    if direction == "bullish":
        levels = _structure_levels(candles, "high", span, lookback, end_index_exclusive=len(candles) - 1)
        structure = next(((index, level) for index, level in levels if current.close <= level), None)
        if structure is None:
            return None
        structure_index, structure_level = structure
        approaching = current.close <= structure_level and (structure_level - current.close) <= distance
    else:
        levels = _structure_levels(candles, "low", span, lookback, end_index_exclusive=len(candles) - 1)
        structure = next(((index, level) for index, level in levels if current.close >= level), None)
        if structure is None:
            return None
        structure_index, structure_level = structure
        approaching = current.close >= structure_level and (current.close - structure_level) <= distance
    if not approaching:
        return None
    return {
        "level": structure_level,
        "level_index": structure_index,
        "level_timestamp_ms": candles[structure_index].timestamp_ms,
    }


def _next_msb_level(
    candles: list[Candle],
    direction: str,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    if len(candles) < settings["msb_span"] * 2 + 6:
        return None

    current = candles[-1]
    span = settings["msb_span"]
    lookback = settings["msb_lookback"]
    if direction == "bullish":
        levels = _structure_levels(candles, "high", span, lookback, end_index_exclusive=len(candles) - 1)
        candidates = [(index, level) for index, level in levels if current.close <= level]
    else:
        levels = _structure_levels(candles, "low", span, lookback, end_index_exclusive=len(candles) - 1)
        candidates = [(index, level) for index, level in levels if current.close >= level]
    if not candidates:
        return None
    index, level = min(candidates, key=lambda item: abs(item[1] - current.close))
    return {
        "level": level,
        "level_index": index,
        "level_timestamp_ms": candles[index].timestamp_ms,
    }


def _recent_structure_level(
    candles: list[Candle],
    side: str,
    span: int,
    lookback: int,
    *,
    end_index_exclusive: int,
) -> tuple[int, float] | None:
    levels = _structure_levels(candles, side, span, lookback, end_index_exclusive=end_index_exclusive)
    return levels[0] if levels else None


def _structure_levels(
    candles: list[Candle],
    side: str,
    span: int,
    lookback: int,
    *,
    end_index_exclusive: int,
) -> list[tuple[int, float]]:
    if len(candles) < span * 2 + 1:
        return []

    start = max(span, end_index_exclusive - lookback)
    end = min(end_index_exclusive - span, len(candles) - span)
    if end <= start:
        return []

    levels: list[tuple[int, float]] = []
    for index in range(end - 1, start - 1, -1):
        window = candles[index - span : index + span + 1]
        candle = candles[index]
        if side == "high" and candle.high >= max(item.high for item in window):
            levels.append((index, candle.high))
        if side == "low" and candle.low <= min(item.low for item in window):
            levels.append((index, candle.low))
    return levels


def _structure_stop_base(candles: list[Candle], side: str, span: int, lookback: int) -> float | None:
    pivot = _recent_structure_level(candles, side, span, lookback, end_index_exclusive=len(candles))
    if pivot is not None:
        return float(pivot[1])

    recent = candles[-max(2, min(lookback, len(candles))) :]
    if not recent:
        return None
    if side == "low":
        return min(candle.low for candle in recent)
    return max(candle.high for candle in recent)


def _fvg_zones(candles: list[Candle], lookback: int = 50) -> list[FvgZone]:
    if len(candles) < 3:
        return []
    start = max(2, len(candles) - lookback)
    zones: list[FvgZone] = []
    for index in range(start, len(candles)):
        left = candles[index - 2]
        right = candles[index]
        if left.high < right.low:
            zones.append(_classify_fvg_zone(candles, index, "bullish", left.high, right.low))
        if left.low > right.high:
            zones.append(_classify_fvg_zone(candles, index, "bearish", right.high, left.low))
    return zones


def _classify_fvg_zone(
    candles: list[Candle],
    index: int,
    direction: str,
    low: float,
    high: float,
) -> FvgZone:
    future = candles[index + 1 :]
    inverted = False
    if direction == "bullish":
        inverted = any(candle.close < low for candle in future)
    else:
        inverted = any(candle.close > high for candle in future)
    if inverted:
        return FvgZone(kind="ifvg", direction=_opposite_direction(direction), low=low, high=high, index=index)
    return FvgZone(kind="fvg", direction=direction, low=low, high=high, index=index)


def _nearest_zone(
    zones: list[FvgZone],
    direction: str,
    price: float,
    *,
    kind: str | None,
) -> FvgZone | None:
    candidates = [
        zone
        for zone in zones
        if zone.direction == direction and (kind is None or zone.kind == kind)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda zone: abs(zone.midpoint - price))


def _reference_level(
    candles: list[Candle],
    direction: str,
    lookback: int,
    current_offset: int,
) -> ReferenceLevel | None:
    current_index = len(candles) - 1 - current_offset
    window_start = current_index - lookback
    if current_index <= 0 or window_start < 0:
        return None

    window = candles[window_start:current_index]
    if len(window) < lookback:
        return None

    range_high = max(candle.high for candle in window)
    range_low = min(candle.low for candle in window)
    if direction == "bullish":
        level = range_low
        matching = [index for index, candle in enumerate(window) if candle.low == level]
    else:
        level = range_high
        matching = [index for index, candle in enumerate(window) if candle.high == level]

    if not matching:
        return None
    reference_index = window_start + matching[-1]
    return ReferenceLevel(level=level, age=current_index - reference_index, range_high=range_high, range_low=range_low)


def _confirmed_signal(
    candles: list[Candle],
    direction: str,
    current_ref: ReferenceLevel | None,
    previous_ref: ReferenceLevel | None,
) -> dict[str, Any] | None:
    current = candles[-1]
    previous = candles[-2]

    if direction == "bullish":
        if current_ref is not None and current.low < current_ref.level and current.close > current_ref.level:
            return {
                "reason": "current candle swept the 20-bar low and reclaimed above it",
                "entry": current.close,
                "sweep_extreme": current.low,
                "reference": current_ref,
            }
        if previous_ref is not None and previous.low < previous_ref.level and previous.close <= previous_ref.level and current.close > previous_ref.level:
            return {
                "reason": "Plus One: previous candle swept/closed outside, current candle reclaimed",
                "entry": current.close,
                "sweep_extreme": min(previous.low, current.low),
                "reference": previous_ref,
            }
        if previous_ref is not None and previous.low < previous_ref.level and previous.close > previous_ref.level and current.high > previous.high:
            return {
                "reason": "entry break after sweep/reclaim candle high",
                "entry": previous.high,
                "sweep_extreme": previous.low,
                "reference": previous_ref,
            }
    else:
        if current_ref is not None and current.high > current_ref.level and current.close < current_ref.level:
            return {
                "reason": "current candle swept the 20-bar high and reclaimed below it",
                "entry": current.close,
                "sweep_extreme": current.high,
                "reference": current_ref,
            }
        if previous_ref is not None and previous.high > previous_ref.level and previous.close >= previous_ref.level and current.close < previous_ref.level:
            return {
                "reason": "Plus One: previous candle swept/closed outside, current candle reclaimed",
                "entry": current.close,
                "sweep_extreme": max(previous.high, current.high),
                "reference": previous_ref,
            }
        if previous_ref is not None and previous.high > previous_ref.level and previous.close < previous_ref.level and current.low < previous.low:
            return {
                "reason": "entry break after sweep/reclaim candle low",
                "entry": previous.low,
                "sweep_extreme": previous.high,
                "reference": previous_ref,
            }

    return None


def _invalidated_signal(
    candles: list[Candle],
    direction: str,
    previous_ref: ReferenceLevel | None,
    trigger_atr: float,
    settings: dict[str, Any],
) -> bool:
    if previous_ref is None:
        return False
    current = candles[-1]
    previous = candles[-2]
    buffer = trigger_atr * settings["stop_buffer_atr"]

    if direction == "bullish":
        return previous.low < previous_ref.level and previous.close <= previous_ref.level and current.low < previous.low - buffer and current.close <= previous_ref.level
    return previous.high > previous_ref.level and previous.close >= previous_ref.level and current.high > previous.high + buffer and current.close >= previous_ref.level


def _forming_signal(candle: Candle, direction: str, reference: ReferenceLevel, trigger_atr: float, settings: dict[str, Any]) -> bool:
    approach_distance = trigger_atr * settings["forming_distance_atr"]
    if direction == "bullish":
        swept_without_reclaim = candle.low < reference.level and candle.close <= reference.level
        approaching = candle.close > reference.level and (candle.close - reference.level) <= approach_distance
        return swept_without_reclaim or approaching

    swept_without_reclaim = candle.high > reference.level and candle.close >= reference.level
    approaching = candle.close < reference.level and (reference.level - candle.close) <= approach_distance
    return swept_without_reclaim or approaching


def _missed_setup_reason(
    direction: str,
    current_price: float,
    entry: float,
    trigger_atr: float | None,
    risk: float | None,
    settings: dict[str, Any],
) -> str | None:
    if not settings.get("hide_missed_setups", True):
        return None

    distance = _chase_distance(direction, current_price, entry)
    if distance <= 0:
        return None

    limits: list[tuple[str, float]] = []
    max_chase_atr = float(settings.get("max_chase_atr", 0.75))
    max_chase_r = float(settings.get("max_chase_r", 0.75))
    if trigger_atr is not None and trigger_atr > 0 and max_chase_atr > 0:
        limits.append(("ATR", trigger_atr * max_chase_atr))
    if risk is not None and risk > 0 and max_chase_r > 0:
        limits.append(("R", risk * max_chase_r))
    if not limits:
        return None

    limit_name, limit = min(limits, key=lambda item: item[1])
    if distance <= limit:
        return None
    return f"missed/chased: moved {_fmt(distance)} from entry, beyond {max_chase_atr:.2f} ATR / {max_chase_r:.2f}R guard ({limit_name} limit {_fmt(limit)})"


def _chase_distance(direction: str, current_price: float, entry: float) -> float:
    if direction == "bullish":
        return current_price - entry
    return entry - current_price


def _stop_level(direction: str, sweep_extreme: float, trigger_atr: float, buffer_atr: float) -> float:
    buffer = trigger_atr * buffer_atr
    if direction == "bullish":
        return sweep_extreme - buffer
    return sweep_extreme + buffer


def _tp2_level(direction: str, entry: float, midpoint: float, reference: ReferenceLevel) -> float:
    if direction == "bullish":
        if midpoint > entry:
            return midpoint
        return reference.range_high
    if midpoint < entry:
        return midpoint
    return reference.range_low


def _setup_targets(
    direction: str,
    entry: float,
    stop: float,
    objective: LiquidityObjective,
    trigger_candles: list[Candle],
    settings: dict[str, Any],
    *,
    reference: ReferenceLevel | None = None,
) -> dict[str, Any]:
    risk = abs(entry - stop)
    tp1 = entry + risk if direction == "bullish" else entry - risk
    final_target = objective.level
    min_tp2_rr = settings["min_tp2_rr"]
    final_rr = _rr_ratio(entry, stop, final_target)
    candidates: list[dict[str, Any]] = []

    structure_target = _nearest_structure_target(direction, trigger_candles, entry, final_target, settings)
    if structure_target is not None:
        candidates.append(structure_target)

    fvg_target = _nearest_fvg_target(direction, trigger_candles, entry, final_target, settings)
    if fvg_target is not None:
        candidates.append(fvg_target)

    if reference is not None:
        ref_target = reference.range_high if direction == "bullish" else reference.range_low
        if _between_in_direction(direction, ref_target, entry, final_target):
            candidates.append({"level": ref_target, "reason": "range edge after the Turtle Soup reclaim", "source": "range"})

    valid_candidates = [
        item
        for item in candidates
        if (_rr_ratio(entry, stop, float(item["level"])) or 0) >= min_tp2_rr
    ]
    if valid_candidates:
        valid_candidates.sort(key=lambda item: abs(float(item["level"]) - entry))
        chosen = valid_candidates[0]
        tp2 = float(chosen["level"])
        tp2_reason = str(chosen["reason"])
        tp2_source = str(chosen["source"])
        target_quality = "clean"
    elif final_rr is not None and final_rr >= min_tp2_rr:
        tp2 = entry + risk * min_tp2_rr if direction == "bullish" else entry - risk * min_tp2_rr
        tp2_reason = f"minimum {min_tp2_rr:.2f}R expansion toward the HTF draw because nearer targets were too close"
        tp2_source = "minimum_rr"
        target_quality = "acceptable"
    elif candidates:
        candidates.sort(key=lambda item: abs(float(item["level"]) - entry))
        chosen = candidates[0]
        tp2 = float(chosen["level"])
        tp2_reason = f"{chosen['reason']} but target is too close for clean {min_tp2_rr:.2f}R planning"
        tp2_source = str(chosen["source"])
        target_quality = "weak"
    else:
        tp2 = (entry + final_target) / 2
        tp2_reason = "midpoint between entry and HTF draw because no cleaner internal target is available"
        tp2_source = "midpoint"
        target_quality = "weak" if (final_rr is not None and final_rr < min_tp2_rr) else "acceptable"

    zones = _fvg_zones(trigger_candles, settings["fvg_lookback"])
    plan: dict[str, Any] = {
        "tp1": tp1,
        "tp2": tp2,
        "final_target": final_target,
        "tp2_reason": tp2_reason,
        "tp2_source": tp2_source,
        "target_quality": target_quality,
        "target_notes": [
            f"Target map: TP1 is 1R; TP2 is {tp2_reason}; final target is the HTF draw at {_fmt(final_target)}."
        ],
    }
    if final_rr is not None and final_rr < settings["min_final_rr"]:
        plan["target_blocker"] = f"final HTF draw only offers {final_rr:.2f}R, below minimum {settings['min_final_rr']:.2f}R"
        plan["target_notes"].append(f"Target warning: {plan['target_blocker']}.")
    elif target_quality == "weak":
        plan["target_notes"].append("Target warning: no clean TP2 beyond TP1; treat this as lower quality.")

    supportive_fvg = _nearest_zone(zones, direction, entry, kind="fvg")
    supportive_ifvg = _nearest_zone(zones, direction, entry, kind="ifvg")
    opposing_zone = _nearest_zone(zones, _opposite_direction(direction), entry, kind=None)
    if supportive_fvg is not None:
        plan["fvg_zone"] = _zone_plan(supportive_fvg)
    if supportive_ifvg is not None:
        plan["ifvg_zone"] = _zone_plan(supportive_ifvg)
    if opposing_zone is not None:
        plan["opposing_fvg_zone"] = _zone_plan(opposing_zone)
    return plan


def _apply_target_plan(trade_plan: dict[str, Any], target_plan: dict[str, Any]) -> None:
    for key in (
        "tp2_reason",
        "tp2_source",
        "target_quality",
        "target_blocker",
        "target_notes",
        "fvg_zone",
        "ifvg_zone",
        "opposing_fvg_zone",
    ):
        if key in target_plan:
            trade_plan[key] = target_plan[key]


def _nearest_structure_target(
    direction: str,
    candles: list[Candle],
    entry: float,
    final_target: float,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    side = "high" if direction == "bullish" else "low"
    levels = _structure_levels(
        candles,
        side,
        settings["swing_span"],
        settings["target_lookback"],
        end_index_exclusive=len(candles),
    )
    candidates = [
        level
        for _, level in levels
        if _between_in_direction(direction, level, entry, final_target)
    ]
    if not candidates:
        return None
    level = min(candidates, key=lambda item: abs(item - entry))
    return {
        "level": level,
        "reason": f"nearest internal swing {'high liquidity' if direction == 'bullish' else 'low liquidity'}",
        "source": "internal_liquidity",
    }


def _nearest_fvg_target(
    direction: str,
    candles: list[Candle],
    entry: float,
    final_target: float,
    settings: dict[str, Any],
) -> dict[str, Any] | None:
    zones = _fvg_zones(candles, settings["fvg_lookback"])
    target_direction = _opposite_direction(direction)
    candidates = [
        zone
        for zone in zones
        if zone.direction == target_direction and _between_in_direction(direction, zone.midpoint, entry, final_target)
    ]
    if not candidates:
        return None
    zone = min(candidates, key=lambda item: abs(item.midpoint - entry))
    label = "iFVG" if zone.kind == "ifvg" else "FVG"
    return {
        "level": zone.midpoint,
        "reason": f"nearest opposing {label} midpoint {_fmt(zone.low)}-{_fmt(zone.high)}",
        "source": zone.kind,
    }


def _between_in_direction(direction: str, level: float, entry: float, final_target: float) -> bool:
    if direction == "bullish":
        return entry < level <= final_target
    return final_target <= level < entry


def _zone_plan(zone: FvgZone) -> dict[str, Any]:
    return {
        "kind": zone.kind,
        "direction": zone.direction,
        "low": zone.low,
        "high": zone.high,
        "midpoint": zone.midpoint,
        "index": zone.index,
    }


def _order_block_plan(zone: OrderBlockZone) -> dict[str, Any]:
    return {
        "kind": zone.kind,
        "direction": zone.direction,
        "low": zone.low,
        "high": zone.high,
        "midpoint": zone.midpoint,
        "index": zone.index,
    }


def _nearest_order_block(
    candles: list[Candle],
    direction: str,
    lookback: int,
    *,
    before_index: int | None = None,
) -> OrderBlockZone | None:
    if len(candles) < 3:
        return None
    end = len(candles) - 1 if before_index is None else max(1, min(before_index, len(candles) - 1))
    start = max(1, end - max(3, lookback))
    for index in range(end - 1, start - 1, -1):
        candle = candles[index]
        previous = candles[index - 1]
        if direction == "bullish":
            qualifies = candle.close <= candle.open or candle.close < previous.close
            kind = "bullish_order_block"
        else:
            qualifies = candle.close >= candle.open or candle.close > previous.close
            kind = "bearish_order_block"
        if qualifies:
            return OrderBlockZone(
                kind=kind,
                direction=direction,
                low=min(candle.open, candle.close, candle.low),
                high=max(candle.open, candle.close, candle.high),
                index=index,
            )
    return None


def _apply_institutional_context(
    trade_plan: dict[str, Any] | None,
    direction: str,
    context_timeframe: str,
    trigger_timeframe: str,
    context_candles: list[Candle],
    trigger_candles: list[Candle],
    settings: dict[str, Any],
    *,
    objective: LiquidityObjective | None,
    raid: HtfRaid | None = None,
    reference_level: float | None = None,
    sweep_extreme: float | None = None,
    trigger: dict[str, Any] | None = None,
) -> None:
    if trade_plan is None or not trigger_candles:
        return

    latest = trigger_candles[-1]
    entry = _float_or_none(trade_plan.get("entry")) or latest.close
    stop = _float_or_none(trade_plan.get("stop"))
    external_draw = objective.level if objective is not None else _float_or_none(trade_plan.get("final_target"))
    reference = reference_level if reference_level is not None else _float_or_none(trade_plan.get("reference_level"))
    extreme = sweep_extreme if sweep_extreme is not None else _float_or_none(trade_plan.get("sweep_extreme"))
    order_block = _nearest_order_block(
        trigger_candles,
        direction,
        settings["target_lookback"],
        before_index=len(trigger_candles) - 1,
    )
    if order_block is not None:
        trade_plan["order_block"] = _order_block_plan(order_block)

    liquidity_map: dict[str, Any] = {
        "bias": direction,
        "context_timeframe": context_timeframe,
        "trigger_timeframe": trigger_timeframe,
        "external_draw": external_draw,
        "external_draw_kind": objective.kind if objective is not None else "",
        "internal_target": trade_plan.get("tp2"),
        "internal_target_source": trade_plan.get("tp2_source"),
        "sweep_level": reference,
        "sweep_extreme": extreme,
    }
    trade_plan["liquidity_map"] = liquidity_map
    trade_plan["directional_bias"] = direction
    trade_plan["inducement"] = _inducement_plan(direction, raid, reference, extreme, trigger_timeframe)
    trade_plan["market_delivery"] = _market_delivery_model(direction, raid, trigger, trade_plan)
    trade_plan["session_context"] = {
        "name": _session_name(latest.timestamp_ms) or "Outside London / New York killzone",
        "timestamp_ms": latest.timestamp_ms,
    }
    trade_plan["scenarios"] = _scenario_plan(direction, entry, stop, external_draw, trade_plan, trigger_timeframe)
    trade_plan["data_limitations"] = [
        "Live macro, positioning and sentiment feeds are not connected; this setup is price-action/SMC only."
    ]


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _inducement_plan(
    direction: str,
    raid: HtfRaid | None,
    reference_level: float | None,
    sweep_extreme: float | None,
    trigger_timeframe: str,
) -> dict[str, Any]:
    side = "sell-side" if direction == "bullish" else "buy-side"
    side_key = "sell_side" if direction == "bullish" else "buy_side"
    if raid is not None:
        return {
            "type": f"{side_key}_raid",
            "level": raid.level,
            "extreme": raid.sweep_extreme,
            "note": f"{side} liquidity was taken first; wait for {trigger_timeframe} displacement to confirm intent.",
        }
    if reference_level is not None:
        return {
            "type": f"{side_key}_sweep",
            "level": reference_level,
            "extreme": sweep_extreme,
            "note": f"{side} reference liquidity is the inducement area; do not chase after the displacement leg.",
        }
    return {
        "type": "none",
        "note": "No clear inducement level is mapped yet.",
    }


def _market_delivery_model(
    direction: str,
    raid: HtfRaid | None,
    trigger: dict[str, Any] | None,
    trade_plan: dict[str, Any],
) -> dict[str, str]:
    mode = str((trigger or {}).get("trigger_mode") or trade_plan.get("trigger_mode") or "")
    if raid is not None and mode:
        return {
            "phase": "manipulation_to_expansion",
            "note": f"Raid created the manipulation leg; {mode.upper()} is the expansion confirmation.",
        }
    if mode:
        return {
            "phase": "expansion",
            "note": f"{mode.upper()} is active; manage around entry, invalidation and draw.",
        }
    return {
        "phase": "reaccumulation" if direction == "bullish" else "redistribution",
        "note": "Context is mapped, but trigger expansion is still missing.",
    }


def _scenario_plan(
    direction: str,
    entry: float,
    stop: float | None,
    final_target: float | None,
    trade_plan: dict[str, Any],
    trigger_timeframe: str,
) -> dict[str, Any]:
    primary_name = "Bullish case" if direction == "bullish" else "Bearish case"
    opposite_name = "Bearish case" if direction == "bullish" else "Bullish case"
    trigger_side = "above" if direction == "bullish" else "below"
    invalid_side = "below" if direction == "bullish" else "above"
    opposite_trigger_side = "below" if direction == "bullish" else "above"
    targets = [value for value in (trade_plan.get("tp1"), trade_plan.get("tp2"), final_target) if value is not None]
    return {
        "primary": {
            "name": primary_name,
            "direction": direction,
            "probability": "higher while HTF draw, location, raid and trigger stay aligned; not a statistical forecast",
            "trigger": f"Hold/close {trigger_side} the trigger level on {trigger_timeframe}.",
            "targets": targets,
            "invalidation": stop,
        },
        "opposite": {
            "name": opposite_name,
            "direction": _opposite_direction(direction),
            "probability": "lower unless invalidation breaks or HTF draw flips",
            "trigger": f"Clean close {opposite_trigger_side} invalidation or back through the raid level.",
            "targets": [],
            "invalidation": entry,
        },
        "rule": f"Respect invalidation {invalid_side} {trigger_timeframe} structure; no prediction, only scenario response.",
    }


def _institutional_detail_lines(trade_plan: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    liquidity = trade_plan.get("liquidity_map")
    if isinstance(liquidity, dict):
        external = liquidity.get("external_draw")
        internal = liquidity.get("internal_target")
        if external is not None:
            lines.append(
                f"Liquidity map: external draw {_fmt(float(external))}; "
                f"internal target {_fmt(float(internal)) if internal is not None else 'n/a'}."
            )
    order_block = trade_plan.get("order_block")
    if isinstance(order_block, dict):
        lines.append(
            f"Order block: {str(order_block.get('kind', 'order block')).replace('_', ' ')} "
            f"{_fmt(float(order_block['low']))}-{_fmt(float(order_block['high']))}; "
            f"mitigation midpoint {_fmt(float(order_block['midpoint']))}."
        )
    inducement = trade_plan.get("inducement")
    if isinstance(inducement, dict) and inducement.get("type") != "none":
        lines.append(f"Inducement: {inducement.get('note')}")
    delivery = trade_plan.get("market_delivery")
    if isinstance(delivery, dict):
        lines.append(f"Delivery model: {delivery.get('note')}")
    scenarios = trade_plan.get("scenarios")
    if isinstance(scenarios, dict):
        primary = scenarios.get("primary") or {}
        opposite = scenarios.get("opposite") or {}
        if primary:
            target_text = ", ".join(_fmt(float(item)) for item in primary.get("targets") or [])
            lines.append(
                f"Scenario: {primary.get('name')} — trigger: {primary.get('trigger')} "
                f"Targets: {target_text or 'mapped after trigger'}."
            )
        if opposite:
            lines.append(
                f"Opposite scenario: {opposite.get('name')} only if {opposite.get('trigger')}"
            )
    for note in trade_plan.get("data_limitations") or []:
        lines.append(f"Data note: {note}")
    return lines


def _pdf_framework_detail_lines(trade_plan: dict[str, Any]) -> list[str]:
    if trade_plan.get("framework_version") != CRT_FRAMEWORK_VERSION:
        return []
    lines = [f"Framework: {CRT_FRAMEWORK_VERSION} from {CRT_SOURCE_DOCUMENT}."]
    htf = trade_plan.get("htf_narrative")
    if isinstance(htf, dict):
        lines.append(f"HTF narrative: {htf.get('status')} - {htf.get('detail')}")
    key_level = trade_plan.get("key_level")
    if isinstance(key_level, dict):
        level = key_level.get("level")
        level_text = _fmt(float(level)) if level is not None else "n/a"
        lines.append(f"Key level: {key_level.get('status')} - {level_text} ({key_level.get('kind')}).")
    fvg = trade_plan.get("fvg_confluence")
    if isinstance(fvg, dict):
        lines.append(f"FVG confluence: {fvg.get('status')} - {fvg.get('detail')}")
    smt = trade_plan.get("smt_status")
    if isinstance(smt, dict):
        lines.append(f"SMT: {smt.get('status')} - {smt.get('detail')}")
    session_gate = trade_plan.get("session_gate")
    if isinstance(session_gate, dict):
        lines.append(f"Session: {session_gate.get('status')} - {session_gate.get('detail')}")
    return lines


def _add_trigger_watch_map(
    trade_plan: dict[str, Any],
    trigger_candles: list[Candle],
    direction: str,
    settings: dict[str, Any],
) -> None:
    msb = _next_msb_level(trigger_candles, direction, settings)
    if msb is not None:
        trade_plan["msb_level"] = float(msb["level"])
        trade_plan["msb_timestamp_ms"] = int(msb["level_timestamp_ms"])

    latest_close = trigger_candles[-1].close
    zones = _fvg_zones(trigger_candles, settings["fvg_lookback"])
    supportive_fvg = _nearest_zone(zones, direction, latest_close, kind="fvg")
    supportive_ifvg = _nearest_zone(zones, direction, latest_close, kind="ifvg")
    opposing_zone = _nearest_zone(zones, _opposite_direction(direction), latest_close, kind=None)
    if supportive_fvg is not None:
        trade_plan["fvg_zone"] = _zone_plan(supportive_fvg)
    if supportive_ifvg is not None:
        trade_plan["ifvg_zone"] = _zone_plan(supportive_ifvg)
    if opposing_zone is not None:
        trade_plan["opposing_fvg_zone"] = _zone_plan(opposing_zone)


def _fvg_plan_details(trade_plan: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    fvg = trade_plan.get("fvg_zone")
    if isinstance(fvg, dict):
        lines.append(
            f"FVG confluence: active {fvg.get('direction')} FVG {_fmt(float(fvg['low']))}-{_fmt(float(fvg['high']))}"
        )
    ifvg = trade_plan.get("ifvg_zone")
    if isinstance(ifvg, dict):
        lines.append(
            f"iFVG confluence: inverted {ifvg.get('direction')} FVG {_fmt(float(ifvg['low']))}-{_fmt(float(ifvg['high']))}"
        )
    opposing = trade_plan.get("opposing_fvg_zone")
    if isinstance(opposing, dict):
        lines.append(
            f"Opposing imbalance: {opposing.get('kind')} {_fmt(float(opposing['low']))}-{_fmt(float(opposing['high']))}"
        )
    return lines


def _apply_quality_to_trade_plan(trade_plan: dict[str, Any] | None, quality: QualityResult) -> None:
    if trade_plan is None:
        return
    trade_plan["setup_grade"] = normalize_setup_grade(quality.grade)
    trade_plan["setup_action"] = quality.action
    trade_plan["quality_score"] = quality.score
    trade_plan["quality_max_score"] = quality.max_score
    trade_plan["quality_warnings"] = list(quality.weak_points or [])


def _apply_gate_to_trade_plan(trade_plan: dict[str, Any] | None, blockers: list[str] | None) -> None:
    if trade_plan is None:
        return
    clean_blockers = [str(item) for item in blockers or [] if str(item)]
    trade_plan["gate_status"] = "blocked" if clean_blockers else "passed"
    trade_plan["gate_blockers"] = clean_blockers


def _raid_candle_plan(raid: HtfRaid) -> dict[str, Any]:
    return {
        "open": raid.candle.open,
        "high": raid.candle.high,
        "low": raid.candle.low,
        "close": raid.candle.close,
        "timestamp_ms": raid.candle.timestamp_ms,
        "label": raid.candle_label,
        "bars_since_raid": raid.bars_since_raid,
    }


def _context_crt_plan(raid: HtfRaid) -> dict[str, Any]:
    return {
        "level": raid.level,
        "sweep_extreme": raid.sweep_extreme,
        "timestamp_ms": raid.candle.timestamp_ms,
        "label": raid.candle_label,
        "bars_since_crt": raid.bars_since_raid,
    }


def _apply_context_crt_to_trade_plan(trade_plan: dict[str, Any] | None, raid: HtfRaid | None) -> None:
    if trade_plan is None or raid is None:
        return
    trade_plan["context_crt"] = _context_crt_plan(raid)


def _apply_raid_lifecycle(trade_plan: dict[str, Any] | None, raid: HtfRaid | None) -> None:
    if trade_plan is None or raid is None:
        return
    trade_plan["raid_timestamp_ms"] = int(raid.candle.timestamp_ms)
    trade_plan["raid_age_bars"] = int(raid.bars_since_raid)
    trade_plan["lifecycle_key"] = f"raid:{int(raid.candle.timestamp_ms)}"


def _hard_quality_blockers(quality: QualityResult) -> list[str]:
    blockers: list[str] = []
    for point in quality.weak_points or []:
        text = str(point)
        if "weak displacement" in text:
            blockers.append(text)
        if "weak trigger candle" in text:
            blockers.append(text)
    return blockers


def _assess_setup_quality(
    stage: str,
    filters: set[str],
    direction: str,
    context_candles: list[Candle],
    trigger_candles: list[Candle],
    settings: dict[str, Any] | None = None,
) -> QualityResult:
    settings = settings or _settings({})
    latest_context = context_candles[-1]
    latest_trigger = trigger_candles[-1]
    score = 0
    max_score = 0
    lines: list[str] = []
    weak_points: list[str] = []

    if "premium_discount" in filters:
        max_score += 1
        recent = context_candles[-20:] if len(context_candles) >= 20 else context_candles
        high = max(candle.high for candle in recent)
        low = min(candle.low for candle in recent)
        midpoint = (high + low) / 2
        in_discount = latest_context.close <= midpoint
        in_premium = latest_context.close >= midpoint
        matched = in_discount if direction == "bullish" else in_premium
        if matched:
            score += 1
        if direction == "bullish":
            if matched:
                lines.append("Location: A — HTF is in discount versus its recent range; favorable for a long setup")
            else:
                lines.append("Location: weak — HTF is in premium; a long setup would be cleaner from discount")
                weak_points.append("location mismatch for long")
        elif matched:
            lines.append("Location: A — HTF is in premium versus its recent range; favorable for a short setup")
        else:
            lines.append("Location: weak — HTF is in discount; a short setup would be cleaner from premium")
            weak_points.append("location mismatch for short")

    if "candle_profile" in filters:
        max_score += 1
        candle_range = latest_trigger.high - latest_trigger.low
        body = abs(latest_trigger.close - latest_trigger.open)
        close_position = 0.5 if candle_range == 0 else (latest_trigger.close - latest_trigger.low) / candle_range
        body_ratio = 0 if candle_range == 0 else body / candle_range
        bullish_profile = body_ratio >= 0.45 and close_position >= 0.6
        bearish_profile = body_ratio >= 0.45 and close_position <= 0.4
        matched = bullish_profile if direction == "bullish" else bearish_profile
        if matched:
            score += 1
        if direction == "bullish":
            if matched:
                lines.append("Trigger candle: A — strong body and upper-range close; buyers rejected the low")
            else:
                if body_ratio < 0.45:
                    reason = "small body / indecision"
                elif close_position < 0.6:
                    reason = "close is not in the upper part of the candle"
                else:
                    reason = "no clear bullish rejection"
                lines.append(f"Trigger candle: weak — {reason}")
                weak_points.append(f"weak trigger candle ({reason})")
        elif matched:
            lines.append("Trigger candle: A — strong body and lower-range close; sellers rejected the high")
        else:
            if body_ratio < 0.45:
                reason = "small body / indecision"
            elif close_position > 0.4:
                reason = "close is not in the lower part of the candle"
            else:
                reason = "no clear bearish rejection"
            lines.append(f"Trigger candle: weak — {reason}")
            weak_points.append(f"weak trigger candle ({reason})")

    if "displacement" in filters:
        max_score += 1
        displacement = _displacement_result(latest_trigger, direction, _latest_atr(trigger_candles) or 0, settings)
        if displacement["passed"]:
            score += 1
            lines.append(
                f"Displacement: A — body {displacement['body_ratio']:.2f}, range {displacement['range_atr']:.2f} ATR"
            )
        else:
            reason = "; ".join(displacement["reasons"]) or "no clear directional expansion"
            lines.append(f"Displacement: weak — {reason}")
            weak_points.append(f"weak displacement ({reason})")

    if "session" in filters:
        max_score += 1
        session_name = _session_name(latest_trigger.timestamp_ms)
        if session_name:
            score += 1
            lines.append(f"Session: A — signal formed during {session_name}")
        else:
            lines.append("Session: weak — outside London / NY killzone")
            weak_points.append("outside ICT killzone")

    zones = _fvg_zones(trigger_candles, 50)
    if "fvg" in filters:
        max_score += 1
        zone = _nearest_zone(zones, direction, latest_trigger.close, kind="fvg")
        if zone is not None:
            score += 1
            lines.append(
                f"FVG: A — active {direction} FVG nearby {_fmt(zone.low)}-{_fmt(zone.high)}"
            )
        else:
            lines.append(f"FVG: weak — no active {direction} FVG in the recent trigger structure")
            weak_points.append(f"no active {direction} FVG")

    if "ifvg" in filters:
        max_score += 1
        zone = _nearest_zone(zones, direction, latest_trigger.close, kind="ifvg")
        if zone is not None:
            score += 1
            lines.append(
                f"iFVG: A — inverted {direction} FVG nearby {_fmt(zone.low)}-{_fmt(zone.high)}"
            )
        else:
            lines.append(f"iFVG: neutral — no recent {direction} iFVG confirmation")
            weak_points.append(f"no recent {direction} iFVG")

    grade, action = _setup_grade_and_action(stage, score, max_score, weak_points)
    if max_score:
        summary = _setup_grade_summary(stage, grade, action, weak_points)
        lines.insert(0, f"Setup: {grade} — {summary}")
        return QualityResult(grade=grade, action=action, lines=lines, score=score, max_score=max_score, weak_points=weak_points)

    return QualityResult(
        grade=TOP_SETUP_GRADE,
        action="Wait for confirmation" if stage == STAGE_FORMING else "Tradable",
        lines=lines,
        score=score,
        max_score=max_score,
        weak_points=weak_points,
    )


def _setup_grade_and_action(
    stage: str,
    score: int,
    max_score: int,
    weak_points: list[str],
) -> tuple[str, str]:
    if max_score == 0:
        return "—", "No quality checks"

    forming = stage == STAGE_FORMING
    if score == max_score:
        return TOP_SETUP_GRADE, "Clean watchlist - wait for trigger" if forming else "Clean plan"
    if score == 0:
        return GRADE_ML, "Pass" if not forming else "No trade - low quality"
    if any("location mismatch" in point for point in weak_points):
        return GRADE_CB, "Risky location" if not forming else "Needs cleaner location"
    return GRADE_A, "Good watchlist - wait for trigger" if forming else "Good plan - conditional"


def _setup_grade_summary(stage: str, grade: str, action: str, weak_points: list[str]) -> str:
    forming = stage == STAGE_FORMING
    joined = ", ".join(weak_points) if weak_points else "missing quality check"

    if grade == TOP_SETUP_GRADE:
        if forming:
            return "Clean watchlist. Wait for trigger confirmation"
        return "Clean confirmed plan. Quality checks passed"

    if grade == GRADE_A:
        if forming:
            return f"Good watchlist. Wait for confirmation. Concern: {joined}"
        return f"Good plan with one concern: {joined}"

    if grade == GRADE_CB:
        return f"Lower quality. Needs cleaner confirmation. Concern: {joined}"

    if forming:
        return f"No trade. Low quality. Concern: {joined}"
    return f"Pass. Low quality. Concern: {joined}"


def enrich_alert_grade(alert: dict[str, Any]) -> dict[str, Any]:
    plan = dict(alert.get("trade_plan") or {})
    existing = normalize_setup_grade(plan.get("setup_grade"))
    if existing in VISIBLE_SETUP_GRADES:
        plan["setup_grade"] = existing
        alert = {**alert, "trade_plan": plan}
        return alert

    details = alert.get("details") or []
    for line in details:
        text = str(line)
        if not text.startswith("Setup:") and not text.startswith("Setup notu:"):
            continue
        payload = text.split(":", 1)[1].strip()
        for grade in (TOP_SETUP_GRADE, GRADE_A, GRADE_CB, GRADE_ML, "B", "C", "D"):
            if payload.startswith(grade):
                plan["setup_grade"] = normalize_setup_grade(grade)
                if " — " in payload:
                    plan["setup_action"] = payload.split(" — ", 1)[1].strip()
                alert = {**alert, "trade_plan": plan}
                return alert

    legacy = _legacy_grade_from_details(details, str(alert.get("stage") or ""))
    if legacy:
        plan["setup_grade"] = normalize_setup_grade(legacy[0])
        plan["setup_action"] = legacy[1]
        alert = {**alert, "trade_plan": plan}
    return alert


def _legacy_grade_from_details(details: list[Any], stage: str) -> tuple[str, str] | None:
    score = None
    max_score = None
    for line in details:
        text = str(line)
        if text.startswith("Kalite puanı:"):
            parts = text.replace("Kalite puanı:", "").strip().split("/")
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                score = int(parts[0])
                max_score = int(parts[1])
            break

    if score is None or max_score is None or max_score <= 0:
        checks = [
            line for line in details if str(line).startswith(("Fiyat bölgesi:", "Mum yapısı:", "Trend (EMA20):"))
        ]
        if not checks:
            return None
        score = sum(1 for line in checks if _legacy_detail_passed(str(line)))
        max_score = len(checks)

    grade, action = _legacy_grade_and_action(stage, score, max_score)
    return grade, action


def _legacy_detail_passed(text: str) -> bool:
    if "UYGUN DEĞİL" in text or "uygun değil" in text:
        return False
    if ": A" in text or ": A+" in text:
        return True
    return text.rstrip().endswith("(uygun)")


def _legacy_grade_and_action(stage: str, score: int, max_score: int) -> tuple[str, str]:
    forming = stage == STAGE_FORMING
    ratio = score / max_score if max_score else 0
    if ratio >= 1:
        return TOP_SETUP_GRADE, "Wait for confirmation - strong potential" if forming else "Tradable - criteria complete"
    if ratio >= 2 / 3:
        return GRADE_A, "Good setup - one criterion missing" if forming else "Good setup - conditional"
    if ratio >= 1 / 3:
        return GRADE_CB, "Could be - several weak criteria" if forming else "Could be - risky"
    return GRADE_ML, "Low quality - no trade yet" if forming else "Low quality - pass"


def _range_expansion_warning(candles: list[Candle]) -> str | None:
    if len(candles) < 22:
        return None
    ranges = [candle.high - candle.low for candle in candles]
    average_ranges = sma(ranges[:-1], 20)
    baseline = average_ranges[-1]
    current_range = ranges[-1]
    if baseline is not None and current_range >= baseline * 1.8:
        return "Momentum warning: range expanded quickly; consider locking profit or tightening the stop."
    return None


def _alert_id(setup: SetupConfig, profile_name: str, direction: str, stage: str) -> str:
    return f"{setup.type}:{profile_name}:{direction}:{stage}"


def _build_trade_plan(
    entry: float,
    stop: float,
    tp1: float | None = None,
    tp2: float | None = None,
    final_target: float | None = None,
) -> dict[str, Any]:
    risk = abs(entry - stop)
    plan: dict[str, Any] = {
        "entry": entry,
        "stop": stop,
        "risk": risk,
    }
    if tp1 is not None:
        plan["tp1"] = tp1
        plan["rr_tp1"] = _rr_ratio(entry, stop, tp1)
    if tp2 is not None:
        plan["tp2"] = tp2
        plan["rr_tp2"] = _rr_ratio(entry, stop, tp2)
    if final_target is not None:
        plan["final_target"] = final_target
        plan["rr_final"] = _rr_ratio(entry, stop, final_target)
    return plan


def _rr_ratio(entry: float, stop: float, target: float) -> float | None:
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    return abs(target - entry) / risk


def _fmt_rr(ratio: float | None) -> str:
    if ratio is None:
        return "—"
    return f"1:{ratio:.2f}"


def _rr_details(plan: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    risk = plan.get("risk")
    if risk is not None:
        lines.append(f"Risk distance: {_fmt(risk)} (|entry - stop|)")

    if plan.get("rr_tp1") is not None:
        lines.append(f"RR TP1: {_fmt_rr(plan['rr_tp1'])}")
    if plan.get("rr_tp2") is not None:
        lines.append(f"RR TP2: {_fmt_rr(plan['rr_tp2'])}")
    if plan.get("rr_final") is not None:
        lines.append(f"RR final target: {_fmt_rr(plan['rr_final'])}")
    return lines


def _direction_text(direction: str) -> str:
    return "Bullish (LONG)" if direction == "bullish" else "Bearish (SHORT)"


def _liquidity_kind_text(kind: str) -> str:
    mapping = {
        "unclaimed equal high": "unclaimed equal high",
        "unclaimed swing high": "unclaimed swing high",
        "unclaimed equal low": "unclaimed equal low",
        "unclaimed swing low": "unclaimed swing low",
    }
    return mapping.get(kind, kind)


def _narrative_thesis(
    *,
    stage: str,
    direction: str,
    context_timeframe: str,
    trigger_timeframe: str,
    objective: LiquidityObjective | None = None,
    reference: ReferenceLevel | None = None,
    confirmation: dict[str, Any] | None = None,
    level: float | None = None,
    sweep_extreme: float | None = None,
    entry: float | None = None,
    lookback: int = 20,
    ) -> list[str]:
    dir_label = "LONG" if direction == "bullish" else "SHORT"
    level_side = "low" if direction == "bullish" else "high"
    close_side = "above" if direction == "bullish" else "below"
    htf_dir = "up into" if direction == "bullish" else "down into"

    if stage == "confirmed" and objective and reference and confirmation:
        sweep = sweep_extreme if sweep_extreme is not None else float(confirmation["sweep_extreme"])
        ent = entry if entry is not None else float(confirmation["entry"])
        return [
            f"Why {dir_label}?: On {trigger_timeframe}, price took the prior {lookback}-bar {level_side} at "
            f"{_fmt(reference.level)} (wick {_fmt(sweep)}) and closed back {close_side} it at {_fmt(ent)}.",
            f"HTF thesis ({context_timeframe}): {_liquidity_kind_text(objective.kind)} at {_fmt(objective.level)} "
            f"is still unclaimed; this setup looks for price to trade {htf_dir} that liquidity.",
        ]

    if stage == "forming" and objective and reference:
        return [
            f"Why watch?: {context_timeframe} has unclaimed liquidity at {_fmt(objective.level)}, giving a possible {dir_label} draw.",
            f"Trigger state: price is near the prior {lookback}-bar {level_side} at {_fmt(reference.level)}, but it has not taken and reclaimed that level yet.",
        ]

    if stage == "previous_context" and level is not None and sweep_extreme is not None:
        lines = [
            f"Why watch?: The last closed {context_timeframe} candle took the previous {context_timeframe} {level_side} "
            f"at {_fmt(level)} (wick {_fmt(sweep_extreme)}) and closed back through it. Wait for {trigger_timeframe} confirmation.",
        ]
        if objective:
            lines.append(
                f"HTF target: {_liquidity_kind_text(objective.kind)} at {_fmt(objective.level)}. If the trigger confirms, monitor the {dir_label} scenario."
            )
        else:
            lines.append(
                f"Confirmation needed: on {trigger_timeframe}, price must take the prior {lookback}-bar {level_side} and close back through it."
            )
        return lines

    return []


def _reason_text(reason: str) -> str:
    mapping = {
        "current candle swept the 20-bar low and reclaimed above it": "Current candle took the prior 20-bar low and closed back above it",
        "current candle swept the 20-bar high and reclaimed below it": "Current candle took the prior 20-bar high and closed back below it",
        "Plus One: previous candle swept/closed outside, current candle reclaimed": "Plus One: previous candle closed outside the level; current candle reclaimed it",
        "entry break after sweep/reclaim candle high": "Entry break through the high of the reclaim candle",
        "entry break after sweep/reclaim candle low": "Entry break through the low of the reclaim candle",
    }
    return mapping.get(reason, reason)


def _fmt(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.8g}"
