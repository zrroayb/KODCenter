from __future__ import annotations

from io import BytesIO
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from tradebot.models import Alert, Candle


def build_alert_chart_png(alert: Alert, candles: list[Candle], *, limit: int = 120) -> bytes:
    rows = candles[-limit:]
    width, height = 1280, 720
    pad_l, pad_r, pad_t, pad_b = 54, 126, 48, 46
    image = Image.new("RGB", (width, height), "#d8dde6")
    draw = ImageDraw.Draw(image)
    font = _font(18)
    small = _font(14)
    tiny = _font(12)
    bold = _font(18, bold=True)

    title = f"{alert.symbol} · {alert.trigger_timeframe or alert.timeframe} · {alert.stage or 'alert'}"
    draw.text((16, 14), title, fill="#111827", font=bold)
    draw.rounded_rectangle((1190, 10, 1254, 38), radius=6, fill="#f8fafc")
    draw.text((1206, 17), "USDT", fill="#111827", font=small)

    if not rows:
        draw.text((width // 2 - 80, height // 2), "No chart data", fill="#111827", font=font)
        return _png_bytes(image)

    plan = alert.trade_plan or {}
    extra_prices = [
        _num(plan.get("entry")),
        _num(plan.get("stop")),
        _num(plan.get("tp1")),
        _num(plan.get("tp2")),
        _num(plan.get("final_target")),
        _num(plan.get("reference_level")),
        _num(plan.get("sweep_extreme")),
    ]
    prices = [c.high for c in rows] + [c.low for c in rows] + [p for p in extra_prices if p is not None]
    lo, hi = min(prices), max(prices)
    if hi <= lo:
        hi = lo + 1
    margin = (hi - lo) * 0.12
    lo -= margin
    hi += margin

    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    step = plot_w / max(1, len(rows) - 1)
    candle_w = max(3, min(10, step * 0.55))

    def x_at(i: int) -> float:
        return pad_l + i * step

    def y_at(price: float) -> float:
        return pad_t + (hi - price) / (hi - lo) * plot_h

    for i in range(6):
        y = pad_t + i * plot_h / 5
        draw.line((pad_l, y, width - pad_r, y), fill="#c8ced8", width=1)
        price = hi - i * (hi - lo) / 5
        draw.text((width - pad_r + 10, y - 8), _fmt(price), fill="#6b7280", font=tiny)

    for i, candle in enumerate(rows):
        x = x_at(i)
        up = candle.close >= candle.open
        color = "#4caf50" if up else "#111827"
        draw.line((x, y_at(candle.high), x, y_at(candle.low)), fill="#111827", width=2)
        top = y_at(max(candle.open, candle.close))
        bottom = y_at(min(candle.open, candle.close))
        if bottom - top < 2:
            bottom = top + 2
        draw.rectangle((x - candle_w / 2, top, x + candle_w / 2, bottom), fill=color, outline="#111827")

    signal_ts = (alert.trigger_candle or alert.candle).timestamp_ms
    signal_index = next((i for i, c in enumerate(rows) if c.timestamp_ms == signal_ts), len(rows) - 1)
    sx = x_at(signal_index)
    draw.rectangle((max(pad_l, sx - step * 1.1), pad_t, min(width - pad_r, sx + step * 1.1), height - pad_b), fill="#eef2f7")

    direction = alert.direction or ""
    bullish = direction == "bullish"
    trigger_mode = str(plan.get("trigger_mode") or "msb").lower()
    ref = _num(plan.get("msb_level")) or _num(plan.get("reference_level"))
    if ref is not None:
        if trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}:
            label = "Turtle Soup low" if bullish else "Turtle Soup high"
        elif trigger_mode == "model1":
            label = "Model #1 level"
        elif trigger_mode in {"fvg", "ifvg"}:
            label = "FVG confluence"
        else:
            label = "MSS high: wait close above" if bullish else "MSS low: wait close below"
        if alert.stage == "confirmed" and trigger_mode in {"mss", "msb"}:
            label = "MSS high broken" if bullish else "MSS low broken"
        _level(draw, y_at, width, pad_l, pad_r, ref, "#111827", label, font=tiny)

    for key, label, color in [
        ("entry", "Entry", "#15803d"),
        ("stop", "Stop", "#991b1b"),
        ("tp1", "TP1", "#2563eb"),
        ("tp2", "TP2", "#4f46e5"),
        ("final_target", "Final", "#7c3aed"),
    ]:
        value = _num(plan.get(key))
        if value is not None:
            _level(draw, y_at, width, pad_l, pad_r, value, color, label, font=tiny)

    sweep = _num(plan.get("sweep_extreme"))
    if sweep is not None:
        sy = y_at(sweep)
        draw.ellipse((sx - 7, sy - 7, sx + 7, sy + 7), outline="#ef4444", width=3)
        _callout(draw, sx + 26, sy - 20, "stop area", "#ef4444", tiny)

    status = _next_action(alert)
    _callout(draw, pad_l + 16, pad_t + 16, status, "#111827", small)
    if trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}:
        _callout(draw, pad_l + 16, pad_t + 52, "Trigger: wait Model #1 or MSS", "#334155", tiny)
    elif trigger_mode in {"fvg", "ifvg"}:
        _callout(draw, pad_l + 16, pad_t + 52, "FVG: confluence only", "#334155", tiny)
    elif trigger_mode in {"mss", "msb"}:
        _callout(draw, pad_l + 16, pad_t + 52, "Trigger: market structure shift", "#334155", tiny)
    elif trigger_mode == "model1":
        _callout(draw, pad_l + 16, pad_t + 52, "Trigger: Model #1", "#334155", tiny)

    return _png_bytes(image)


def _next_action(alert: Alert) -> str:
    if alert.stage == "forming":
        tf = alert.trigger_timeframe or alert.timeframe
        mode = str((alert.trade_plan or {}).get("trigger_mode") or "")
        if mode in {"model1_or_mss", "raid_msb_or_fvg"}:
            return f"Wait: {tf} Model #1/MSS"
        side = "above MSS high" if alert.direction == "bullish" else "below MSS low"
        return f"Wait: {tf} close {side}"
    if alert.stage == "confirmed":
        return "Confirmed: use plan levels, no auto order"
    if alert.stage == "invalidated":
        return "Invalidated: stand down"
    return "Watch setup"


def _level(draw: ImageDraw.ImageDraw, y_at, width: int, pad_l: int, pad_r: int, price: float, color: str, label: str, *, font) -> None:
    y = y_at(price)
    draw.line((pad_l, y, width - pad_r, y), fill=color, width=2)
    text = f"{label}  {_fmt(price)}"
    box_w = max(58, len(text) * 7 + 14)
    x1 = width - pad_r + 8
    draw.rounded_rectangle((x1, y - 13, x1 + box_w, y + 13), radius=4, fill=color)
    draw.text((x1 + 7, y - 8), text, fill="#ffffff", font=font)


def _callout(draw: ImageDraw.ImageDraw, x: float, y: float, text: str, color: str, font) -> None:
    box_w = max(70, len(text) * 7 + 18)
    draw.rounded_rectangle((x, y, x + box_w, y + 26), radius=5, fill=color)
    draw.text((x + 9, y + 7), text, fill="#ffffff", font=font)


def _png_bytes(image: Image.Image) -> bytes:
    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _font(size: int, *, bold: bool = False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt(value: float) -> str:
    if abs(value) >= 100:
        return f"{value:,.1f}"
    if abs(value) >= 1:
        return f"{value:,.4f}".rstrip("0").rstrip(".")
    return f"{value:.6f}".rstrip("0").rstrip(".")
