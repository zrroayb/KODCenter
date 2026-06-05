from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any


def build_chart_svg(
    candles: list[dict[str, Any]],
    *,
    width: int = 1280,
    height: int = 720,
    signal_at_ms: int | None = None,
    direction: str = "",
    levels: dict[str, float | None] | None = None,
    title: str = "",
    message: str = "No candle data",
    role: str = "",
    stage: str = "",
    reference_level: float | None = None,
    sweep_extreme: float | None = None,
    htf_target: float | None = None,
    msb_level: float | None = None,
    msb_at_ms: int | None = None,
    structure_stop: float | None = None,
    raid_level: float | None = None,
    raid_extreme: float | None = None,
    htf_raid_at_ms: int | None = None,
    htf_raid_label: str = "",
    zones: list[dict[str, Any]] | None = None,
    wait_text: str = "",
    setup_label: str = "",
    trigger_mode: str = "",
    decision_status: str = "",
    decision_label: str = "",
    decision_subtitle: str = "",
    checklist: list[dict[str, Any]] | None = None,
) -> str:
    if not candles:
        return _empty_svg(width, height, message)

    role = (role or "").lower()
    stage = (stage or "").lower()
    trigger_mode = _normalize_trigger_mode(trigger_mode)
    is_context = role == "context"
    clean_structure_mode = trigger_mode in {"raid_msb_or_fvg", "msb", "fvg", "ifvg"}
    visible = _focus_candles(candles, signal_at_ms, role=role)
    if not visible:
        return _empty_svg(width, height, "No candle data")

    levels = levels or {}
    entry = None if is_context else _to_float(levels.get("entry"))
    stop = None if is_context else _to_float(levels.get("stop"))
    tp1 = None if is_context else _to_float(levels.get("tp1"))
    tp2 = None if is_context else _to_float(levels.get("tp2"))
    final_target = None if is_context else _to_float(levels.get("final_target"))
    target = _to_float(htf_target) if is_context else _first_number(htf_target, final_target, tp2, tp1)
    reference_level = _to_float(reference_level)
    sweep_extreme = _to_float(sweep_extreme)
    htf_target = _to_float(htf_target)
    msb_level = _to_float(msb_level)
    structure_stop = _to_float(structure_stop)
    raid_level = _to_float(raid_level)
    raid_extreme = _to_float(raid_extreme)
    if trigger_mode == "msb" and msb_level is not None:
        reference_level = msb_level
    if trigger_mode == "msb" and structure_stop is not None:
        sweep_extreme = structure_stop
    zones = _normalise_zones(zones)
    if not zones and not is_context:
        zones = _auto_fvg_zones(visible, direction)
    checklist = checklist or []

    pad_l, pad_r, pad_t, pad_b = 18, 102, 56, 46
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    prices = [float(c["h"]) for c in visible] + [float(c["l"]) for c in visible]
    zone_prices = [price for zone in zones for price in (_to_float(zone.get("low")), _to_float(zone.get("high"))) if price is not None]
    extra_prices = (
        [htf_target, raid_level, raid_extreme]
        if is_context
        else [
            entry,
            stop,
            tp1,
            tp2,
            final_target,
            reference_level,
            sweep_extreme,
            msb_level,
            structure_stop,
            raid_level,
            raid_extreme,
            htf_target,
            *zone_prices,
        ]
    )
    prices.extend(value for value in extra_prices if value is not None)
    y_min = min(prices)
    y_max = max(prices)
    if y_max == y_min:
        y_max += 1
        y_min -= 1
    spread = y_max - y_min
    y_min -= spread * 0.12
    y_max += spread * 0.12

    right_empty_slots = 5.5 if role == "trigger" else 4.5 if role == "context" else 5.0
    slot = plot_w / max(len(visible) + right_empty_slots, 1)
    candle_w = max(4.0, min(17.0, slot * 0.58))
    signal_index = _signal_index(visible, signal_at_ms)

    def x_at(index: int) -> float:
        return pad_l + (index + 0.5) * slot

    def y_at(price: float) -> float:
        return pad_t + (1 - (price - y_min) / (y_max - y_min)) * plot_h

    body: list[str] = []
    body.append(f'<rect width="{width}" height="{height}" fill="#cfd3dc"/>')
    body.append(f'<rect x="0" y="0" width="{width}" height="36" fill="#d8dce4"/>')
    body.append(f'<rect x="{width - pad_r}" y="36" width="{pad_r}" height="{height - 36}" fill="#c6cbd5" opacity="0.62"/>')

    last = visible[-1]
    header = _chart_header(title, last, stage, role)
    body.append(
        f'<text x="{pad_l}" y="24" fill="#1f232b" font-family="Inter,system-ui,sans-serif" '
        f'font-size="15" font-weight="700">{html.escape(header)}</text>'
    )
    body.append(
        f'<rect x="{width - 82}" y="8" width="58" height="24" rx="6" fill="#ffffff" opacity="0.9"/>'
        f'<text x="{width - 53}" y="25" fill="#111827" text-anchor="middle" '
        f'font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="700">USDT</text>'
    )

    if signal_index is not None:
        sx = x_at(signal_index)
        body.append(
            f'<rect x="{sx - slot * 0.55:.2f}" y="{pad_t}" width="{slot * 1.1:.2f}" height="{plot_h}" '
            f'fill="#ffffff" opacity="0.16"/>'
        )
        body.append(
            f'<rect x="{max(pad_l, sx + slot * 0.52):.2f}" y="{pad_t}" '
            f'width="{max(0, width - pad_r - sx - slot * 0.52):.2f}" height="{plot_h}" '
            f'fill="#a9b0bb" opacity="0.22"/>'
        )

    _draw_grid(body, visible, x_at, y_at, y_min, y_max, pad_l, pad_t, pad_r, pad_b, plot_w, plot_h, width, height)
    _draw_key_liquidity_levels(body, visible, x_at, y_at, pad_l, pad_r, width, htf_target=htf_target)
    if not is_context:
        _draw_trade_boxes(body, x_at, y_at, signal_index, len(visible), pad_l, pad_r, width, entry, stop, target)
        _draw_zones(body, visible, x_at, y_at, zones, signal_index, slot, pad_l, pad_r, width)
        _draw_raid_footprint(
            body,
            visible,
            x_at,
            y_at,
            signal_index,
            direction=direction,
            raid_level=raid_level,
            raid_extreme=raid_extreme,
            active_reference=reference_level,
            compact=clean_structure_mode,
            pad_l=pad_l,
            pad_r=pad_r,
            width=width,
        )
        if trigger_mode == "raid_msb_or_fvg" and msb_level is not None:
            _draw_pending_msb_level(
                body,
                visible,
                x_at,
                y_at,
                signal_index,
                direction=direction,
                msb_level=msb_level,
                msb_at_ms=msb_at_ms,
                pad_l=pad_l,
                pad_r=pad_r,
                width=width,
            )
    elif htf_raid_at_ms is not None:
        _draw_htf_raid_candle(
            body,
            visible,
            x_at,
            y_at,
            signal_index,
            htf_raid_at_ms=htf_raid_at_ms,
            raid_level=raid_level,
            raid_extreme=raid_extreme,
            htf_raid_label=htf_raid_label,
            direction=direction,
            pad_l=pad_l,
            pad_r=pad_r,
            width=width,
        )
    _draw_ema(body, visible, x_at, y_at, 9, "#a445b6")
    _draw_ema(body, visible, x_at, y_at, 20, "#3d55ff")
    _draw_candles(body, visible, x_at, y_at, candle_w, signal_index)

    if not is_context:
        if trigger_mode == "raid_msb_or_fvg":
            _draw_level(body, y_at, width, pad_l, pad_r, reference_level, "HTF raid level", "#7f1d1d", dash="8 5", label_side="left")
            _draw_level(body, y_at, width, pad_l, pad_r, sweep_extreme, "raid extreme", "#ef4444", dash="5 4", label_side="left")
        else:
            _draw_taken_reference(
                body,
                visible,
                x_at,
                y_at,
                signal_index,
                direction=direction,
                reference_level=reference_level,
                sweep_extreme=sweep_extreme,
                pad_l=pad_l,
                pad_r=pad_r,
                width=width,
                trigger_mode=trigger_mode,
                msb_at_ms=msb_at_ms,
            )
            if not clean_structure_mode:
                _draw_level(
                    body,
                    y_at,
                    width,
                    pad_l,
                    pad_r,
                    reference_level,
                    _reference_label(trigger_mode),
                    "#111827",
                    dash="",
                    label_side="left",
                )
                _draw_level(
                    body,
                    y_at,
                    width,
                    pad_l,
                    pad_r,
                    sweep_extreme,
                    "structure stop" if trigger_mode == "msb" else "wick / sweep extreme",
                    "#ef4444",
                    dash="5 4",
                    label_side="left",
                )

    level_styles = [
        ("entry", entry, "Entry", "#16a34a", ""),
        ("stop", stop, "Invalid", "#111827", ""),
        ("tp1", tp1, "TP1", "#2563eb", "6 4"),
        ("tp2", tp2, "TP2", "#4f46e5", "6 4"),
        ("final_target", final_target, "Final draw", "#7c3aed", "4 3"),
    ]
    if not is_context:
        for _, price, label, color, dash in level_styles:
            _draw_level(body, y_at, width, pad_l, pad_r, price, label, color, dash=dash, label_side="right")

    if htf_target is not None and (is_context or htf_target not in {final_target, tp2, tp1}):
        _draw_level(body, y_at, width, pad_l, pad_r, htf_target, "HTF draw", "#7c3aed", dash="4 3", label_side="right")

    if is_context:
        _draw_context_liquidity_map(
            body,
            visible,
            x_at,
            y_at,
            direction=direction,
            htf_target=htf_target,
            pad_l=pad_l,
            pad_r=pad_r,
            width=width,
        )

    _draw_current_price(body, y_at, width, pad_l, pad_r, float(last["c"]))
    _draw_decision_panel(
        body,
        decision_status=decision_status or stage,
        decision_label=decision_label,
        decision_subtitle=decision_subtitle,
        checklist=checklist,
        direction=direction,
        pad_l=pad_l,
        pad_t=pad_t,
        width=width,
        pad_r=pad_r,
    )
    if is_context:
        _draw_context_annotation(
            body,
            y_at,
            direction=direction,
            stage=stage,
            htf_target=htf_target,
            wait_text=wait_text,
            setup_label=setup_label,
            pad_t=pad_t,
            pad_l=pad_l,
            pad_r=pad_r,
            width=width,
        )
    else:
        _draw_signal_annotation(
            body,
            visible,
            x_at,
            y_at,
            signal_index,
            direction=direction,
            stage=stage,
            reference_level=reference_level,
            sweep_extreme=sweep_extreme,
            wait_text=wait_text,
            setup_label=setup_label,
            trigger_mode=trigger_mode,
            pad_t=pad_t,
            pad_l=pad_l,
            pad_r=pad_r,
            width=width,
        )
        if not decision_label:
            _draw_trigger_panel(
                body,
                direction=direction,
                stage=stage,
                trigger_mode=trigger_mode,
                msb_level=msb_level,
                zones=zones,
                reference_level=reference_level,
                sweep_extreme=sweep_extreme,
                wait_text=wait_text,
                pad_l=pad_l,
                pad_t=pad_t,
            )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="geometricPrecision" '
        f'text-rendering="geometricPrecision">{"".join(body)}</svg>'
    )


