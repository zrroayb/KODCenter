import re

from tradebot.web.chart_image import build_chart_svg


def test_build_chart_svg_renders_candles_and_levels():
    candles = [
        {"t": 1_000, "o": 100, "h": 105, "l": 98, "c": 102},
        {"t": 2_000, "o": 102, "h": 108, "l": 101, "c": 104},
        {"t": 3_000, "o": 104, "h": 106, "l": 99, "c": 100},
    ]
    svg = build_chart_svg(
        candles,
        signal_at_ms=2_000,
        direction="bearish",
        role="trigger",
        levels={"entry": 103, "stop": 108, "tp1": 95},
        reference_level=106,
        sweep_extreme=109,
        wait_text="Confirmation needed: on 15m, price must take the prior 20-bar high and close back below it.",
        setup_label="WAITING: SHORT needs 20-bar high reclaim",
        title="BTC/USDT · 15m",
    )

    assert "<svg" in svg
    assert "BTC/USDT · 15m" in svg
    assert 'fill="#050505"' in svg or 'fill="#48b45e"' in svg
    assert "Entry" in svg
    assert "Invalid" in svg
    assert "reference level" in svg
    assert "wick / sweep extreme" in svg
    assert "WAITING: SHORT needs 20-bar high reclaim" in svg


def test_context_chart_only_shows_htf_objective():
    candles = [
        {"t": 1_000, "o": 100, "h": 105, "l": 98, "c": 102},
        {"t": 2_000, "o": 102, "h": 108, "l": 101, "c": 104},
        {"t": 3_000, "o": 104, "h": 106, "l": 99, "c": 100},
    ]
    svg = build_chart_svg(
        candles,
        signal_at_ms=2_000,
        direction="bullish",
        role="context",
        stage="forming",
        levels={"entry": 103, "stop": 96, "tp1": 110, "final_target": 120},
        htf_target=120,
        reference_level=101,
        sweep_extreme=99,
        wait_text="Next: wait for 5m low take + close back above.",
        setup_label="HTF CONTEXT: LONG target above",
        title="BTC/USDT · 1h",
    )

    assert "HTF draw" in svg
    assert "HTF CONTEXT: LONG target above" in svg
    assert "Next: wait for 5m low take + close back above." in svg
    assert "Entry" not in svg
    assert "Stop" not in svg
    assert "20-bar reference" not in svg
    assert "wick / sweep extreme" not in svg


def test_chart_svg_leaves_space_after_rightmost_bar():
    candles = [
        {"t": i * 60_000, "o": 100 + i, "h": 102 + i, "l": 99 + i, "c": 101 + i}
        for i in range(30)
    ]
    svg = build_chart_svg(candles, role="trigger", title="BTC/USDT · 1d")

    candle_rects = re.findall(
        r'<rect x="([0-9.]+)" y="[0-9.]+" width="([0-9.]+)" height="[0-9.]+" fill="(?:#48b45e|#050505)"',
        svg,
    )
    assert candle_rects
    rightmost_candle = max(float(x) + float(width) for x, width in candle_rects)
    price_axis_x = 1280 - 102
    assert price_axis_x - rightmost_candle > 120


def test_chart_focus_keeps_latest_bar_after_signal():
    candles = [
        {"t": i * 3_600_000, "o": 100 + i, "h": 102 + i, "l": 99 + i, "c": 101 + i}
        for i in range(140)
    ]
    svg = build_chart_svg(
        candles,
        signal_at_ms=70 * 3_600_000,
        role="context",
        direction="bullish",
        title="ETH/USDT · 1h",
    )

    assert "06.01 19:00" in svg
    assert "C 240.00" in svg


def test_trigger_chart_marks_taken_reference():
    candles = [
        {"t": i * 60_000, "o": 100, "h": 104, "l": 97 + (i % 3), "c": 101}
        for i in range(30)
    ]
    candles[8]["l"] = 95
    candles[20]["l"] = 93
    candles[20]["c"] = 96

    svg = build_chart_svg(
        candles,
        signal_at_ms=20 * 60_000,
        direction="bullish",
        role="trigger",
        reference_level=95,
        sweep_extreme=93,
        title="ETH/USDT · 5m",
    )

    assert "prior 20-bar low taken" in svg
    assert "wick took the low" in svg


