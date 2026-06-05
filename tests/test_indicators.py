from tradebot.indicators import atr, crossed_above, crossed_below, ema, rsi, sma


def test_sma_returns_none_until_period_is_available():
    assert sma([1, 2, 3, 4], 3) == [None, None, 2, 3]


def test_ema_starts_with_simple_average():
    values = ema([1, 2, 3, 4], 3)

    assert values[0] is None
    assert values[1] is None
    assert values[2] == 2
    assert values[3] == 3


def test_rsi_returns_100_when_there_are_no_losses():
    values = rsi([1, 2, 3, 4, 5, 6], 3)

    assert values[-1] == 100


def test_cross_helpers_detect_direction():
    assert crossed_above(1, 2, 3, 2)
    assert not crossed_above(3, 2, 4, 2)
    assert crossed_below(3, 2, 1, 2)
    assert not crossed_below(1, 2, 0, 2)


def test_atr_uses_true_range():
    values = atr(
        highs=[10, 12, 13],
        lows=[8, 9, 10],
        closes=[9, 11, 12],
        period=2,
    )

    assert values[0] is None
    assert values[1] == 2.5
    assert values[2] == 2.75