def _draw_grid(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    y_min: float,
    y_max: float,
    pad_l: float,
    pad_t: float,
    pad_r: float,
    pad_b: float,
    plot_w: float,
    plot_h: float,
    width: int,
    height: int,
) -> None:
    body.append(
        f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" height="{plot_h}" '
        f'fill="#d2d6df" stroke="#b6bdc9" stroke-width="1"/>'
    )
    for i in range(7):
        gy = pad_t + (i / 6) * plot_h
        price = y_max - (i / 6) * (y_max - y_min)
        body.append(
            f'<line x1="{pad_l}" y1="{gy:.2f}" x2="{width - pad_r}" y2="{gy:.2f}" '
            f'stroke="#c2c8d2" stroke-width="1"/>'
        )
        body.append(
            f'<text x="{width - pad_r + 12}" y="{gy + 4:.2f}" fill="#7b8290" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="12">{_fmt_price(price)}</text>'
        )

    count = len(candles)
    indices = sorted({0, count // 5, (2 * count) // 5, (3 * count) // 5, (4 * count) // 5, count - 1})
    for index in indices:
        if index >= count:
            continue
        x = x_at(index)
        body.append(
            f'<line x1="{x:.2f}" y1="{pad_t}" x2="{x:.2f}" y2="{height - pad_b}" '
            f'stroke="#c8cdd6" stroke-width="1"/>'
        )
        body.append(
            f'<text x="{x:.2f}" y="{height - 18}" fill="#8b929e" text-anchor="middle" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="11">{_fmt_time(int(candles[index]["t"]))}</text>'
        )


def _draw_key_liquidity_levels(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    pad_l: float,
    pad_r: float,
    width: int,
    *,
    htf_target: float | None,
) -> None:
    if len(candles) < 8:
        return
    window_start = max(0, len(candles) - 56)
    window = candles[window_start:]
    high_offset, high_candle = max(enumerate(window), key=lambda item: float(item[1]["h"]))
    low_offset, low_candle = min(enumerate(window), key=lambda item: float(item[1]["l"]))
    levels = [
        (window_start + high_offset, float(high_candle["h"]), "Buy-side liquidity", "#7c3aed"),
        (window_start + low_offset, float(low_candle["l"]), "Sell-side liquidity", "#7c3aed"),
    ]
    for index, price, label, color in levels:
        if htf_target is not None and abs(price - htf_target) <= max(abs(price) * 0.0001, 1e-9):
            continue
        y = y_at(price)
        x1 = max(pad_l, x_at(index))
        x2 = width - pad_r
        body.append(
            f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
            f'stroke="{color}" stroke-width="1.35" stroke-dasharray="8 6" opacity="0.54"/>'
        )
        body.append(f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="4" fill="#f8fafc" stroke="{color}" stroke-width="1.4"/>')
        _draw_inline_tag(body, min(width - pad_r - 12, x1 + 10), y - 16, label, color)


def _draw_candles(body: list[str], candles: list[dict[str, Any]], x_at, y_at, candle_w: float, signal_index: int | None) -> None:
    for index, candle in enumerate(candles):
        o, h, l, c = float(candle["o"]), float(candle["h"]), float(candle["l"]), float(candle["c"])
        x = x_at(index)
        up = c >= o
        color = "#48b45e" if up else "#050505"
        is_signal = signal_index is not None and index == signal_index
        body.append(
            f'<line x1="{x:.2f}" y1="{y_at(h):.2f}" x2="{x:.2f}" y2="{y_at(l):.2f}" '
            f'stroke="#101010" stroke-width="{2.0 if is_signal else 1.35}" stroke-linecap="round"/>'
        )
        top = y_at(max(o, c))
        bottom = y_at(min(o, c))
        body_h = max(2.0, bottom - top)
        body.append(
            f'<rect x="{x - candle_w / 2:.2f}" y="{top:.2f}" width="{candle_w:.2f}" '
            f'height="{body_h:.2f}" fill="{color}" stroke="#0b0b0b" stroke-width="{1.2 if is_signal else 0.8}"/>'
        )


def _draw_trade_boxes(
    body: list[str],
    x_at,
    y_at,
    signal_index: int | None,
    count: int,
    pad_l: float,
    pad_r: float,
    width: int,
    entry: float | None,
    stop: float | None,
    target: float | None,
) -> None:
    if entry is None:
        return
    start_index = signal_index if signal_index is not None else max(0, count - 10)
    x1 = min(width - pad_r - 180, max(pad_l + 120, x_at(start_index) + 12))
    x2 = width - pad_r - 18
    if x2 <= x1:
        return

    if target is not None:
        top = min(y_at(entry), y_at(target))
        height = abs(y_at(entry) - y_at(target))
        if height >= 3:
            body.append(
                f'<rect x="{x1:.2f}" y="{top:.2f}" width="{x2 - x1:.2f}" height="{height:.2f}" '
                f'fill="#6b7280" opacity="0.18" stroke="#111827" stroke-width="1" stroke-opacity="0.18"/>'
            )
            _draw_callout(body, (x1 + x2) / 2, top - 12, _target_label(entry, target, stop), "#6b7280", "#ffffff")

    if stop is not None:
        top = min(y_at(entry), y_at(stop))
        height = abs(y_at(entry) - y_at(stop))
        if height >= 3:
            body.append(
                f'<rect x="{x1:.2f}" y="{top:.2f}" width="{x2 - x1:.2f}" height="{height:.2f}" '
                f'fill="#111827" opacity="0.16" stroke="#111827" stroke-width="1" stroke-opacity="0.22"/>'
            )
            _draw_callout(body, (x1 + x2) / 2, top + height + 24, _stop_label(entry, stop), "#050505", "#ffffff")


def _draw_zones(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    zones: list[dict[str, Any]],
    signal_index: int | None,
    slot: float,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    if not zones:
        return
    for zone_order, zone in enumerate(zones):
        low = _to_float(zone.get("low"))
        high = _to_float(zone.get("high"))
        if low is None or high is None:
            continue
        bottom_price, top_price = min(low, high), max(low, high)
        zone_index = _find_zone_index(candles, bottom_price, top_price)
        if zone_index is None:
            zone_index = max(0, (signal_index if signal_index is not None else len(candles) - 1) - 2)
        x1 = max(pad_l, x_at(zone_index) - slot * 0.5)
        x2 = width - pad_r - 10
        y1 = y_at(top_price)
        y2 = y_at(bottom_price)
        height = max(3, y2 - y1)
        role = str(zone.get("role") or "")
        kind = str(zone.get("kind") or "fvg").upper()
        direction = str(zone.get("direction") or "")
        bullish = direction == "bullish"
        color = "#16a34a" if bullish else "#dc2626" if direction == "bearish" else "#7c3aed"
        if "ifvg" in kind.lower() or "ifvg" in role:
            color = "#d97706"
        opacity = "0.18" if role == "trigger_zone" else "0.11"
        label = _zone_label(zone)
        body.append(
            f'<rect x="{x1:.2f}" y="{y1:.2f}" width="{max(0, x2 - x1):.2f}" height="{height:.2f}" '
            f'fill="{color}" opacity="{opacity}" stroke="{color}" stroke-width="1.2" stroke-dasharray="5 4"/>'
        )
        if role != "opposing_zone":
            label_y = y1 + min(max(16 + zone_order * 18, 16), max(18, height - 6))
            _draw_inline_tag(body, width - pad_r - 12, label_y, label, color, anchor="end")


def _draw_pending_msb_level(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    signal_index: int | None,
    *,
    direction: str,
    msb_level: float,
    msb_at_ms: int | None,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    bullish = direction == "bullish"
    field = "h" if bullish else "l"
    ref_index = _timestamp_index(candles, msb_at_ms) if msb_at_ms is not None else None
    end_index = signal_index if signal_index is not None else len(candles) - 1
    if ref_index is None:
        ref_index = _find_reference_index(candles, msb_level, field, end_index)
    if ref_index is None:
        ref_index = max(0, end_index - 18)

    y = y_at(msb_level)
    x1 = max(pad_l, x_at(ref_index))
    x2 = width - pad_r
    color = "#2563eb"
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="2.2" stroke-dasharray="10 5" opacity="0.95"/>'
    )
    body.append(
        f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="5" fill="#ffffff" stroke="{color}" stroke-width="1.8"/>'
    )
    origin_label = "MSB swing high" if bullish else "MSB swing low"
    close_label = "need close above" if bullish else "need close below"
    _draw_inline_tag(body, min(width - pad_r - 140, max(pad_l + 118, x1 + 82)), y - 24 if bullish else y + 24, origin_label, "#1e3a8a")
    _draw_inline_tag(body, width - pad_r - 12, y + 20 if bullish else y - 18, f"MSB to break: {close_label}", color, anchor="end")


def _draw_raid_footprint(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    signal_index: int | None,
    *,
    direction: str,
    raid_level: float | None,
    raid_extreme: float | None,
    active_reference: float | None,
    compact: bool,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    if raid_level is None or not candles:
        return
    if active_reference is not None and abs(active_reference - raid_level) <= max(abs(raid_level) * 0.00005, 1e-9):
        return
    bullish = direction == "bullish"
    field = "l" if bullish else "h"
    end_index = signal_index if signal_index is not None else len(candles) - 1
    ref_index = _find_raid_index(candles, raid_level, field, end_index, bullish)
    if ref_index is None:
        ref_index = max(0, end_index - 12)
    x1 = max(pad_l, x_at(ref_index))
    x2 = min(width - pad_r, x_at(end_index))
    y = y_at(raid_level)
    color = "#7f1d1d"
    label = "HTF raid low" if bullish else "HTF raid high"
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="1.8" stroke-dasharray="8 5" opacity="0.9"/>'
    )
    body.append(f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="4" fill="#ffffff" stroke="{color}" stroke-width="1.5"/>')
    if compact:
        _draw_inline_tag(body, min(width - pad_r - 90, x1 + 8), y + (18 if bullish else -18), "HTF raid", color)
    else:
        _draw_callout(body, min(width - pad_r - 140, max(pad_l + 140, (x1 + x2) / 2)), y + (30 if bullish else -24), label, color, "#ffffff")
    if raid_extreme is not None:
        sy = y_at(raid_extreme)
        body.append(
            f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x1:.2f}" y2="{sy:.2f}" '
            f'stroke="#ef4444" stroke-width="1.8" stroke-dasharray="3 3"/>'
        )


def _draw_htf_raid_candle(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    signal_index: int | None,
    *,
    htf_raid_at_ms: int,
    raid_level: float | None,
    raid_extreme: float | None,
    htf_raid_label: str,
    direction: str,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    index = _timestamp_index(candles, htf_raid_at_ms)
    if index is None:
        return
    candle = candles[index]
    x = x_at(index)
    y_high = y_at(float(candle["h"]))
    y_low = y_at(float(candle["l"]))
    body.append(
        f'<rect x="{x - 12:.2f}" y="{y_high - 8:.2f}" width="24" height="{max(16, y_low - y_high + 16):.2f}" '
        f'rx="4" fill="none" stroke="#b91c1c" stroke-width="2.2" stroke-dasharray="5 4"/>'
    )
    label = htf_raid_label or ("daily raid candle" if direction else "HTF raid candle")
    _draw_callout(body, min(width - pad_r - 150, max(pad_l + 150, x + 110)), y_high - 18, label, "#7f1d1d", "#ffffff")
    if raid_level is not None:
        y = y_at(raid_level)
        body.append(
            f'<line x1="{max(pad_l, x - 60):.2f}" y1="{y:.2f}" x2="{min(width - pad_r, x + 150):.2f}" y2="{y:.2f}" '
            f'stroke="#7f1d1d" stroke-width="1.6" stroke-dasharray="7 4"/>'
        )
    if raid_extreme is not None:
        sy = y_at(raid_extreme)
        body.append(f'<circle cx="{x:.2f}" cy="{sy:.2f}" r="5" fill="none" stroke="#ef4444" stroke-width="2"/>')


def _draw_level(
    body: list[str],
    y_at,
    width: int,
    pad_l: float,
    pad_r: float,
    price: float | None,
    label: str,
    color: str,
    *,
    dash: str = "",
    label_side: str = "right",
) -> None:
    if price is None:
        return
    y = y_at(price)
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    body.append(
        f'<line x1="{pad_l}" y1="{y:.2f}" x2="{width - pad_r}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="1.35"{dash_attr} opacity="0.98"/>'
    )
    price_label = _fmt_price(price)
    body.append(
        f'<rect x="{width - pad_r + 3}" y="{y - 13:.2f}" width="{pad_r - 8}" height="24" rx="3" fill="{color}" opacity="0.92"/>'
        f'<text x="{width - 8}" y="{y + 4:.2f}" fill="#ffffff" text-anchor="end" '
        f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="12" font-weight="700">{price_label}</text>'
    )
    if label_side == "left":
        text_w = max(98, len(label) * 6.2 + 18)
        body.append(
            f'<rect x="{pad_l + 8}" y="{y - 20:.2f}" width="{text_w:.2f}" height="20" rx="4" fill="#ffffff" opacity="0.72"/>'
            f'<text x="{pad_l + 17}" y="{y - 6:.2f}" fill="{color}" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">{html.escape(label)}</text>'
        )
    else:
        text_w = max(54, len(label) * 6.2 + 16)
        body.append(
            f'<rect x="{width - pad_r - text_w - 8:.2f}" y="{y - 21:.2f}" width="{text_w:.2f}" height="20" rx="4" fill="#ffffff" opacity="0.78"/>'
            f'<text x="{width - pad_r - text_w:.2f}" y="{y - 7:.2f}" fill="{color}" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">{html.escape(label)}</text>'
        )


def _draw_taken_reference(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    signal_index: int | None,
    *,
    direction: str,
    reference_level: float | None,
    sweep_extreme: float | None,
    pad_l: float,
    pad_r: float,
    width: int,
    trigger_mode: str = "",
    msb_at_ms: int | None = None,
) -> None:
    if reference_level is None or signal_index is None or not candles:
        return
    signal_index = max(0, min(signal_index, len(candles) - 1))
    bullish = direction == "bullish"
    is_msb = trigger_mode == "msb"
    is_raid = trigger_mode == "raid_msb_or_fvg"
    is_fvg_trigger = trigger_mode in {"fvg", "ifvg"}
    field = "h" if bullish and is_msb else "l" if bullish else "l" if is_msb else "h"
    ref_index = _timestamp_index(candles, msb_at_ms) if is_msb and msb_at_ms is not None else None
    if ref_index is None:
        ref_index = _find_reference_index(candles, reference_level, field, signal_index)
    if ref_index is None:
        ref_index = max(0, signal_index - 20)

    y = y_at(reference_level)
    x1 = max(pad_l, x_at(ref_index))
    x2 = min(width - pad_r, x_at(signal_index))
    color = "#111827"
    if is_msb:
        color = "#2563eb"
    elif is_fvg_trigger:
        color = "#d97706"
    elif is_raid:
        color = "#7f1d1d"
    if is_raid:
        label = "HTF low raid" if bullish else "HTF high raid"
    elif is_fvg_trigger:
        label = "FVG/iFVG trigger"
    elif is_msb:
        label = "MSB break level"
    else:
        label = "prior 20-bar low taken" if bullish else "prior 20-bar high taken"
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="2.1" opacity="0.95"/>'
    )
    body.append(
        f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="4" fill="#ffffff" stroke="{color}" stroke-width="1.6"/>'
        f'<circle cx="{x2:.2f}" cy="{y:.2f}" r="4" fill="{color}"/>'
    )
    if is_msb:
        origin_label = "MSB swing high" if bullish else "MSB swing low"
        _draw_inline_tag(body, min(width - pad_r - 110, x1 + 8), y + (22 if bullish else -18), origin_label, "#1e3a8a")
    elif is_fvg_trigger:
        _draw_inline_tag(body, width - pad_r - 12, y - 18 if bullish else y + 20, label, color, anchor="end")
    elif not is_raid:
        label_x = min(width - pad_r - 170, max(pad_l + 170, (x1 + x2) / 2))
        label_y = y - 24 if bullish else y + 30
        _draw_callout(body, label_x, label_y, label, color, "#ffffff")

    if sweep_extreme is not None:
        sy = y_at(sweep_extreme)
        wick_label = "raid extreme" if (is_msb or is_raid or is_fvg_trigger) else "wick took the low" if bullish else "wick took the high"
        body.append(
            f'<line x1="{x2:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{sy:.2f}" '
            f'stroke="#ef4444" stroke-width="2" stroke-dasharray="4 3"/>'
        )
        if not (is_msb or is_raid or is_fvg_trigger):
            _draw_callout(body, min(width - pad_r - 140, max(pad_l + 140, x2 + 92)), sy, wick_label, "#ef4444", "#ffffff")


def _draw_context_liquidity_map(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    *,
    direction: str,
    htf_target: float | None,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    if len(candles) < 8:
        return
    bullish = direction == "bullish"
    field = "h" if bullish else "l"
    label = "recent high taken" if bullish else "recent low taken"
    color = "#7c3aed" if htf_target is not None else "#111827"
    taken = _find_recent_taken_level(candles, field)
    if taken is None:
        return
    ref_index, take_index, price = taken
    x1 = max(pad_l, x_at(ref_index))
    x2 = min(width - pad_r, x_at(take_index))
    y = y_at(price)
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="1.9" stroke-dasharray="7 4" opacity="0.9"/>'
    )
    body.append(
        f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="3.5" fill="#ffffff" stroke="{color}" stroke-width="1.4"/>'
        f'<circle cx="{x2:.2f}" cy="{y:.2f}" r="3.5" fill="{color}"/>'
    )
    label_x = min(width - pad_r - 150, max(pad_l + 150, (x1 + x2) / 2))
    _draw_callout(body, label_x, y - 24 if bullish else y + 30, label, color, "#ffffff")


def _draw_current_price(body: list[str], y_at, width: int, pad_l: float, pad_r: float, price: float) -> None:
    y = y_at(price)
    body.append(
        f'<line x1="{pad_l}" y1="{y:.2f}" x2="{width - pad_r}" y2="{y:.2f}" '
        f'stroke="#111827" stroke-width="1" stroke-dasharray="2 5" opacity="0.85"/>'
    )
    body.append(
        f'<rect x="{width - pad_r + 3}" y="{y - 16:.2f}" width="{pad_r - 8}" height="32" rx="4" fill="#050505"/>'
        f'<text x="{width - 8}" y="{y - 2:.2f}" fill="#ffffff" text-anchor="end" '
        f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="12" font-weight="700">{_fmt_price(price)}</text>'
        f'<text x="{width - 8}" y="{y + 12:.2f}" fill="#d1d5db" text-anchor="end" '
        f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10">last</text>'
    )


def _draw_signal_annotation(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    signal_index: int | None,
    *,
    direction: str,
    stage: str,
    reference_level: float | None,
    sweep_extreme: float | None,
    wait_text: str,
    setup_label: str,
    trigger_mode: str = "",
    pad_t: float,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    if signal_index is None:
        return
    signal_index = max(0, min(signal_index, len(candles) - 1))
    sx = x_at(signal_index)
    candle = candles[signal_index]
    bullish = direction == "bullish"
    signal_price = float(candle["l"] if bullish else candle["h"])
    arrow_y = y_at(signal_price)
    marker_color = "#16a34a" if bullish else "#dc2626"
    if bullish:
        points = f"{sx:.2f},{arrow_y + 24:.2f} {sx - 9:.2f},{arrow_y + 9:.2f} {sx + 9:.2f},{arrow_y + 9:.2f}"
    else:
        points = f"{sx:.2f},{arrow_y - 24:.2f} {sx - 9:.2f},{arrow_y - 9:.2f} {sx + 9:.2f},{arrow_y - 9:.2f}"
    body.append(f'<polygon points="{points}" fill="{marker_color}"/>')

    is_msb = trigger_mode == "msb"
    is_raid = trigger_mode == "raid_msb_or_fvg"
    is_fvg_trigger = trigger_mode in {"fvg", "ifvg"}
    if is_msb or is_raid or is_fvg_trigger:
        return

    label = _clean_setup_label(setup_label, stage, direction)
    banner_color = "#111827"
    if stage == "forming":
        banner_color = "#d97706"
    elif stage == "confirmed":
        banner_color = "#15803d"
    elif stage == "invalidated":
        banner_color = "#b91c1c"

    callout_min_x = pad_l + 210
    callout_max_x = width - pad_r - 230
    label_x = min(callout_max_x, max(callout_min_x, sx + 120))
    _draw_callout(body, label_x, pad_t + 24, label, banner_color, "#ffffff")

    if sweep_extreme is not None and not is_raid:
        sy = y_at(sweep_extreme)
        body.append(f'<circle cx="{sx:.2f}" cy="{sy:.2f}" r="6" fill="none" stroke="#ef4444" stroke-width="2.2"/>')
        sweep_x = min(callout_max_x, max(callout_min_x, sx + 68))
        _draw_callout(body, sweep_x, sy - 18, "raid extreme" if (is_msb or is_raid or is_fvg_trigger) else "sweep / wick", "#ef4444", "#ffffff")

    if reference_level is not None and not is_raid:
        ry = y_at(reference_level)
        direction_word = "above" if bullish else "below"
        reclaim_preferred = sx - 170 if sx > callout_max_x - 70 else sx + 100
        reclaim_x = min(callout_max_x, max(callout_min_x, reclaim_preferred))
        if is_raid:
            label = "HTF raid level"
        elif is_fvg_trigger:
            label = "FVG/iFVG trigger"
        else:
            label = f"MSB close {direction_word}" if is_msb else f"reclaim must close {direction_word}"
        _draw_callout(body, reclaim_x, ry + 28, label, "#111827", "#ffffff")

    wait = "" if is_raid else _short_wait_text(wait_text, direction)
    if wait:
        _draw_callout(body, width - pad_r - 280, pad_t + 58, wait, "#111827", "#ffffff")


def _draw_context_annotation(
    body: list[str],
    y_at,
    *,
    direction: str,
    stage: str,
    htf_target: float | None,
    wait_text: str,
    setup_label: str,
    pad_t: float,
    pad_l: float,
    pad_r: float,
    width: int,
) -> None:
    label = _clean_setup_label(setup_label, stage, direction) if setup_label else _context_setup_label(direction)
    x = width - pad_r - 300
    _draw_callout(body, x, pad_t + 24, label, "#111827", "#ffffff")

    if htf_target is not None:
        target_y = y_at(htf_target)
        label_y = max(pad_t + 84, min(target_y - 20, pad_t + 150))
        _draw_callout(body, x, label_y, "HTF draw on liquidity / target", "#7c3aed", "#ffffff")

    note = _short_context_text(wait_text, direction, stage)
    if note:
        _draw_callout(body, x, pad_t + 60, note, "#0f172a", "#ffffff")


def _draw_decision_panel(
    body: list[str],
    *,
    decision_status: str,
    decision_label: str,
    decision_subtitle: str,
    checklist: list[dict[str, Any]],
    direction: str,
    pad_l: float,
    pad_t: float,
    width: int,
    pad_r: float,
) -> None:
    if not decision_label and not checklist:
        return
    status = str(decision_status or "").lower()
    label = decision_label or _stage_setup_label(status, direction)
    subtitle = " ".join(str(decision_subtitle or "").split())
    if len(subtitle) > 86:
        subtitle = subtitle[:85].rstrip() + "..."

    if "NO TRADE" in label.upper() or status == "blocked":
        color = "#dc2626"
        state_bg = "#1f1114"
    elif status == "ready":
        color = "#16a34a"
        state_bg = "#102016"
    elif status == "armed":
        color = "#d97706"
        state_bg = "#211807"
    else:
        color = "#64748b"
        state_bg = "#111827"

    panel_x = pad_l + 14
    panel_y = pad_t + 14
    panel_w = min(560, max(420, width - pad_l - pad_r - 36))
    panel_h = 118
    body.append(
        f'<rect x="{panel_x:.2f}" y="{panel_y:.2f}" width="{panel_w:.2f}" height="{panel_h}" rx="10" '
        f'fill="{state_bg}" opacity="0.93"/>'
        f'<rect x="{panel_x:.2f}" y="{panel_y:.2f}" width="7" height="{panel_h}" rx="4" fill="{color}"/>'
        f'<text x="{panel_x + 18:.2f}" y="{panel_y + 31:.2f}" fill="#ffffff" '
        f'font-family="Inter,system-ui,sans-serif" font-size="19" font-weight="950">{html.escape(label[:42])}</text>'
    )
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "NEUTRAL"
    body.append(
        f'<rect x="{panel_x + panel_w - 94:.2f}" y="{panel_y + 14:.2f}" width="76" height="25" rx="13" '
        f'fill="{color}" opacity="0.96"/>'
        f'<text x="{panel_x + panel_w - 56:.2f}" y="{panel_y + 31:.2f}" fill="#ffffff" text-anchor="middle" '
        f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="900">{side}</text>'
    )
    if subtitle:
        body.append(
            f'<text x="{panel_x + 18:.2f}" y="{panel_y + 54:.2f}" fill="#d1d5db" '
            f'font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="750">{html.escape(subtitle)}</text>'
        )

    items = checklist[:5]
    if items:
        chip_gap = 7
        chip_w = (panel_w - 36 - chip_gap * (len(items) - 1)) / max(len(items), 1)
        chip_y = panel_y + 72
        for index, item in enumerate(items):
            item_status = str(item.get("status") or "wait").lower()
            item_label = str(item.get("label") or item.get("key") or "Check")
            chip_color = "#22c55e" if item_status == "pass" else "#ef4444" if item_status in {"block", "blocked", "fail"} else "#94a3b8"
            mark = "OK" if item_status == "pass" else "NO" if item_status in {"block", "blocked", "fail"} else "WAIT"
            chip_x = panel_x + 18 + index * (chip_w + chip_gap)
            body.append(
                f'<rect x="{chip_x:.2f}" y="{chip_y:.2f}" width="{chip_w:.2f}" height="28" rx="6" '
                f'fill="#0b1018" stroke="{chip_color}" stroke-width="1" opacity="0.96"/>'
                f'<text x="{chip_x + 8:.2f}" y="{chip_y + 18:.2f}" fill="{chip_color}" '
                f'font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="950">{mark}</text>'
                f'<text x="{chip_x + 35:.2f}" y="{chip_y + 18:.2f}" fill="#f8fafc" '
                f'font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="850">{html.escape(item_label[:10])}</text>'
            )

    if "NO TRADE" in label.upper():
        body.append(
            f'<text x="{width - pad_r - 24:.2f}" y="{pad_t + 92:.2f}" fill="#111827" text-anchor="end" '
            f'font-family="Inter,system-ui,sans-serif" font-size="42" font-weight="950" opacity="0.18">NO TRADE</text>'
        )


def _draw_ema(body: list[str], candles: list[dict[str, Any]], x_at, y_at, period: int, color: str) -> None:
    if len(candles) < period:
        return
    closes = [float(c["c"]) for c in candles]
    k = 2 / (period + 1)
    ema = closes[0]
    points: list[str] = []
    for index, close in enumerate(closes):
        ema = close * k + ema * (1 - k)
        if index >= period // 2:
            points.append(f"{x_at(index):.2f},{y_at(ema):.2f}")
    if len(points) >= 2:
        body.append(
            f'<polyline points="{" ".join(points)}" fill="none" stroke="{color}" stroke-width="2.2" '
            f'stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>'
        )


def _draw_callout(body: list[str], x: float, y: float, text: str, bg: str, fg: str) -> None:
    text = text.strip()
    if not text:
        return
    max_chars = 58
    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "..."
    width = min(430, max(86, len(text) * 7.2 + 20))
    body.append(
        f'<rect x="{x - width / 2:.2f}" y="{y - 16:.2f}" width="{width:.2f}" height="28" rx="5" '
        f'fill="{bg}" opacity="0.94"/>'
        f'<text x="{x:.2f}" y="{y + 2:.2f}" fill="{fg}" text-anchor="middle" '
        f'font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="700">{html.escape(text)}</text>'
    )


def _draw_inline_tag(
    body: list[str],
    x: float,
    y: float,
    text: str,
    bg: str,
    *,
    fg: str = "#ffffff",
    anchor: str = "start",
) -> None:
    text = text.strip()
    if not text:
        return
    if len(text) > 38:
        text = text[:37].rstrip() + "..."
    tag_w = min(250, max(72, len(text) * 6.8 + 18))
    rect_x = x - tag_w if anchor == "end" else x
    text_x = rect_x + tag_w - 9 if anchor == "end" else rect_x + 9
    text_anchor = "end" if anchor == "end" else "start"
    body.append(
        f'<rect x="{rect_x:.2f}" y="{y - 11:.2f}" width="{tag_w:.2f}" height="21" rx="4" '
        f'fill="{bg}" opacity="0.9"/>'
        f'<text x="{text_x:.2f}" y="{y + 4:.2f}" fill="{fg}" text-anchor="{text_anchor}" '
        f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="800">{html.escape(text)}</text>'
    )


def _draw_trigger_panel(
    body: list[str],
    *,
    direction: str,
    stage: str,
    trigger_mode: str,
    msb_level: float | None,
    zones: list[dict[str, Any]],
    reference_level: float | None,
    sweep_extreme: float | None,
    wait_text: str,
    pad_l: float,
    pad_t: float,
) -> None:
    if trigger_mode not in {"raid_msb_or_fvg", "msb", "fvg", "ifvg"}:
        return
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "SETUP"
    title = "CONFIRMATION MAP" if stage != "confirmed" else "CONFIRMED PLAN"
    lines: list[tuple[str, str]] = []
    effective_msb = msb_level if msb_level is not None else reference_level if trigger_mode == "msb" else None
    if effective_msb is not None:
        action = "close above" if direction == "bullish" else "close below"
        lines.append(("MSB", f"{action} {_fmt_price(effective_msb)}"))
    zone_labels = [_zone_label(zone) for zone in zones if zone.get("role") in {"trigger_zone", "fvg_zone", "ifvg_zone"}]
    if zone_labels:
        lines.append(("FVG", " / ".join(zone_labels[:2])))
    if reference_level is not None:
        lines.append(("Raid", _fmt_price(reference_level)))
    if sweep_extreme is not None:
        lines.append(("Invalid", _fmt_price(sweep_extreme)))
    if not lines and wait_text:
        lines.append(("Next", _short_wait_text(wait_text, direction)))
    if not lines:
        return

    panel_x = pad_l + 12
    panel_y = pad_t + 12
    panel_w = 300
    panel_h = 42 + len(lines[:4]) * 24
    body.append(
        f'<rect x="{panel_x:.2f}" y="{panel_y:.2f}" width="{panel_w}" height="{panel_h}" rx="8" '
        f'fill="#111827" opacity="0.84"/>'
        f'<text x="{panel_x + 14:.2f}" y="{panel_y + 22:.2f}" fill="#ffffff" '
        f'font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="900">{title} · {side}</text>'
    )
    for index, (label, value) in enumerate(lines[:4]):
        y = panel_y + 46 + index * 24
        color = "#93c5fd" if label == "MSB" else "#86efac" if label == "FVG" else "#fca5a5" if label == "Invalid" else "#d1d5db"
        body.append(
            f'<text x="{panel_x + 14:.2f}" y="{y:.2f}" fill="{color}" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="900">{html.escape(label)}</text>'
            f'<text x="{panel_x + 82:.2f}" y="{y:.2f}" fill="#f9fafb" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">{html.escape(value[:34])}</text>'
        )


def _focus_candles(
    candles: list[dict[str, Any]],
    signal_at_ms: int | None,
    *,
    role: str = "",
) -> list[dict[str, Any]]:
    if not candles:
        return []
    if signal_at_ms is None:
        max_visible = 100 if role == "trigger" else 90 if role == "context" else 96
        return candles[-max_visible:] if len(candles) > max_visible else candles

    best_index = 0
    best_diff = abs(int(candles[0]["t"]) - signal_at_ms)
    for index, candle in enumerate(candles):
        diff = abs(int(candle["t"]) - signal_at_ms)
        if diff < best_diff:
            best_index = index
            best_diff = diff

    if role == "trigger":
        pad_before, max_visible = 44, 112
    elif role == "context":
        pad_before, max_visible = 30, 96
    else:
        pad_before, max_visible = 36, 104

    end = len(candles)
    start = max(0, end - max_visible)
    if best_index < start:
        start = max(0, best_index - pad_before)
        end = min(len(candles), start + max_visible)
    return candles[start:end]


def _signal_index(candles: list[dict[str, Any]], signal_at_ms: int | None) -> int | None:
    if signal_at_ms is None or not candles:
        return None
    best_index = 0
    best_diff = abs(int(candles[0]["t"]) - signal_at_ms)
    for index, candle in enumerate(candles):
        diff = abs(int(candle["t"]) - signal_at_ms)
        if diff < best_diff:
            best_index = index
            best_diff = diff
    if len(candles) > 1:
        gaps = [
            abs(int(candles[i]["t"]) - int(candles[i - 1]["t"]))
            for i in range(1, len(candles))
            if int(candles[i]["t"]) != int(candles[i - 1]["t"])
        ]
        step = min(gaps) if gaps else 0
        if step and best_diff > step * 1.6:
            return None
    return best_index


def _find_reference_index(
    candles: list[dict[str, Any]],
    level: float,
    field: str,
    signal_index: int,
) -> int | None:
    tolerance = max(abs(level) * 0.0008, 1e-9)
    start = max(0, signal_index - 28)
    for index in range(signal_index - 1, start - 1, -1):
        if abs(float(candles[index][field]) - level) <= tolerance:
            return index
    return None


def _timestamp_index(candles: list[dict[str, Any]], timestamp_ms: int | None) -> int | None:
    if timestamp_ms is None or not candles:
        return None
    best_index = 0
    best_diff = abs(int(candles[0]["t"]) - int(timestamp_ms))
    for index, candle in enumerate(candles):
        diff = abs(int(candle["t"]) - int(timestamp_ms))
        if diff < best_diff:
            best_index = index
            best_diff = diff
    if len(candles) > 1:
        gaps = [
            abs(int(candles[i]["t"]) - int(candles[i - 1]["t"]))
            for i in range(1, len(candles))
            if int(candles[i]["t"]) != int(candles[i - 1]["t"])
        ]
        step = min(gaps) if gaps else 0
        if step and best_diff > step * 1.6:
            return None
    return best_index


def _find_zone_index(candles: list[dict[str, Any]], low: float, high: float) -> int | None:
    tolerance = max(abs(high - low) * 0.12, max(abs(high), abs(low)) * 0.0001, 1e-9)
    for index in range(len(candles) - 1, 1, -1):
        left = candles[index - 2]
        right = candles[index]
        bullish_gap = abs(float(left["h"]) - low) <= tolerance and abs(float(right["l"]) - high) <= tolerance
        bearish_gap = abs(float(right["h"]) - low) <= tolerance and abs(float(left["l"]) - high) <= tolerance
        if bullish_gap or bearish_gap:
            return index
    return None


def _find_raid_index(
    candles: list[dict[str, Any]],
    level: float,
    field: str,
    end_index: int,
    bullish: bool,
) -> int | None:
    start = max(0, end_index - 36)
    for index in range(end_index, start - 1, -1):
        price = float(candles[index][field])
        if (price <= level if bullish else price >= level):
            return index
    return None


def _find_recent_taken_level(candles: list[dict[str, Any]], field: str) -> tuple[int, int, float] | None:
    bullish = field == "h"
    start = max(0, len(candles) - 36)
    best: tuple[int, int, float] | None = None
    for ref_index in range(start, len(candles) - 2):
        price = float(candles[ref_index][field])
        for take_index in range(ref_index + 1, len(candles)):
            compare = float(candles[take_index][field])
            took = compare >= price if bullish else compare <= price
            if took:
                best = (ref_index, take_index, price)
                break
    return best


def _chart_header(title: str, candle: dict[str, Any], stage: str, role: str) -> str:
    o, h, l, c = (float(candle[key]) for key in ("o", "h", "l", "c"))
    stage_text = stage.upper() if stage else "SIGNAL"
    if role == "trigger":
        role_text = "CONFIRMATION"
    elif role == "context":
        role_text = "HTF CONTEXT"
    else:
        role_text = role.upper() if role else "CHART"
    return f"{title}  O {_fmt_price(o)}  H {_fmt_price(h)}  L {_fmt_price(l)}  C {_fmt_price(c)}  {role_text} / {stage_text}"


def _target_label(entry: float, target: float, stop: float | None) -> str:
    pct = abs(target - entry) / entry * 100 if entry else 0
    if stop is not None and abs(entry - stop) > 0:
        rr = abs(target - entry) / abs(entry - stop)
        return f"Reward: {pct:.2f}% / {rr:.2f}R"
    return f"Reward: {pct:.2f}%"


def _stop_label(entry: float, stop: float) -> str:
    pct = abs(entry - stop) / entry * 100 if entry else 0
    return f"Invalid: {pct:.2f}% risk"


def _stage_setup_label(stage: str, direction: str) -> str:
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "SETUP"
    if stage == "forming":
        return f"WATCHLIST: {side} trigger pending"
    if stage == "confirmed":
        return f"PLAN READY: {side}"
    if stage == "invalidated":
        return f"INVALIDATED: {side}"
    return f"{side} signal"


def _clean_setup_label(setup_label: str, stage: str, direction: str) -> str:
    text = " ".join(str(setup_label or "").split())
    if not text or text.lower() in {"kod turtle soup reclaim", "kod-turtle-soup-reclaim"}:
        return _stage_setup_label(stage, direction)
    if text.upper().startswith(("WAITING:", "CONFIRMED:", "INVALIDATED:", "WATCHLIST:", "PLAN READY:", "HTF CONTEXT:")):
        return text
    return _stage_setup_label(stage, direction)


def _normalize_trigger_mode(trigger_mode: str) -> str:
    value = str(trigger_mode or "").strip().lower().replace("-", "_")
    if "raid" in value:
        return "raid_msb_or_fvg"
    if "ifvg" in value:
        return "ifvg"
    if "fvg" in value:
        return "fvg"
    if "msb" in value or "market structure" in value:
        return "msb"
    return value


def _normalise_zones(zones: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for zone in zones or []:
        low = _to_float(zone.get("low"))
        high = _to_float(zone.get("high"))
        if low is None or high is None:
            continue
        result.append(
            {
                **zone,
                "low": min(low, high),
                "high": max(low, high),
                "kind": str(zone.get("kind") or "fvg").lower(),
                "direction": str(zone.get("direction") or "").lower(),
                "label": str(zone.get("label") or ""),
                "role": str(zone.get("role") or ""),
            }
        )
    return result


def _auto_fvg_zones(candles: list[dict[str, Any]], direction: str) -> list[dict[str, Any]]:
    zones: list[dict[str, Any]] = []
    if len(candles) < 5:
        return zones
    wanted = "bullish" if direction == "bullish" else "bearish" if direction == "bearish" else ""
    for index in range(len(candles) - 1, 1, -1):
        left = candles[index - 2]
        right = candles[index]
        left_high = float(left["h"])
        left_low = float(left["l"])
        right_high = float(right["h"])
        right_low = float(right["l"])
        if right_low > left_high:
            zone_direction = "bullish"
            low, high = left_high, right_low
        elif right_high < left_low:
            zone_direction = "bearish"
            low, high = right_high, left_low
        else:
            continue
        role = "trigger_zone" if wanted and wanted == zone_direction else "fvg_zone"
        zones.append(
            {
                "low": low,
                "high": high,
                "kind": "fvg",
                "direction": zone_direction,
                "label": "recent imbalance",
                "role": role,
            }
        )
        if len(zones) >= 2:
            break
    return zones


def _zone_label(zone: dict[str, Any]) -> str:
    kind = str(zone.get("kind") or "fvg").upper()
    if kind == "IFVG":
        kind = "iFVG"
    role = str(zone.get("role") or "")
    direction = str(zone.get("direction") or "")
    side = "bullish" if direction == "bullish" else "bearish" if direction == "bearish" else ""
    if role == "trigger_zone":
        return f"trigger {kind}"
    if role == "opposing_zone":
        return f"opposing {kind}"
    if side:
        return f"{side} {kind}"
    return kind


def _context_setup_label(direction: str) -> str:
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "SETUP"
    target_side = "above" if direction == "bullish" else "below" if direction == "bearish" else "ahead"
    return f"HTF CONTEXT: {side} target {target_side}"


def _reference_label(trigger_mode: str) -> str:
    if trigger_mode == "msb":
        return "MSB level"
    if trigger_mode == "raid_msb_or_fvg":
        return "HTF raid level"
    if trigger_mode in {"fvg", "ifvg"}:
        return "FVG/iFVG trigger"
    return "reference level"


def _short_wait_text(wait_text: str, direction: str) -> str:
    text = " ".join(str(wait_text or "").split())
    if text:
        text = text.replace("Confirmation needed:", "").strip()
        text = text.replace("price must ", "")
        if "20-bar high" in text:
            return "Need 20-bar high take + close back below"
        if "20-bar low" in text:
            return "Need 20-bar low take + close back above"
        if "MSB level" in text or "market structure" in text:
            return text[:72]
        if "FVG/iFVG" in text or "HTF raid" in text:
            return text[:72]
        if "close back through it" in text:
            side = "below it" if direction == "bearish" else "above it"
            text = text.replace("close back through it", f"close back {side}")
        return text
    if direction == "bearish":
        return "Need bearish trigger confirmation"
    return "Need bullish trigger confirmation"


def _short_context_text(wait_text: str, direction: str, stage: str) -> str:
    text = " ".join(str(wait_text or "").split())
    if text:
        return text[:72]
    if stage == "confirmed":
        return "HTF map only. Manage from confirmation chart"
    return "HTF map only. Confirmation is on trigger chart"


def _fmt_price(value: float) -> str:
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    if abs(value) >= 10:
        return f"{value:,.2f}"
    if abs(value) >= 1:
        return f"{value:,.4f}"
    return f"{value:.5f}"


def _fmt_time(timestamp_ms: int) -> str:
    dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
    return dt.strftime("%d.%m %H:%M")


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_number(*values: float | None) -> float | None:
    for value in values:
        converted = _to_float(value)
        if converted is not None:
            return converted
    return None


def _empty_svg(width: int, height: int, message: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'<rect width="{width}" height="{height}" fill="#cfd3dc"/>'
        f'<text x="{width / 2:.1f}" y="{height / 2:.1f}" fill="#374151" '
        f'text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700">'
        f"{html.escape(message)}</text></svg>"
    )
