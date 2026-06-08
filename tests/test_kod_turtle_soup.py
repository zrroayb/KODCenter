from tradebot.config import SetupConfig
from tradebot.kod import KodTurtleSoupEvaluator, signal_meets_telegram_grade
from tradebot.models import Candle


PROFILE = {"name": "intraday", "context_timeframe": "4h", "trigger_timeframe": "15m"}
PROFILE_SWING = {"name": "swing", "context_timeframe": "1d", "trigger_timeframe": "1h"}


def test_legacy_bullish_sweep_reclaim_does_not_alert_without_context_crt():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_current_reclaim())

    assert signals == []


def test_setup_grade_uses_letter_rating():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"min_final_rr": 0.5},
    )

    assert len(signals) == 1
    details = signals[0].details
    plan = signals[0].trade_plan or {}
    assert any(str(line).startswith("Setup:") for line in details)
    assert plan.get("setup_grade")
    assert plan.get("setup_action")
    assert plan.get("quality_score") is not None
    assert plan.get("quality_max_score") is not None
    assert isinstance(plan.get("quality_warnings"), list)
    assert not any("UYGUN DEĞİL" in str(line) for line in details)
    assert not any("Kalite puanı" in str(line) for line in details)


def test_diagnose_explains_why_no_signal_is_ready():
    active_profile = PROFILE_SWING
    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={
            "profiles": [active_profile],
            "require_htf_raid_confirmation": True,
            "previous_candle_sweep": False,
        },
    )

    diagnostic = KodTurtleSoupEvaluator().diagnose(
        setup,
        active_profile,
        _context_with_bullish_objective(),
        _bullish_msb_break_without_daily_raid(),
    )

    assert diagnostic["headline"]
    assert diagnostic["checks"]
    assert diagnostic["directions"]
    assert diagnostic["next_steps"]


def test_targets_use_internal_liquidity_before_htf_draw():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"min_final_rr": 0.5},
    )

    plan = signals[0].trade_plan or {}
    assert plan.get("tp2_source")
    assert plan.get("tp2") is not None
    assert any("Target map" in detail for detail in signals[0].details)


def test_fvg_is_added_as_quality_confluence():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"min_final_rr": 0.5},
    )

    plan = signals[0].trade_plan or {}
    assert plan.get("fvg_zone", {}).get("kind") == "fvg"
    assert any("FVG: A" in detail for detail in signals[0].details)


def test_ifvg_is_added_as_quality_confluence():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_ifvg_after_daily_raid(),
        profile=PROFILE_SWING,
        params={"min_final_rr": 0.5},
    )

    plan = signals[0].trade_plan or {}
    assert plan.get("ifvg_trigger", {}).get("kind") == "ifvg"
    assert any("iFVG: A" in detail for detail in signals[0].details)


def test_legacy_bearish_sweep_reclaim_does_not_alert_without_context_crt():
    signals = _evaluate(_context_with_bearish_objective(), _bearish_current_reclaim())

    assert signals == []


def test_trigger_reclaim_forming_signal_is_disabled_without_context_crt():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_approaching_pool())

    assert signals == []


def test_plus_one_reclaim_does_not_bypass_context_crt_gate():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_plus_one_reclaim())

    assert signals == []


def test_new_liquidity_pool_does_not_alert():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_recent_pool())

    assert signals == []


def test_no_htf_draw_does_not_alert_on_ltf_sweep_only():
    signals = _evaluate(_context_without_near_objective(), _bullish_current_reclaim())

    assert signals == []


def test_confirmed_signal_is_blocked_when_htf_reclaim_conflicts():
    signals = _evaluate(
        _context_with_bullish_objective_and_bearish_htf_reclaim(),
        _bullish_current_reclaim(),
        params={"previous_candle_sweep": False},
    )

    assert signals == []


def test_wide_risk_is_called_out_in_message():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"max_stop_atr": 0.2},
    )

    assert len(signals) == 1
    assert any("WIDE RISK" in detail or "YÜKSEK RİSK" in detail for detail in signals[0].details)


def test_invalidated_signal_explains_failed_reclaim():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_failed_reclaim())

    assert signals == []


def test_previous_context_candle_sweep_warning_is_disabled():
    signals = _evaluate(_context_with_previous_low_sweep(), _neutral_trigger())

    assert signals == []