def test_msb_trigger_chart_uses_structure_labels():
    candles = [
        {"t": i * 3_600_000, "o": 100, "h": 104 + (i % 3), "l": 97, "c": 101}
        for i in range(30)
    ]
    candles[8]["h"] = 108
    candles[20]["c"] = 109

    svg = build_chart_svg(
        candles,
        signal_at_ms=20 * 3_600_000,
        direction="bullish",
        role="trigger",
        stage="confirmed",
        reference_level=108,
        sweep_extreme=96,
        title="ETH/USDT · 1h",
        trigger_mode="msb",
        wait_text="Confirmation needed: 1h candle close above the MSB level",
        setup_label="CONFIRMED: LONG 1h MSB",
    )

    assert "CONFIRMED PLAN" in svg
    assert "MSB" in svg
    assert "MSB swing high" in svg
    assert "close above 108.00" in svg
    assert "20-bar reference" not in svg
    assert "wick took the low" not in svg


def test_chart_svg_draws_trigger_imbalance_and_precise_prices():
    candles = [
        {"t": i * 60_000, "o": 1.1600, "h": 1.1620, "l": 1.1580, "c": 1.1610}
        for i in range(30)
    ]
    candles[18] = {"t": 18 * 60_000, "o": 1.1610, "h": 1.1632, "l": 1.1608, "c": 1.1628}
    candles[20] = {"t": 20 * 60_000, "o": 1.1630, "h": 1.1660, "l": 1.1642, "c": 1.1655}

    svg = build_chart_svg(
        candles,
        signal_at_ms=20 * 60_000,
        direction="bullish",
        role="trigger",
        stage="confirmed",
        title="EUR/USDT · 15m",
        trigger_mode="fvg",
        zones=[
            {
                "low": 1.1632,
                "high": 1.1642,
                "kind": "fvg",
                "direction": "bullish",
                "role": "trigger_zone",
            }
        ],
    )

    assert "O 1.1600" in svg
    assert "trigger FVG" in svg
    assert "FVG break/hold up" in svg


def test_raid_forming_chart_draws_pending_msb_level():
    candles = [
        {"t": i * 3_600_000, "o": 100, "h": 104 + (i % 3), "l": 97, "c": 101}
        for i in range(30)
    ]
    candles[8]["h"] = 108
    candles[20]["l"] = 94
    candles[20]["c"] = 101

    svg = build_chart_svg(
        candles,
        signal_at_ms=20 * 3_600_000,
        direction="bullish",
        role="trigger",
        reference_level=95,
        sweep_extreme=94,
        msb_level=108,
        msb_at_ms=8 * 3_600_000,
        trigger_mode="raid_msb_or_fvg",
        title="ETH/USDT · 1h",
    )

    assert "sell-side liq taken" in svg
    assert "reclaim above" in svg
    assert "sweep / invalid" in svg
    assert "MSB swing high" in svg
    assert "MSB break above" in svg


def test_raid_chart_without_signal_time_still_marks_taken_liquidity():
    candles = [
        {"t": i * 3_600_000, "o": 100, "h": 104 + (i % 3), "l": 97, "c": 101}
        for i in range(30)
    ]
    candles[10]["l"] = 95
    candles[-1]["l"] = 94

    svg = build_chart_svg(
        candles,
        direction="bullish",
        role="trigger",
        reference_level=95,
        sweep_extreme=94,
        trigger_mode="raid_msb_or_fvg",
        title="ETH/USDT · 1h",
    )

    assert "sell-side liq taken" in svg
    assert "reclaim above" in svg


def test_context_chart_marks_htf_raid_candle():
    candles = [
        {"t": i * 86_400_000, "o": 100 + i, "h": 105 + i, "l": 98 + i, "c": 102 + i}
        for i in range(12)
    ]
    candles[8]["l"] = 92

    svg = build_chart_svg(
        candles,
        signal_at_ms=11 * 86_400_000,
        direction="bullish",
        role="context",
        title="ETH/USDT · 1d",
        htf_raid_at_ms=8 * 86_400_000,
        htf_raid_label="important daily candle",
        raid_level=94,
        raid_extreme=92,
    )

    assert "important daily candle" in svg


def test_build_chart_svg_empty_message():
    svg = build_chart_svg([], message="Baglanti hatasi")
    assert "Baglanti hatasi" in svg
