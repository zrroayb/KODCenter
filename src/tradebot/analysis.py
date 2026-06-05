"""Feed-free ICT / Romeo CRT / SMC analysis engine.

Produces a structured, multi-timeframe institutional read for a single symbol
using only its own OHLC candles (no intermarket / news feeds). Engines that
require external data (SMT divergence, correlation, economic calendar) are
intentionally reported as ``unavailable`` rather than fabricated.

The public entrypoint is :func:`analyze_symbol`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from tradebot.models import Candle

# Timeframes consumed by the engine, ordered high -> low.
# Macro bias is still weighted on 1M/1w/1d/4h. 1h is included for the UI's
# MTF structure read without changing the execution timeframe, which remains 15m.
ANALYSIS_TIMEFRAMES = ("1M", "1w", "1d", "4h", "1h", "15m")
HTF_BIAS_WEIGHTS = {"1M": 40, "1w": 30, "1d": 20, "4h": 10}

BULLISH = "bullish"
BEARISH = "bearish"
NEUTRAL = "neutral"


# --------------------------------------------------------------------------- #
# Primitives
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Swing:
    index: int
    price: float
    kind: str  # "high" | "low"
    timestamp_ms: int


def _avg(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def _fmt(value: float | None) -> str:
    if value is None:
        return ""
    abs_v = abs(value)
    if abs_v >= 1000:
        return f"{value:,.2f}"
    if abs_v >= 1:
        return f"{value:.2f}"
    return f"{value:.5f}".rstrip("0").rstrip(".")


def find_swings(candles: list[Candle], window: int = 2) -> list[Swing]:
    """Fractal swing points: a pivot high/low with ``window`` lower/higher bars on each side."""
    swings: list[Swing] = []
    n = len(candles)
    if n < window * 2 + 1:
        return swings
    for i in range(window, n - window):
        pivot = candles[i]
        left = candles[i - window:i]
        right = candles[i + 1:i + 1 + window]
        if all(pivot.high > c.high for c in left) and all(pivot.high >= c.high for c in right):
            swings.append(Swing(i, pivot.high, "high", pivot.timestamp_ms))
        if all(pivot.low < c.low for c in left) and all(pivot.low <= c.low for c in right):
            swings.append(Swing(i, pivot.low, "low", pivot.timestamp_ms))
    swings.sort(key=lambda s: s.index)
    return swings


# --------------------------------------------------------------------------- #
# Market structure
# --------------------------------------------------------------------------- #
def classify_structure(candles: list[Candle], swings: list[Swing]) -> dict[str, Any]:
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    last_label = ""
    trend = NEUTRAL

    if len(highs) >= 2 and len(lows) >= 2:
        hh = highs[-1].price > highs[-2].price
        hl = lows[-1].price > lows[-2].price
        lh = highs[-1].price < highs[-2].price
        ll = lows[-1].price < lows[-2].price
        if hh and hl:
            trend, last_label = BULLISH, "HH+HL"
        elif lh and ll:
            trend, last_label = BEARISH, "LH+LL"
        elif hh and ll:
            trend, last_label = NEUTRAL, "HH+LL (expansion)"
        else:
            trend, last_label = NEUTRAL, "compression"

    return {
        "trend": trend,
        "pattern": last_label,
        "swing_high": round(highs[-1].price, 6) if highs else None,
        "swing_low": round(lows[-1].price, 6) if lows else None,
        "prior_swing_high": round(highs[-2].price, 6) if len(highs) >= 2 else None,
        "prior_swing_low": round(lows[-2].price, 6) if len(lows) >= 2 else None,
    }


def premium_discount(price: float, high: float, low: float) -> dict[str, Any]:
    if high <= low:
        return {"zone": "equilibrium", "eq": round(price, 6), "position_pct": 50.0}
    eq = (high + low) / 2
    pct = (price - low) / (high - low) * 100
    if pct >= 55:
        zone = "premium"
    elif pct <= 45:
        zone = "discount"
    else:
        zone = "equilibrium"
    return {
        "zone": zone,
        "eq": round(eq, 6),
        "high": round(high, 6),
        "low": round(low, 6),
        "position_pct": round(pct, 1),
    }


def timeframe_bias(candles: list[Candle], window: int = 2) -> dict[str, Any]:
    if len(candles) < 5:
        return {"bias": NEUTRAL, "structure": {}, "pd": {}}
    swings = find_swings(candles, window)
    structure = classify_structure(candles, swings)
    high = max(c.high for c in candles[-60:])
    low = min(c.low for c in candles[-60:])
    pd = premium_discount(candles[-1].close, high, low)

    bias = structure["trend"]
    # In a range, lean on premium/discount location.
    if bias == NEUTRAL:
        if pd["zone"] == "discount":
            bias = BULLISH
        elif pd["zone"] == "premium":
            bias = BEARISH
    return {"bias": bias, "structure": structure, "pd": pd}


# --------------------------------------------------------------------------- #
# Macro bias
# --------------------------------------------------------------------------- #
def macro_bias(biases: dict[str, str]) -> dict[str, Any]:
    score = 0.0
    available = 0.0
    for tf, weight in HTF_BIAS_WEIGHTS.items():
        bias = biases.get(tf)
        if bias is None:
            continue
        available += weight
        if bias == BULLISH:
            score += weight
        elif bias == BEARISH:
            score -= weight
    normalized = (score / available * 100) if available else 0.0
    if normalized >= 60:
        label = "Strong Bullish"
    elif normalized >= 20:
        label = "Bullish"
    elif normalized > -20:
        label = "Neutral"
    elif normalized > -60:
        label = "Bearish"
    else:
        label = "Strong Bearish"
    direction = BULLISH if normalized >= 20 else BEARISH if normalized <= -20 else NEUTRAL
    return {"label": label, "score": round(normalized, 1), "direction": direction}


# --------------------------------------------------------------------------- #
# Dealing range / reference levels
# --------------------------------------------------------------------------- #
def _prev_extreme(candles: list[Candle] | None) -> tuple[float | None, float | None]:
    if not candles or len(candles) < 2:
        return None, None
    prev = candles[-2]
    return prev.high, prev.low


def dealing_ranges(tf_candles: dict[str, list[Candle]]) -> dict[str, Any]:
    pmh, pml = _prev_extreme(tf_candles.get("1M"))
    pwh, pwl = _prev_extreme(tf_candles.get("1w"))
    pdh, pdl = _prev_extreme(tf_candles.get("1d"))
    levels = {
        "PMH": pmh, "PML": pml,
        "PWH": pwh, "PWL": pwl,
        "PDH": pdh, "PDL": pdl,
    }
    return {k: (round(v, 6) if v is not None else None) for k, v in levels.items()}


# --------------------------------------------------------------------------- #
# Liquidity engine
# --------------------------------------------------------------------------- #
def _rank_from_touches(touches: int, age_bars: int) -> str:
    if touches >= 4:
        return "Extreme"
    if touches == 3:
        return "Strong"
    if touches == 2:
        return "Moderate"
    if age_bars >= 40:
        return "Weak"
    return "Very Weak"


def liquidity_map(
    candles: list[Candle],
    swings: list[Swing],
    reference_levels: dict[str, Any],
    tolerance_atr: float,
) -> list[dict[str, Any]]:
    pools: list[dict[str, Any]] = []
    n = len(candles)
    price = candles[-1].close if candles else 0.0

    # Equal / relative-equal highs and lows from swings.
    def add_equal(side_swings: list[Swing], side: str) -> None:
        used: set[int] = set()
        for i, base in enumerate(side_swings):
            if i in used:
                continue
            cluster = [base]
            for j in range(i + 1, len(side_swings)):
                if abs(side_swings[j].price - base.price) <= tolerance_atr:
                    cluster.append(side_swings[j])
                    used.add(j)
            touches = len(cluster)
            age = n - cluster[-1].index
            level = _avg(s.price for s in cluster)
            label = ("Equal" if touches >= 2 else "Swing") + (" highs" if side == "buy" else " lows")
            pools.append({
                "level": round(level, 6),
                "side": side,
                "source": label,
                "touches": touches,
                "strength": _rank_from_touches(touches, age),
                "distance_pct": round((level - price) / price * 100, 2) if price else 0.0,
            })

    add_equal([s for s in swings if s.kind == "high"], "buy")
    add_equal([s for s in swings if s.kind == "low"], "sell")

    # Reference levels (PDH/PDL/...) are resting liquidity by definition.
    ref_side = {"PMH": "buy", "PWH": "buy", "PDH": "buy", "PML": "sell", "PWL": "sell", "PDL": "sell"}
    ref_strength = {"PMH": "Extreme", "PML": "Extreme", "PWH": "Strong", "PWL": "Strong", "PDH": "Moderate", "PDL": "Moderate"}
    for name, side in ref_side.items():
        level = reference_levels.get(name)
        if level is None:
            continue
        pools.append({
            "level": round(level, 6),
            "side": side,
            "source": name,
            "touches": 1,
            "strength": ref_strength[name],
            "distance_pct": round((level - price) / price * 100, 2) if price else 0.0,
        })

    pools.sort(key=lambda p: abs(p["distance_pct"]))
    return pools


_STRENGTH_RANK = {"Very Weak": 0, "Weak": 1, "Moderate": 2, "Strong": 3, "Extreme": 4}


def likely_objective(pools: list[dict[str, Any]], direction: str, price: float) -> dict[str, Any] | None:
    if direction == BULLISH:
        candidates = [p for p in pools if p["side"] == "buy" and p["level"] > price]
    elif direction == BEARISH:
        candidates = [p for p in pools if p["side"] == "sell" and p["level"] < price]
    else:
        candidates = list(pools)
    if not candidates:
        return None
    candidates.sort(key=lambda p: (-_STRENGTH_RANK.get(p["strength"], 0), abs(p["distance_pct"])))
    best = candidates[0]
    return {"level": best["level"], "side": best["side"], "source": best["source"], "strength": best["strength"]}


# --------------------------------------------------------------------------- #
# Sweep / displacement / FVG / order block engines
# --------------------------------------------------------------------------- #
def detect_sweeps(candles: list[Candle], swings: list[Swing], lookback: int = 6) -> list[dict[str, Any]]:
    sweeps: list[dict[str, Any]] = []
    if len(candles) < 3:
        return sweeps
    recent = candles[-lookback:]
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    start_index = len(candles) - len(recent)
    for offset, candle in enumerate(recent):
        idx = start_index + offset
        for low in lows:
            if low.index < idx and candle.low < low.price and candle.close > low.price:
                sweeps.append({
                    "type": "bullish",
                    "level": round(low.price, 6),
                    "source": "sell-side liquidity",
                    "strength": "Strong" if (candle.close - candle.low) > (candle.high - candle.low) * 0.5 else "Moderate",
                    "time_ms": candle.timestamp_ms,
                })
                break
        for high in highs:
            if high.index < idx and candle.high > high.price and candle.close < high.price:
                sweeps.append({
                    "type": "bearish",
                    "level": round(high.price, 6),
                    "source": "buy-side liquidity",
                    "strength": "Strong" if (candle.high - candle.close) > (candle.high - candle.low) * 0.5 else "Moderate",
                    "time_ms": candle.timestamp_ms,
                })
                break
    return sweeps


def displacement_rank(candles: list[Candle]) -> dict[str, Any]:
    if len(candles) < 21:
        return {"present": False, "rank": "none", "direction": NEUTRAL}
    candle = candles[-1]
    rng = candle.high - candle.low
    if rng <= 0:
        return {"present": False, "rank": "none", "direction": NEUTRAL}
    body = abs(candle.close - candle.open)
    body_ratio = body / rng
    avg_range = _avg(c.high - c.low for c in candles[-21:-1])
    range_mult = rng / avg_range if avg_range else 0.0
    direction = BULLISH if candle.close > candle.open else BEARISH
    opposing_wick = (candle.high - candle.close) if direction == BULLISH else (candle.close - candle.low)
    opposing_ratio = opposing_wick / rng

    present = body_ratio >= 0.7 and range_mult >= 1.5 and opposing_ratio <= 0.25
    if not present:
        return {"present": False, "rank": "none", "direction": direction, "body_ratio": round(body_ratio, 2), "range_mult": round(range_mult, 2)}
    if range_mult >= 3.5:
        rank = "Explosive"
    elif range_mult >= 2.5:
        rank = "Violent"
    elif range_mult >= 2.0:
        rank = "Strong"
    else:
        rank = "Moderate"
    return {
        "present": True,
        "rank": rank,
        "direction": direction,
        "body_ratio": round(body_ratio, 2),
        "range_mult": round(range_mult, 2),
    }


def find_fvgs(candles: list[Candle], limit: int = 4) -> list[dict[str, Any]]:
    fvgs: list[dict[str, Any]] = []
    n = len(candles)
    if n < 3:
        return fvgs
    last_price = candles[-1].close
    for i in range(n - 1, 1, -1):
        c1, _c2, c3 = candles[i - 2], candles[i - 1], candles[i]
        if c1.high < c3.low:  # bullish gap
            low, high = c1.high, c3.low
            direction = BULLISH
        elif c1.low > c3.high:  # bearish gap
            low, high = c3.high, c1.low
            direction = BEARISH
        else:
            continue
        mid = (low + high) / 2
        mitigated = last_price <= high if direction == BULLISH else last_price >= low
        fvgs.append({
            "direction": direction,
            "low": round(low, 6),
            "high": round(high, 6),
            "midpoint": round(mid, 6),
            "freshness": "mitigated" if mitigated else "fresh",
            "age_bars": n - 1 - i,
        })
        if len(fvgs) >= limit:
            break
    return fvgs


def find_order_blocks(candles: list[Candle], limit: int = 3) -> list[dict[str, Any]]:
    obs: list[dict[str, Any]] = []
    n = len(candles)
    if n < 22:
        return obs
    avg_range = _avg(c.high - c.low for c in candles[-21:-1])
    for i in range(n - 1, 2, -1):
        candle = candles[i]
        rng = candle.high - candle.low
        if avg_range and rng < avg_range * 1.5:
            continue
        body_ratio = abs(candle.close - candle.open) / rng if rng else 0
        if body_ratio < 0.6:
            continue
        direction = BULLISH if candle.close > candle.open else BEARISH
        ob = None
        if direction == BULLISH:
            for j in range(i - 1, max(i - 4, -1), -1):
                if candles[j].close < candles[j].open:
                    ob = candles[j]
                    break
        else:
            for j in range(i - 1, max(i - 4, -1), -1):
                if candles[j].close > candles[j].open:
                    ob = candles[j]
                    break
        if ob is None:
            continue
        last_price = candles[-1].close
        if direction == BULLISH:
            mitigated = last_price <= ob.high
        else:
            mitigated = last_price >= ob.low
        obs.append({
            "direction": direction,
            "high": round(ob.high, 6),
            "low": round(ob.low, 6),
            "midpoint": round((ob.high + ob.low) / 2, 6),
            "freshness": "mitigated" if mitigated else "fresh",
            "validity": "valid",
        })
        if len(obs) >= limit:
            break
    return obs


def derive_breakers(order_blocks: list[dict[str, Any]], price: float) -> list[dict[str, Any]]:
    """An order block that price has closed fully through flips into a breaker."""
    breakers: list[dict[str, Any]] = []
    for ob in order_blocks:
        if ob["direction"] == BULLISH and price < ob["low"]:
            breakers.append({**ob, "type": "bearish breaker", "strength": "Moderate"})
        elif ob["direction"] == BEARISH and price > ob["high"]:
            breakers.append({**ob, "type": "bullish breaker", "strength": "Moderate"})
    return breakers


def derive_mitigation_blocks(order_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {**ob, "mitigation": "partial"}
        for ob in order_blocks
        if ob.get("freshness") == "mitigated"
    ]


# --------------------------------------------------------------------------- #
# MSS / CHOCH / PO3
# --------------------------------------------------------------------------- #
def detect_mss(candles: list[Candle], swings: list[Swing], sweeps: list[dict[str, Any]], displacement: dict[str, Any]) -> dict[str, Any]:
    if not swings or len(candles) < 5:
        return {"present": False, "direction": NEUTRAL, "rank": "none"}
    price = candles[-1].close
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    broke_high = highs and price > highs[-1].price
    broke_low = lows and price < lows[-1].price
    has_sweep = bool(sweeps)
    disp = displacement.get("present")

    if broke_high and not broke_low:
        direction = BULLISH
    elif broke_low and not broke_high:
        direction = BEARISH
    else:
        return {"present": False, "direction": NEUTRAL, "rank": "none"}

    if has_sweep and disp:
        rank = "Explosive" if displacement.get("rank") in {"Violent", "Explosive"} else "Strong"
    elif disp:
        rank = "Moderate"
    else:
        rank = "Weak"
    return {"present": True, "direction": direction, "rank": rank, "swept": has_sweep, "displaced": bool(disp)}


def detect_choch(candles: list[Candle], swings: list[Swing], structure: dict[str, Any]) -> dict[str, Any]:
    if len(swings) < 4 or len(candles) < 5:
        return {"present": False, "direction": NEUTRAL, "rank": "none"}
    price = candles[-1].close
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    trend = structure.get("trend")
    # CHOCH = first counter-trend break of the most recent opposing swing.
    if trend == BEARISH and highs and price > highs[-1].price:
        return {"present": True, "direction": BULLISH, "rank": "Moderate"}
    if trend == BULLISH and lows and price < lows[-1].price:
        return {"present": True, "direction": BEARISH, "rank": "Moderate"}
    return {"present": False, "direction": NEUTRAL, "rank": "none"}


def po3_phase(candles: list[Candle], sweeps: list[dict[str, Any]], displacement: dict[str, Any]) -> dict[str, Any]:
    if len(candles) < 21:
        return {"phase": "unknown"}
    recent = candles[-10:]
    rng = max(c.high for c in recent) - min(c.low for c in recent)
    avg_range = _avg(c.high - c.low for c in candles[-21:-1])
    compression = bool(avg_range) and rng < avg_range * 4

    if displacement.get("present"):
        return {"phase": "Distribution", "detail": "expansion / trend delivery"}
    if sweeps:
        return {"phase": "Manipulation", "detail": "liquidity sweep / stop hunt"}
    if compression:
        return {"phase": "Accumulation", "detail": "compression / consolidation"}
    return {"phase": "Manipulation", "detail": "ranging"}


# --------------------------------------------------------------------------- #
# Session / killzone
# --------------------------------------------------------------------------- #
def session_state(now: datetime | None = None) -> dict[str, str]:
    now = now or datetime.now(timezone.utc)
    minutes = now.hour * 60 + now.minute
    if 0 <= minutes < 7 * 60:
        session = "Asia"
    elif 7 * 60 <= minutes < 12 * 60:
        session = "London"
    elif 12 * 60 <= minutes < 20 * 60:
        session = "New York"
    else:
        session = "Sydney"

    if 7 * 60 <= minutes < 10 * 60:
        killzone = "London Killzone"
    elif 12 * 60 <= minutes < 15 * 60:
        killzone = "New York Killzone"
    elif 15 * 60 <= minutes < 17 * 60:
        killzone = "London Close"
    else:
        killzone = "Outside Killzone"
    return {"session": session, "killzone": killzone}


def in_killzone(killzone: str) -> bool:
    return killzone in {"London Killzone", "New York Killzone", "London Close"}


# --------------------------------------------------------------------------- #
# CRT setup
# --------------------------------------------------------------------------- #
def build_crt_setup(
    candles: list[Candle],
    direction: str,
    sweeps: list[dict[str, Any]],
    displacement: dict[str, Any],
    fvgs: list[dict[str, Any]],
    objective: dict[str, Any] | None,
) -> dict[str, Any]:
    empty = {"type": "", "confidence": 0, "entry": "", "stop": "", "target": "", "rr": ""}
    if direction not in (BULLISH, BEARISH) or len(candles) < 3:
        return empty

    matching_sweep = next((s for s in sweeps if s["type"] == direction), None)
    matching_fvg = next((f for f in fvgs if f["direction"] == direction and f["freshness"] == "fresh"), None)
    if matching_fvg is None:
        matching_fvg = next((f for f in fvgs if f["direction"] == direction), None)

    confidence = 0
    if matching_sweep:
        confidence += 35
    if displacement.get("present") and displacement.get("direction") == direction:
        confidence += 30
    if matching_fvg:
        confidence += 20
    if objective:
        confidence += 15

    price = candles[-1].close
    # Protective stop sits beyond the swept extreme, never tighter than a
    # fraction of recent range, so RR stays realistic.
    atr = _avg(c.high - c.low for c in candles[-20:]) or (price * 0.002)
    min_risk = atr * 0.75
    entry = matching_fvg["midpoint"] if matching_fvg else price
    if direction == BULLISH:
        raw_stop = matching_sweep["level"] if matching_sweep else min(c.low for c in candles[-5:])
        stop = min(raw_stop, entry) - atr * 0.25
        stop = min(stop, entry - min_risk)
        target = objective["level"] if objective else max(c.high for c in candles[-20:])
    else:
        raw_stop = matching_sweep["level"] if matching_sweep else max(c.high for c in candles[-5:])
        stop = max(raw_stop, entry) + atr * 0.25
        stop = max(stop, entry + min_risk)
        target = objective["level"] if objective else min(c.low for c in candles[-20:])

    risk = abs(entry - stop)
    reward = abs(target - entry)
    rr = round(reward / risk, 2) if risk else 0.0

    return {
        "type": f"{direction} CRT",
        "confidence": min(confidence, 100),
        "entry": _fmt(entry),
        "stop": _fmt(stop),
        "target": _fmt(target),
        "rr": f"{rr}" if rr else "",
    }


# --------------------------------------------------------------------------- #
# Grading
# --------------------------------------------------------------------------- #
def grade_setup(components: dict[str, float], available_max: float) -> dict[str, Any]:
    score = sum(components.values())
    pct = (score / available_max * 100) if available_max else 0.0
    if pct >= 95:
        grade = "S+"
    elif pct >= 90:
        grade = "S"
    elif pct >= 85:
        grade = "A+"
    elif pct >= 80:
        grade = "A"
    elif pct >= 75:
        grade = "B+"
    elif pct >= 70:
        grade = "B"
    else:
        grade = "NO TRADE"
    return {"grade": grade, "score": round(pct, 1)}


# --------------------------------------------------------------------------- #
# Main entrypoint
# --------------------------------------------------------------------------- #
def analyze_symbol(
    symbol: str,
    tf_candles: dict[str, list[Candle]],
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)

    biases: dict[str, dict[str, Any]] = {}
    for tf, candles in tf_candles.items():
        if candles:
            biases[tf] = timeframe_bias(candles)

    bias_labels = {tf: data["bias"] for tf, data in biases.items()}
    macro = macro_bias(bias_labels)

    # The execution timeframe (lowest available) drives liquidity/CRT detection.
    exec_tf = next((tf for tf in reversed(ANALYSIS_TIMEFRAMES) if tf_candles.get(tf)), None)
    exec_candles = tf_candles.get(exec_tf or "", [])

    refs = dealing_ranges(tf_candles)

    structure: dict[str, Any] = {}
    swings: list[Swing] = []
    pools: list[dict[str, Any]] = []
    sweeps: list[dict[str, Any]] = []
    displacement = {"present": False, "rank": "none", "direction": NEUTRAL}
    fvgs: list[dict[str, Any]] = []
    obs: list[dict[str, Any]] = []
    breakers: list[dict[str, Any]] = []
    mitigations: list[dict[str, Any]] = []
    mss = {"present": False, "direction": NEUTRAL, "rank": "none"}
    choch = {"present": False, "direction": NEUTRAL, "rank": "none"}
    po3 = {"phase": "unknown"}
    objective: dict[str, Any] | None = None

    price = exec_candles[-1].close if exec_candles else 0.0

    if exec_candles:
        swings = find_swings(exec_candles)
        structure = classify_structure(exec_candles, swings)
        atr_proxy = _avg(c.high - c.low for c in exec_candles[-20:])
        pools = liquidity_map(exec_candles, swings, refs, tolerance_atr=atr_proxy * 0.15)
        sweeps = detect_sweeps(exec_candles, swings)
        displacement = displacement_rank(exec_candles)
        fvgs = find_fvgs(exec_candles)
        obs = find_order_blocks(exec_candles)
        breakers = derive_breakers(obs, price)
        mitigations = derive_mitigation_blocks(obs)
        mss = detect_mss(exec_candles, swings, sweeps, displacement)
        choch = detect_choch(exec_candles, swings, structure)
        po3 = po3_phase(exec_candles, sweeps, displacement)
        objective = likely_objective(pools, macro["direction"], price)

    session = session_state(now)
    direction = macro["direction"]
    crt = build_crt_setup(exec_candles, direction, sweeps, displacement, fvgs, objective)

    # Grading (feed-free subset; SMT + News excluded and total renormalized).
    has_sweep_dir = any(s["type"] == direction for s in sweeps)
    components = {
        "monthly": HTF_BIAS_WEIGHTS["1M"] * 0.375 if bias_labels.get("1M") == direction and direction != NEUTRAL else 0,
        "weekly": 15 if bias_labels.get("1w") == direction and direction != NEUTRAL else 0,
        "daily": 15 if bias_labels.get("1d") == direction and direction != NEUTRAL else 0,
        "fourh": 10 if bias_labels.get("4h") == direction and direction != NEUTRAL else 0,
        "sweep": 10 if has_sweep_dir else 0,
        "displacement": 10 if displacement.get("present") and displacement.get("direction") == direction else 0,
        "mss": 5 if mss.get("present") and mss.get("direction") == direction else 0,
        "choch": 5 if choch.get("present") and choch.get("direction") == direction else 0,
        "killzone": 5 if in_killzone(session["killzone"]) else 0,
    }
    # Max available = 15+15+15+10+10+10+5+5+5 = 90 (SMT 10 + News 5 unavailable).
    available_max = 90
    grade = grade_setup(components, available_max)

    decision = "NO TRADE"
    if grade["grade"] != "NO TRADE" and crt.get("confidence", 0) >= 60 and direction != NEUTRAL:
        decision = f"{'LONG' if direction == BULLISH else 'SHORT'} — {grade['grade']}"

    risk_notes = [
        "Default risk 1% / max 2%; minimum RR 3.",
        "SMT divergence + correlation + news filters are UNAVAILABLE (no intermarket / calendar feed) and excluded from the grade.",
    ]
    if not in_killzone(session["killzone"]):
        risk_notes.append("Outside killzone — confidence reduced.")
    if direction == NEUTRAL:
        risk_notes.append("HTF macro bias is neutral — stand aside until a directional read forms.")

    reasoning = [
        f"Macro bias {macro['label']} (score {macro['score']}) from " + ", ".join(f"{tf}:{bias_labels[tf]}" for tf in HTF_BIAS_WEIGHTS if tf in bias_labels) + ".",
        f"Execution TF {exec_tf}: structure {structure.get('pattern') or 'n/a'} ({structure.get('trend', 'n/a')}).",
        f"PO3 phase: {po3.get('phase')} ({po3.get('detail', '')}).",
    ]
    if objective:
        reasoning.append(f"Most likely draw on liquidity: {objective['source']} @ {_fmt(objective['level'])} ({objective['strength']}).")
    if displacement.get("present"):
        reasoning.append(f"Displacement: {displacement['rank']} {displacement['direction']} (range x{displacement.get('range_mult')}).")

    timeframe_structure = {
        tf: {
            "bias": data.get("bias", NEUTRAL),
            "structure": data.get("structure", {}),
            "pd": data.get("pd", {}),
        }
        for tf, data in biases.items()
    }
    dealing_range = timeframe_structure.get(exec_tf or "", {}).get("pd", {}) if exec_tf else {}

    return {
        "asset": symbol,
        "macro_bias": macro["label"],
        "weekly_bias": bias_labels.get("1w", "unavailable"),
        "daily_bias": bias_labels.get("1d", "unavailable"),
        "4h_bias": bias_labels.get("4h", "unavailable"),
        "1h_bias": bias_labels.get("1h", "unavailable"),
        "15m_bias": bias_labels.get("15m", "unavailable"),
        "timeframes": timeframe_structure,
        "market_structure": structure.get("pattern") or structure.get("trend") or "n/a",
        "dealing_range": dealing_range,
        "reference_levels": refs,
        "current_session": session["session"],
        "current_killzone": session["killzone"],
        "po3_phase": po3.get("phase", "unknown"),
        "po3": po3,
        "smt_signal": "unavailable (no intermarket feed)",
        "mss": f"{mss['direction']} {mss['rank']}" if mss.get("present") else "none",
        "mss_detail": mss,
        "choch": f"{choch['direction']} {choch['rank']}" if choch.get("present") else "none",
        "choch_detail": choch,
        "liquidity_objective": f"{objective['source']} @ {_fmt(objective['level'])}" if objective else "none",
        "liquidity_map": pools[:10],
        "liquidity_ranking": pools[:10],
        "sweeps": sweeps,
        "latest_sweep": sweeps[-1] if sweeps else None,
        "displacement": displacement,
        "fvg": fvgs,
        "order_blocks": obs,
        "breaker_blocks": breakers,
        "mitigation_blocks": mitigations,
        "crt_setup": crt,
        "trade_grade": grade["grade"],
        "probability_score": f"{grade['score']}%",
        "trade_decision": decision,
        "risk_notes": risk_notes,
        "reasoning": reasoning,
        "meta": {
            "execution_timeframe": exec_tf,
            "timeframes_used": [tf for tf in ANALYSIS_TIMEFRAMES if tf_candles.get(tf)],
            "generated_at": now.isoformat(),
            "price": _fmt(price) if price else "",
        },
    }