def test_previous_context_candle_sweep_is_hidden_after_price_runs_away():
    signals = _evaluate(_context_with_previous_low_sweep(), _neutral_trigger_far_above_reclaim())

    assert signals == []


def test_entry_break_confirmation_is_hidden_after_price_runs_away():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_entry_break_too_late())

    assert signals == []


def test_swing_profile_uses_1h_msb_instead_of_20_bar_reclaim():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_msb_break(), profile=PROFILE_SWING, params={"min_final_rr": 0.5})

    assert len(signals) == 1
    signal = signals[0]
    assert signal.stage == "confirmed"
    assert signal.direction == "bullish"
    assert signal.trade_plan is not None
    assert signal.trade_plan.get("trigger_mode") == "msb"
    assert signal.trade_plan.get("msb_level") == 105
    assert any("MSB" in detail for detail in signal.details)
    assert not any("prior 20-bar" in detail for detail in signal.details)


def test_swing_profile_forms_when_1h_is_near_msb_level():
    signals = _evaluate(_context_with_bullish_objective(), _bullish_msb_approaching(), profile=PROFILE_SWING)

    assert signals == []


def test_daily_raid_plus_1h_msb_confirms_when_required():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"require_htf_raid_confirmation": True, "previous_candle_sweep": False, "min_final_rr": 0.5},
    )

    assert len(signals) == 1
    signal = signals[0]
    assert signal.stage == "confirmed"
    assert signal.trade_plan is not None
    assert signal.trade_plan.get("trigger_mode") == "msb"
    assert signal.trade_plan.get("reference_level") is not None
    assert signal.trade_plan.get("sweep_extreme") is not None
    assert signal.trade_plan.get("context_crt", {}).get("level") is not None
    assert any("Context CRT" in detail for detail in signal.details)


def test_confirmed_plan_includes_institutional_smc_context():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params={"require_htf_raid_confirmation": True, "previous_candle_sweep": False, "min_final_rr": 0.5},
    )

    plan = signals[0].trade_plan or {}
    assert plan.get("liquidity_map", {}).get("external_draw") is not None
    assert plan.get("order_block", {}).get("kind") == "bullish_order_block"
    assert plan.get("inducement", {}).get("type") == "sell_side_raid"
    assert plan.get("market_delivery", {}).get("phase") == "manipulation_to_expansion"
    assert plan.get("scenarios", {}).get("primary", {}).get("name") == "Bullish case"
    assert plan.get("data_limitations")
    assert any("Order block:" in detail for detail in signals[0].details)
    assert any("Scenario:" in detail for detail in signals[0].details)
    assert any("Data note:" in detail for detail in signals[0].details)


def test_context_crt_without_trigger_does_not_emit_forming_signal():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_approaching(),
        profile=PROFILE_SWING,
        params={"require_htf_raid_confirmation": True, "previous_candle_sweep": False, "min_final_rr": 0.5},
    )

    assert signals == []


def test_intraday_profile_uses_same_htf_raid_model():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE,
        params={
            "require_htf_raid_confirmation": True,
            "previous_candle_sweep": False,
            "msb_profiles": ["intraday"],
        },
    )

    assert len(signals) == 1
    signal = signals[0]
    assert signal.stage == "confirmed"
    assert signal.context_timeframe == "4h"
    assert signal.trigger_timeframe == "15m"
    assert signal.trade_plan is not None
    assert signal.trade_plan.get("trigger_mode") == "msb"
    assert signal.trade_plan.get("context_crt", {}).get("level") is not None
    assert any("Context CRT" in detail for detail in signal.details)


def test_1h_msb_without_daily_raid_does_not_alert_when_required():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break_without_daily_raid(),
        profile=PROFILE_SWING,
        params={"require_htf_raid_confirmation": True, "previous_candle_sweep": False, "min_final_rr": 0.5},
    )

    assert signals == []


def test_fresh_fvg_displacement_does_not_confirm_without_ifvg_flip():
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_fvg_after_daily_raid(),
        profile=PROFILE_SWING,
        params={"require_htf_raid_confirmation": True, "previous_candle_sweep": False, "min_final_rr": 0.5},
    )

    assert signals == []


