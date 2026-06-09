import re

from tradebot.web.chart_image import THEME, build_chart_svg, build_session_chart_svg


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
    assert THEME["bear"] in svg or THEME["bull"] in svg
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
        rf'<rect x="([0-9.]+)" y="[0-9.]+" width="([0-9.]+)" height="[0-9.]+" fill="(?:{THEME["bull"]}|{THEME["bear"]})"',
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
    assert "FVG confluence" in svg
    assert "FVG supports long" in svg


def test_chart_svg_normalizes_framework_objective_object():
    candles = [
        {"t": i * 60_000, "o": 100, "h": 104 + (i % 3), "l": 97, "c": 101}
        for i in range(30)
    ]

    svg = build_chart_svg(
        candles,
        direction="bullish",
        role="trigger",
        framework={
            "liquidity_objective": {"direction": "bullish", "level": 110, "kind": "equal highs"},
            "liquidity_map": [{"level": 110, "side": "buy", "source": "Equal highs"}],
        },
        title="ETH/USDT · 1h",
    )

    assert "TARGETING EQH" in svg
    assert "{&#x27;direction&#x27;" not in svg


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


def test_far_framework_levels_do_not_squash_candles():
    candles = [
        {"t": i * 60_000, "o": 61_800, "h": 61_950, "l": 61_650, "c": 61_870}
        for i in range(30)
    ]

    svg = build_chart_svg(
        candles,
        direction="bullish",
        role="trigger",
        framework={
            # PWH/PML far away from price must be dropped, not squash the domain.
            "reference_levels": {"PWH": 89_000, "PML": 39_700, "PDH": 62_300, "PDL": 61_200},
            "liquidity_map": [
                {"level": 89_000, "side": "buy", "source": "PWH"},
                {"level": 62_100, "side": "buy", "source": "Equal highs"},
            ],
        },
        title="BTC/USDT · 15m",
    )

    assert "PWH" not in svg
    assert "PML" not in svg
    assert "PDH" in svg
    assert "PDL" in svg

    axis_prices = [
        float(value.replace(",", ""))
        for value in re.findall(r">([0-9][0-9,]{2,}\.[0-9]{2})<", svg)
    ]
    assert max(axis_prices) < 70_000
    assert min(axis_prices) > 55_000


def test_chart_draws_volume_histogram():
    candles = [
        {"t": i * 60_000, "o": 100, "h": 102, "l": 99, "c": 101, "v": 50 + i * 10}
        for i in range(20)
    ]
    svg = build_chart_svg(candles, role="trigger", title="BTC/USDT · 15m")
    assert 'opacity="0.28"' in svg

    no_volume = [
        {"t": i * 60_000, "o": 100, "h": 102, "l": 99, "c": 101}
        for i in range(20)
    ]
    svg_no_vol = build_chart_svg(no_volume, role="trigger", title="BTC/USDT · 15m")
    assert 'opacity="0.28"' not in svg_no_vol


def test_trigger_chart_marks_killzone_time_bands():
    # 15m candles spanning 06:00-16:00 UTC cross both London and NY killzones.
    start = 1_700_000_000_000 - (1_700_000_000_000 % 86_400_000) + 6 * 3_600_000
    candles = [
        {"t": start + i * 900_000, "o": 100, "h": 102, "l": 99, "c": 101}
        for i in range(40)
    ]
    svg = build_chart_svg(candles, role="trigger", title="EUR/USD · 15m")
    assert "LDN KZ" in svg
    assert "NY KZ" in svg

    # Context charts skip the bands.
    svg_context = build_chart_svg(candles, role="context", title="EUR/USD · 15m")
    assert "LDN KZ" not in svg_context


def test_taken_liquidity_pools_drop_text_tags():
    candles = [
        {"t": i * 60_000, "o": 61_800, "h": 61_950, "l": 61_650, "c": 61_870}
        for i in range(30)
    ]
    svg = build_chart_svg(
        candles,
        direction="bullish",
        role="trigger",
        framework={
            "liquidity_map": [
                # Buy-side pool below price = already swept (taken) -> no text tag.
                {"level": 61_700, "side": "buy", "source": "Equal highs", "strength": "Moderate"},
                # Buy-side pool above price = still resting (pending) -> tagged.
                {"level": 62_050, "side": "buy", "source": "Equal highs", "strength": "Moderate"},
            ],
        },
        title="BTC/USDT · 15m",
    )
    assert "EQH Moderate PENDING" in svg
    assert "EQH Moderate TAKEN" not in svg


def test_minimal_desk_chart_has_no_label_clutter():
    candles = [
        {"t": i * 900_000, "o": 61_800, "h": 61_950, "l": 61_650, "c": 61_870, "v": 100 + i}
        for i in range(30)
    ]
    svg = build_chart_svg(
        candles,
        direction="bullish",
        role="trigger",
        minimal=True,
        levels={"entry": 61_685, "stop": 61_490, "final_target": 63_562},
        framework={
            "dealing_range": {"high": 63_000, "low": 61_000, "eq": 62_000},
            "liquidity_map": [{"level": 62_050, "side": "buy", "source": "Equal highs", "strength": "Moderate"}],
            "reference_levels": {"PDH": 62_300, "PDL": 61_200},
            "crt": {"type": "Bullish CRT", "entry": 61_685, "stop": 61_490, "target": 63_562},
        },
        title="BTC/USDT · 15m",
    )
    assert "PREMIUM" not in svg
    assert "TARGETING" not in svg
    assert "EQH" not in svg
    assert "ENTRY ZONE" not in svg
    assert "NO TRADE" not in svg
    assert THEME["bull"] in svg or THEME["bear"] in svg


def test_build_chart_svg_empty_message():
    svg = build_chart_svg([], message="Baglanti hatasi")
    assert "Baglanti hatasi" in svg


def test_build_session_chart_svg_draws_session_boxes():
    candles = [
        {"t": i * 900_000, "o": 1.08, "h": 1.082, "l": 1.078, "c": 1.081}
        for i in range(40)
    ]
    projection = {
        "status": "bullish",
        "current_session": "London",
        "ranges": [
            {"key": "asia", "name": "Asia", "high": 1.085, "low": 1.078, "active": False},
            {"key": "london", "name": "London", "high": 1.087, "low": 1.080, "active": True},
        ],
        "expectations": [
            {"title": "Sweep", "text": "Wait for Asia low raid then reclaim."},
        ],
    }
    svg = build_session_chart_svg(candles, symbol="EUR/USD", projection=projection)

    assert "<svg" in svg
    assert "EUR/USD" in svg
    assert "Asia" in svg
    assert "London" in svg
    assert THEME["bg"] in svg
