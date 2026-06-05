from __future__ import annotations

from datetime import datetime, timezone

from tradebot.analysis import (
    BEARISH,
    BULLISH,
    NEUTRAL,
    analyze_symbol,
    displacement_rank,
    find_fvgs,
    find_swings,
    macro_bias,
    premium_discount,
    session_state,
)
from tradebot.models import Candle


def _c(t: int, o: float, h: float, low: float, c: float, v: float = 1.0) -> Candle:
    return Candle(timestamp_ms=t * 60_000, open=o, high=h, low=low, close=c, volume=v)


def _series(prices: list[float], spread: float = 1.0) -> list[Candle]:
    candles = []
    for i, p in enumerate(prices):
        prev = prices[i - 1] if i else p
        o, c = prev, p
        h = max(o, c) + spread
        low = min(o, c) - spread
        candles.append(_c(i, o, h, low, c))
    return candles


def test_find_swings_detects_pivots():
    candles = _series([10, 12, 9, 14, 8, 13, 7])
    swings = find_swings(candles, window=1)
    kinds = {s.kind for s in swings}
    assert "high" in kinds and "low" in kinds


def test_premium_discount_zones():
    assert premium_discount(90, 100, 0)["zone"] == "premium"
    assert premium_discount(10, 100, 0)["zone"] == "discount"
    assert premium_discount(50, 100, 0)["zone"] == "equilibrium"


def test_macro_bias_scoring():
    strong = macro_bias({"1M": BULLISH, "1w": BULLISH, "1d": BULLISH, "4h": BULLISH})
    assert strong["label"] == "Strong Bullish"
    assert strong["direction"] == BULLISH

    conflicted = macro_bias({"1M": BULLISH, "1w": BEARISH})
    assert conflicted["direction"] == NEUTRAL


def test_displacement_rank_flags_explosive_candle():
    base = [_c(i, 100, 101, 99, 100) for i in range(25)]
    base.append(_c(25, 100, 110, 100, 109.5))  # large bullish body, tiny opposing wick
    result = displacement_rank(base)
    assert result["present"] is True
    assert result["direction"] == BULLISH
    assert result["rank"] in {"Strong", "Violent", "Explosive"}


def test_find_fvgs_detects_bullish_gap():
    candles = [
        _c(0, 100, 101, 99, 100),
        _c(1, 101, 108, 101, 107),
        _c(2, 107, 110, 105, 109),  # candle3.low (105) > candle1.high (101) -> bullish FVG
    ]
    fvgs = find_fvgs(candles)
    assert any(f["direction"] == BULLISH for f in fvgs)


def test_session_state_killzone():
    ny = session_state(datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc))
    assert ny["session"] == "New York"
    assert ny["killzone"] == "New York Killzone"
    asia = session_state(datetime(2026, 1, 1, 2, 0, tzinfo=timezone.utc))
    assert asia["session"] == "Asia"
    assert asia["killzone"] == "Outside Killzone"


def _zigzag_uptrend(cycles: int = 8, up_bars: int = 4, down_bars: int = 3, step: float = 3.0) -> list[float]:
    prices = [100.0]
    for _ in range(cycles):
        for _ in range(up_bars):
            prices.append(prices[-1] + step)
        for _ in range(down_bars):
            prices.append(prices[-1] - step * 0.5)
    return prices


def test_analyze_symbol_returns_full_schema():
    uptrend = _series(_zigzag_uptrend())
    tf_candles = {
        "1d": uptrend,
        "4h": uptrend,
        "1h": uptrend,
        "15m": uptrend,
    }
    result = analyze_symbol("BTC/USDT", tf_candles, now=datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc))

    required = {
        "asset", "macro_bias", "weekly_bias", "daily_bias", "4h_bias",
        "market_structure", "current_session", "current_killzone", "po3_phase",
        "smt_signal", "mss", "choch", "liquidity_objective", "liquidity_map",
        "sweeps", "fvg", "order_blocks", "breaker_blocks", "mitigation_blocks",
        "crt_setup", "trade_grade", "probability_score", "trade_decision",
        "risk_notes", "reasoning",
    }
    assert required.issubset(result.keys())
    assert result["asset"] == "BTC/USDT"
    assert result["daily_bias"] == BULLISH
    assert set(result["crt_setup"].keys()) == {"type", "confidence", "entry", "stop", "target", "rr"}
    assert "unavailable" in result["smt_signal"]


def test_analyze_symbol_empty_is_safe():
    result = analyze_symbol("BTC/USDT", {}, now=datetime(2026, 1, 1, 13, 0, tzinfo=timezone.utc))
    assert result["asset"] == "BTC/USDT"
    assert result["trade_decision"] == "NO TRADE"