def test_strict_gate_blocks_wrong_htf_location_and_reports_diagnostic():
    params = _strict_gate_params()
    signals = _evaluate(
        _context_with_bullish_objective(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params=params,
    )

    assert signals == []

    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={"profiles": [PROFILE_SWING], **params},
    )
    diagnostic = KodTurtleSoupEvaluator().diagnose(
        setup,
        PROFILE_SWING,
        _context_with_bullish_objective(),
        _bullish_msb_break(),
    )

    bullish = next(item for item in diagnostic["directions"] if item["direction"] == "bullish")
    assert any("wrong HTF location" in blocker for blocker in bullish["gate"]["blockers"])


def test_strict_gate_blocks_weak_displacement_as_diagnostic_only():
    params = _strict_gate_params()
    signals = _evaluate(
        _context_with_bullish_objective_in_discount(),
        _bullish_msb_approaching(),
        profile=PROFILE_SWING,
        params=params,
    )

    assert signals == []

    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={"profiles": [PROFILE_SWING], **params},
    )
    diagnostic = KodTurtleSoupEvaluator().diagnose(
        setup,
        PROFILE_SWING,
        _context_with_bullish_objective_in_discount(),
        _bullish_msb_approaching(),
    )

    bullish = next(item for item in diagnostic["directions"] if item["direction"] == "bullish")
    assert signals == []
    assert bullish["gate"]["status"] == "blocked"
    assert any("weak displacement" in blocker for blocker in bullish["gate"]["blockers"])


def test_strict_clean_setup_emits_confirmed_lifecycle_plan():
    signals = _evaluate(
        _context_with_bullish_objective_in_discount(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params=_strict_gate_params(),
    )

    assert len(signals) == 1
    signal = signals[0]
    plan = signal.trade_plan or {}
    assert signal.stage == "confirmed"
    assert plan.get("setup_grade") == "A"
    assert plan.get("gate_status") == "passed"
    assert plan.get("gate_blockers") == []
    assert plan.get("raid_timestamp_ms") is not None
    assert plan.get("raid_age_bars") == 0
    assert str(plan.get("lifecycle_key", "")).startswith("raid:")


def test_swing_stale_raid_after_freshness_window_does_not_alert():
    signals = _evaluate(
        _context_with_bullish_objective_in_discount(),
        _stale_bullish_msb_break(raid_index=33),
        profile=PROFILE_SWING,
        params=_strict_gate_params(),
    )

    assert signals == []


def test_intraday_stale_raid_after_seven_trigger_bars_does_not_alert():
    params = _strict_gate_params()
    params["freshness_bars_by_profile"] = {"intraday": 6, "swing": 4}
    signals = _evaluate(
        _context_with_bullish_objective_in_discount(),
        _stale_bullish_msb_break(raid_index=32),
        profile=PROFILE,
        params={**params, "msb_profiles": ["intraday"]},
    )

    assert signals == []


def test_telegram_grade_threshold_is_stricter_for_forming():
    signals = _evaluate(
        _context_with_bullish_objective_in_discount(),
        _bullish_msb_break(),
        profile=PROFILE_SWING,
        params=_strict_gate_params(),
    )

    confirmed = signals[0]
    assert signal_meets_telegram_grade(confirmed, _strict_gate_params()) is True

    forming = KodTurtleSoupEvaluator().evaluate(
        SetupConfig(
            name="kod",
            enabled=True,
            cooldown_minutes=45,
            type="kod_turtle_soup",
            params={
                "profiles": [PROFILE_SWING],
                "require_htf_raid_confirmation": True,
                "previous_candle_sweep": False,
                "min_final_rr": 0.5,
            },
        ),
        PROFILE_SWING,
        _context_with_bullish_objective_in_discount(),
        _bullish_msb_approaching(),
    )
    assert forming == []


def _evaluate(context, trigger, params=None, profile=None):
    active_profile = profile or PROFILE
    setup_params = {
        "profiles": [active_profile],
        "alert_stages": ["forming", "confirmed", "invalidated"],
        "top_tier_only": False,
    }
    if params:
        setup_params.update(params)
    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params=setup_params,
    )
    return KodTurtleSoupEvaluator().evaluate(setup, active_profile, context, trigger)


