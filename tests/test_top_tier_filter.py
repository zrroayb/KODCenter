from tradebot.config import SetupConfig
from tradebot.kod import KodTurtleSoupEvaluator, TOP_SETUP_GRADE
from test_kod_turtle_soup import (
    PROFILE,
    _bullish_current_reclaim,
    _context_with_bullish_objective,
)


def test_top_tier_only_filters_non_a_plus_setups():
    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={
            "profiles": [PROFILE],
            "alert_stages": ["forming", "confirmed", "invalidated"],
            "top_tier_only": True,
        },
    )
    signals = KodTurtleSoupEvaluator().evaluate(
        setup,
        PROFILE,
        _context_with_bullish_objective(),
        _bullish_current_reclaim(),
    )
    assert signals == []


def test_top_tier_only_keeps_a_plus_setups():
    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={
            "profiles": [PROFILE],
            "alert_stages": ["confirmed"],
            "top_tier_only": True,
            "filters": [],
        },
    )
    signals = KodTurtleSoupEvaluator().evaluate(
        setup,
        PROFILE,
        _context_with_bullish_objective(),
        _bullish_current_reclaim(),
    )
    assert len(signals) == 1
    assert signals[0].trade_plan.get("setup_grade") == TOP_SETUP_GRADE
