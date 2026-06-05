from tradebot.config import SetupConfig
from tradebot.models import Candle
from tradebot.setups import SetupEvaluator


def test_rsi_condition_matches_threshold():
    candles = [
        Candle(timestamp_ms=index, open=value, high=value, low=value, close=value, volume=100)
        for index, value in enumerate([1, 2, 3, 4, 5, 6, 7])
    ]
    setup = SetupConfig(
        name="rsi-test",
        enabled=True,
        cooldown_minutes=60,
        conditions={"indicator": "rsi", "period": 3, "operator": ">=", "value": 70},
    )

    evaluation = SetupEvaluator().evaluate(setup, candles)

    assert evaluation.matched


def test_all_group_requires_every_condition_to_match():
    candles = [
        Candle(timestamp_ms=index, open=value, high=value, low=value, close=value, volume=100)
        for index, value in enumerate(range(1, 80))
    ]
    setup = SetupConfig(
        name="combo",
        enabled=True,
        cooldown_minutes=60,
        conditions={
            "all": [
                {"indicator": "rsi", "period": 14, "operator": ">=", "value": 50},
                {"indicator": "price_vs_ema", "period": 20, "relation": "above"},
            ]
        },
    )

    evaluation = SetupEvaluator().evaluate(setup, candles)

    assert evaluation.matched