def _strict_gate_params():
    return {
        "require_htf_raid_confirmation": True,
        "previous_candle_sweep": False,
        "min_final_rr": 0.5,
        "require_premium_discount_for_forming": True,
        "filters": ["premium_discount", "candle_profile", "displacement", "session", "fvg", "ifvg"],
        "htf_alignment": {
            "require_objective_for_confirmed": True,
            "allow_forming_without_alignment": True,
            "block_opposite_reclaim": True,
            "require_premium_discount_for_confirmed": True,
        },
        "min_alert_grade_by_stage": {"forming": "A", "confirmed": "A"},
        "telegram_min_grade_by_stage": {"forming": "A+", "confirmed": "A"},
        "freshness_bars_by_profile": {"intraday": 6, "swing": 4},
        "one_alert_per_raid": True,
    }


def _candle(index, open_, high, low, close, volume=100):
    return Candle(
        timestamp_ms=index * 60_000,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
    )


def _context_with_bullish_objective():
    candles = [_candle(index, 106, 108, 104, 106) for index in range(60)]
    candles[35] = _candle(35, 106, 110, 104, 107)
    candles[-1] = _candle(59, 107, 108.8, 104.8, 108.5)
    return candles


def _context_with_bullish_objective_in_discount():
    candles = _context_with_bullish_objective()
    candles[-1] = _candle(59, 106, 108.8, 104.8, 106.0)
    return candles


def _context_with_bearish_objective():
    candles = [_candle(index, 94, 96, 92, 94) for index in range(60)]
    candles[35] = _candle(35, 94, 96, 90, 93)
    candles[-1] = _candle(59, 93, 96, 91.2, 91.5)
    return candles


def _context_without_near_objective():
    candles = [_candle(index, 106, 108, 104, 106) for index in range(60)]
    candles[35] = _candle(35, 106, 120, 104, 107)
    candles[-1] = _candle(59, 107, 108.8, 104.8, 108.5)
    return candles


def _context_with_bullish_objective_and_bearish_htf_reclaim():
    candles = _context_with_bullish_objective()
    candles[-3] = _candle(57, 106, 107, 104, 106)
    candles[-2] = _candle(58, 106.5, 108, 105, 106.8)
    candles[-1] = _candle(59, 106.8, 108.8, 104.8, 108.5)
    return candles


def _context_with_previous_low_sweep():
    candles = [_candle(index, 106, 108, 104, 106) for index in range(60)]
    candles[-3] = _candle(57, 105, 109, 100, 104)
    candles[-2] = _candle(58, 104, 106, 95, 101)
    candles[-1] = _candle(59, 101, 102, 100, 101)
    return candles


def _base_bullish_trigger():
    candles = [_candle(index, 103, 104, 102, 103) for index in range(24)]
    candles[10] = _candle(10, 102, 103, 100, 102)
    return candles


def _neutral_trigger():
    candles = [_candle(index, 101, 102, 100, 101) for index in range(25)]
    return candles


def _neutral_trigger_far_above_reclaim():
    candles = _neutral_trigger()
    candles[-1] = _candle(24, 105, 106, 104, 105)
    return candles


def _bullish_current_reclaim():
    candles = _base_bullish_trigger()
    candles.append(_candle(24, 99.5, 103, 99, 101))
    return candles


def _bullish_reclaim_with_fvg():
    candles = _base_bullish_trigger()
    candles[20] = _candle(20, 100.6, 101, 100.4, 100.8)
    candles[22] = _candle(22, 101.8, 103, 101.5, 102.6)
    candles.append(_candle(24, 99.5, 103, 99, 101.2))
    return candles


def _bullish_reclaim_with_ifvg():
    candles = _base_bullish_trigger()
    candles[8] = _candle(8, 103.5, 104, 103, 103.5)
    candles[10] = _candle(10, 100.5, 101, 100, 100.5)
    candles[15] = _candle(15, 103, 104.5, 102.8, 104)
    candles.append(_candle(24, 99.5, 103, 99, 101))
    return candles


def _bullish_entry_break_too_late():
    candles = _base_bullish_trigger()
    candles.append(_candle(24, 99.5, 103, 99, 101))
    candles.append(_candle(25, 108, 110, 107, 109))
    return candles


def _bullish_approaching_pool():
    candles = _base_bullish_trigger()
    candles.append(_candle(24, 101, 102, 100.4, 100.3))
    return candles


def _bullish_plus_one_reclaim():
    candles = _base_bullish_trigger()
    candles.append(_candle(24, 100.2, 101, 99, 99.5))
    candles.append(_candle(25, 99.8, 102, 99.2, 101))
    return candles


def _bullish_failed_reclaim():
    candles = _base_bullish_trigger()
    candles.append(_candle(24, 100.2, 101, 99, 99.5))
    candles.append(_candle(25, 99.5, 100, 98, 98.5))
    return candles


def _bullish_recent_pool():
    candles = _base_bullish_trigger()
    candles[22] = _candle(22, 102, 103, 100, 102)
    candles.append(_candle(24, 99.5, 103, 99, 101))
    return candles


def _bearish_current_reclaim():
    candles = [_candle(index, 97, 98, 96, 97) for index in range(24)]
    candles[10] = _candle(10, 97, 100, 96, 98)
    candles.append(_candle(24, 100.5, 101, 97, 99))
    return candles


def _bullish_msb_base():
    candles = [_candle(index, 102, 103, 101, 102) for index in range(40)]
    candles[28] = _candle(28, 103, 105, 102, 103.5)
    candles[33] = _candle(33, 101, 102, 99, 101)
    return candles


def _bullish_msb_break():
    candles = _bullish_msb_base()
    candles[-2] = _candle(38, 103.5, 104.4, 102.8, 104)
    candles[-1] = _candle(39, 104.2, 106.4, 103.9, 106)
    return candles


def _bullish_msb_approaching():
    candles = _bullish_msb_base()
    candles[-2] = _candle(38, 103.2, 104.1, 102.8, 104)
    candles[-1] = _candle(39, 104.1, 104.9, 103.8, 104.8)
    return candles


def _bullish_msb_break_without_daily_raid():
    candles = [_candle(index, 105.2, 105.6, 105.05, 105.3) for index in range(40)]
    candles[28] = _candle(28, 105.2, 106, 105.1, 105.4)
    candles[-2] = _candle(38, 105.5, 105.8, 105.2, 105.8)
    candles[-1] = _candle(39, 105.8, 106.7, 105.4, 106.5)
    return candles


def _stale_bullish_msb_break(raid_index=33):
    candles = [_candle(index, 105.0, 105.2, 104.9, 105.0) for index in range(40)]
    candles[28] = _candle(28, 104.9, 105.5, 104.9, 105.1)
    candles[raid_index] = _candle(raid_index, 104.9, 105.1, 99, 101)
    for index in range(raid_index + 1, 39):
        candles[index] = _candle(index, 104.9, 105.2, 104.85, 105.0)
    candles[38] = _candle(38, 104.9, 105.2, 104.85, 105.0)
    candles[39] = _candle(39, 105.0, 106.8, 104.85, 106.5)
    return candles


def _bullish_fvg_after_daily_raid():
    candles = [_candle(index, 105.2, 108.0, 105.0, 105.3) for index in range(40)]
    candles[24] = _candle(24, 106.5, 108.5, 106.0, 107.5)
    candles[36] = _candle(36, 105.1, 105.6, 104.0, 105.2)
    candles[37] = _candle(37, 104.95, 105.0, 104.9, 104.95)
    candles[38] = _candle(38, 105.1, 105.8, 105.0, 105.6)
    candles[39] = _candle(39, 106.2, 108.0, 106.1, 107.9)
    return candles


def _bullish_ifvg_after_daily_raid():
    candles = [_candle(index, 105.2, 105.4, 105.0, 105.2) for index in range(40)]
    candles[28] = _candle(28, 104.9, 105.2, 104.8, 105.0)
    candles[33] = _candle(33, 104.6, 104.9, 99.0, 101.0)
    candles[35] = _candle(35, 106.0, 106.05, 106.0, 106.02)
    candles[36] = _candle(36, 105.8, 106.2, 105.7, 105.9)
    candles[37] = _candle(37, 105.0, 105.5, 104.9, 105.1)
    candles[38] = _candle(38, 105.7, 106.0, 105.5, 105.9)
    candles[39] = _candle(39, 105.1, 106.2, 105.0, 106.1)
    return candles
