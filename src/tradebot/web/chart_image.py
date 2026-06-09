from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any

THEME = {
    "bg": "#08090a",
    "header": "#111419",
    "plot": "#0b0d10",
    "plot_border": "#242a31",
    "grid": "#242a31",
    "grid_text": "#7b8490",
    "header_text": "#edf2f7",
    "bull": "#2bbf8a",
    "bear": "#e05252",
    "wick": "#b6bdc7",
    "scale_bg": "#111419",
    "last_price": "#6f8cff",
    "liquidity": "#67a8ff",
    "sweep": "#e7b84a",
    "mss": "#f8fafc",
    "choch": "#cbd5e1",
}

SESSION_BOX_COLORS = {
    "asia": ("#6366f1", 0.16),
    "london": ("#f59e0b", 0.16),
    "ny_am": ("#22c55e", 0.16),
    "ny_pm": ("#a855f7", 0.16),
}


class _LabelLedger:
    """Small lane manager that keeps CRT chart labels from stacking."""

    def __init__(self, min_y: float, max_y: float, *, gap: float = 5.0) -> None:
        self.min_y = min_y
        self.max_y = max_y
        self.gap = gap
        self._lanes: dict[str, list[tuple[float, float]]] = {}

    def place(self, y: float, *, lane: str = "right", priority: int = 3, height: float = 22.0) -> float | None:
        y = _clamp(y, self.min_y + height / 2, self.max_y - height / 2)
        if self._fits(y, lane, height):
            self._remember(y, lane, height)
            return y

        step = height + self.gap
        candidates: list[float] = []
        for distance in range(1, 11):
            candidates.append(y - step * distance)
            candidates.append(y + step * distance)
        for candidate in candidates:
            candidate = _clamp(candidate, self.min_y + height / 2, self.max_y - height / 2)
            if self._fits(candidate, lane, height):
                self._remember(candidate, lane, height)
                return candidate

        if priority <= 1:
            self._remember(y, lane, height)
            return y
        return None

    def _fits(self, y: float, lane: str, height: float) -> bool:
        top = y - height / 2 - self.gap
        bottom = y + height / 2 + self.gap
        return all(bottom < used_top or top > used_bottom for used_top, used_bottom in self._lanes.get(lane, []))

    def _remember(self, y: float, lane: str, height: float) -> None:
        self._lanes.setdefault(lane, []).append((y - height / 2, y + height / 2))


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
    framework: dict[str, Any] | None = None,
    minimal: bool = False,
) -> str:
    if not candles:
        return _empty_svg(width, height, message)

    role = (role or "").lower()
    stage = (stage or "").lower()
    trigger_mode = _normalize_trigger_mode(trigger_mode)
    is_context = role == "context"
    clean_structure_mode = trigger_mode in {"model1_or_mss", "raid_msb_or_fvg", "mss", "msb", "model1"}
    visible = _focus_candles(candles, signal_at_ms, role=role)
    if not visible:
        return _empty_svg(width, height, "No candle data")

    levels = levels or {}
    framework = framework or {}
    entry = None if is_context else _to_float(levels.get("entry"))
    stop = None if is_context else _to_float(levels.get("stop"))
    tp1 = None if is_context else _to_float(levels.get("tp1"))
    tp2 = None if is_context else _to_float(levels.get("tp2"))
    final_target = None if is_context else _to_float(levels.get("final_target"))
    target = _to_float(htf_target) if is_context else _first_number(htf_target, final_target, tp2, tp1)
    if not is_context and framework:
        crt = framework.get("crt") or {}
        entry = _first_number(entry, crt.get("entry"))
        stop = _first_number(stop, crt.get("stop"))
        target = _first_number(target, crt.get("target"))
        final_target = _first_number(final_target, crt.get("target"))
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
    # Candles own the y-domain. Plan levels may stretch it within reason, but
    # far-away framework references (PWH/PML, distant liquidity pools) must not
    # squash the candles into a flat line — they are simply not drawn.
    candle_min = min(float(c["l"]) for c in visible)
    candle_max = max(float(c["h"]) for c in visible)
    candle_spread = max(candle_max - candle_min, abs(float(visible[-1]["c"])) * 0.0005, 1e-9)
    domain_cap_min = candle_min - candle_spread * 1.6
    domain_cap_max = candle_max + candle_spread * 1.6
    prices.extend(
        price for price in _framework_prices(framework)
        if domain_cap_min <= price <= domain_cap_max
    )
    y_min = max(min(prices), domain_cap_min)
    y_max = min(max(prices), domain_cap_max)
    if y_max <= y_min:
        y_min, y_max = candle_min, candle_max
    if minimal:
        # Trade-plan lines must stay on-chart even when TP sits outside the candle cap.
        plan_prices = [
            price for price in (entry, stop, target, final_target, htf_target, reference_level, msb_level)
            if price is not None
        ]
        if plan_prices:
            y_min = min(y_min, min(plan_prices))
            y_max = max(y_max, max(plan_prices))
    spread = y_max - y_min
    y_min -= spread * 0.12
    y_max += spread * 0.12
    framework = _filter_framework_to_domain(framework, y_min, y_max)

    right_empty_slots = 5.5 if role == "trigger" else 4.5 if role == "context" else 5.0
    slot = plot_w / max(len(visible) + right_empty_slots, 1)
    candle_w = max(4.0, min(17.0, slot * 0.58))
    signal_index = _signal_index(visible, signal_at_ms)

    def x_at(index: int) -> float:
        return pad_l + (index + 0.5) * slot

    def y_at(price: float) -> float:
        return pad_t + (1 - (price - y_min) / (y_max - y_min)) * plot_h

    body: list[str] = []
    body.append(f'<rect width="{width}" height="{height}" fill="{THEME["bg"]}"/>')
    body.append(f'<rect x="0" y="0" width="{width}" height="36" fill="{THEME["header"]}"/>')
    body.append(
        f'<rect x="{width - pad_r}" y="36" width="{pad_r}" height="{height - 36}" '
        f'fill="{THEME["scale_bg"]}" opacity="0.95"/>'
    )

    last = visible[-1]
    header = _chart_header(title, last, stage, role)
    body.append(
        f'<text x="{pad_l}" y="24" fill="{THEME["header_text"]}" font-family="Inter,system-ui,sans-serif" '
        f'font-size="14" font-weight="600">{html.escape(header)}</text>'
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
    label_ledger = _LabelLedger(pad_t + 14, height - pad_b - 14)

    if minimal:
        if role == "trigger":
            _draw_killzone_time_bands(body, visible, x_at, slot, pad_t, plot_h, show_labels=False)
        _draw_minimal_ict_chart(
            body,
            y_at,
            pad_l,
            width,
            pad_r,
            pad_t,
            plot_h,
            framework=framework,
            label_ledger=label_ledger,
            last_price=float(last["c"]),
            is_context=is_context,
            entry=entry,
            stop=stop,
            target=target or final_target or htf_target,
            htf_target=htf_target,
            reference_level=reference_level,
            msb_level=msb_level,
            visible=visible,
            x_at=x_at,
            slot=slot,
            signal_index=signal_index,
        )
        _draw_volume(body, visible, x_at, candle_w, pad_t, plot_h)
        _draw_candles(body, visible, x_at, y_at, candle_w, signal_index)
        _draw_current_price(body, y_at, width, pad_l, pad_r, float(last["c"]))
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" shape-rendering="geometricPrecision" '
            f'text-rendering="geometricPrecision">{"".join(body)}</svg>'
        )

    _draw_framework_killzone(body, pad_l, pad_t, plot_w, plot_h, framework, label_ledger)
    if role == "trigger":
        _draw_killzone_time_bands(body, visible, x_at, slot, pad_t, plot_h)
    _draw_framework_dealing_range(body, y_at, width, pad_l, pad_r, pad_t, plot_h, framework, label_ledger)
    _draw_framework_zones(body, visible, x_at, y_at, framework, signal_index, slot, pad_l, pad_r, width, label_ledger)
    _draw_key_liquidity_levels(body, visible, x_at, y_at, pad_l, pad_r, width, htf_target=htf_target)
    _draw_framework_reference_levels(body, y_at, width, pad_l, pad_r, framework, last_price=float(last["c"]), label_ledger=label_ledger)
    _draw_framework_liquidity(body, y_at, width, pad_l, pad_r, framework, last_price=float(last["c"]), label_ledger=label_ledger)
    if not is_context:
        if framework and (framework.get("crt") or {}).get("type"):
            _draw_crt_setup_overlay(
                body,
                x_at,
                y_at,
                signal_index,
                len(visible),
                pad_l,
                pad_r,
                width,
                entry,
                stop,
                target,
                framework,
                label_ledger,
            )
        else:
            _draw_trade_boxes(body, x_at, y_at, signal_index, len(visible), pad_l, pad_r, width, entry, stop, target, label_ledger=label_ledger)
        _draw_zones(body, visible, x_at, y_at, zones, signal_index, slot, pad_l, pad_r, width, y_min=y_min, y_max=y_max)
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
        if trigger_mode in {"model1_or_mss", "raid_msb_or_fvg", "mss", "msb"} and msb_level is not None:
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
    _draw_volume(body, visible, x_at, candle_w, pad_t, plot_h)
    _draw_ema(body, visible, x_at, y_at, 9, "#a445b6")
    _draw_ema(body, visible, x_at, y_at, 20, "#3d55ff")
    _draw_candles(body, visible, x_at, y_at, candle_w, signal_index)
    _draw_framework_structure(body, visible, x_at, y_at, framework, pad_l, pad_r, width, label_ledger)
    _draw_framework_events(body, visible, x_at, y_at, framework, pad_l, pad_r, width, label_ledger)

    if not is_context:
        if trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}:
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
            has_decision_ui=bool(decision_label or decision_status),
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
        f'fill="{THEME["plot"]}" stroke="{THEME["plot_border"]}" stroke-width="1"/>'
    )
    for i in range(7):
        gy = pad_t + (i / 6) * plot_h
        price = y_max - (i / 6) * (y_max - y_min)
        body.append(
            f'<line x1="{pad_l}" y1="{gy:.2f}" x2="{width - pad_r}" y2="{gy:.2f}" '
            f'stroke="{THEME["grid"]}" stroke-width="1" opacity="0.55"/>'
        )
        body.append(
            f'<text x="{width - pad_r + 12}" y="{gy + 4:.2f}" fill="{THEME["grid_text"]}" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="11">{_fmt_price(price)}</text>'
        )

    count = len(candles)
    indices = sorted({0, count // 5, (2 * count) // 5, (3 * count) // 5, (4 * count) // 5, count - 1})
    for index in indices:
        if index >= count:
            continue
        x = x_at(index)
        body.append(
            f'<line x1="{x:.2f}" y1="{pad_t}" x2="{x:.2f}" y2="{height - pad_b}" '
            f'stroke="{THEME["grid"]}" stroke-width="1" opacity="0.35"/>'
        )
        body.append(
            f'<text x="{x:.2f}" y="{height - 18}" fill="{THEME["grid_text"]}" text-anchor="middle" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10">{_fmt_time(int(candles[index]["t"]))}</text>'
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


def _framework_prices(framework: dict[str, Any]) -> list[float]:
    """All price levels the framework may want drawn (callers clamp to domain)."""
    if not framework:
        return []
    prices: list[float] = []
    for container in (framework.get("dealing_range") or {}, framework.get("reference_levels") or {}):
        for value in container.values():
            converted = _to_float(value)
            if converted is not None:
                prices.append(converted)
    for collection_key in ("liquidity_map", "liquidity_ranking", "fvg", "order_blocks", "breaker_blocks", "mitigation_blocks"):
        for item in framework.get(collection_key) or []:
            for key in ("level", "high", "low", "midpoint"):
                value = _to_float(item.get(key))
                if value is not None:
                    prices.append(value)
    return prices


def _filter_framework_to_domain(framework: dict[str, Any], y_min: float, y_max: float) -> dict[str, Any]:
    """Drop framework levels outside the visible price domain.

    Reference levels and liquidity pools can sit very far from the current
    price (e.g. PWH/PML). Drawing them would stack labels on the chart edge,
    so anything outside the domain is removed before rendering.
    """
    if not framework:
        return framework

    def in_domain(value: Any) -> bool:
        price = _to_float(value)
        return price is not None and y_min <= price <= y_max

    filtered = dict(framework)

    refs = framework.get("reference_levels") or {}
    if refs:
        filtered["reference_levels"] = {name: level for name, level in refs.items() if in_domain(level)}

    for collection_key in ("liquidity_map", "liquidity_ranking"):
        pools = framework.get(collection_key)
        if pools:
            filtered[collection_key] = [pool for pool in pools if in_domain(pool.get("level"))]

    for collection_key in ("fvg", "order_blocks", "breaker_blocks", "mitigation_blocks"):
        zones = framework.get(collection_key)
        if zones:
            filtered[collection_key] = [
                zone for zone in zones
                if in_domain(zone.get("low")) or in_domain(zone.get("high")) or in_domain(zone.get("midpoint"))
            ]

    dealing = framework.get("dealing_range") or {}
    if dealing and not (in_domain(dealing.get("high")) or in_domain(dealing.get("low")) or in_domain(dealing.get("eq"))):
        filtered["dealing_range"] = {}

    return filtered


def _draw_framework_killzone(
    body: list[str],
    pad_l: float,
    pad_t: float,
    plot_w: float,
    plot_h: float,
    framework: dict[str, Any],
    label_ledger: _LabelLedger,
) -> None:
    killzone = str(framework.get("killzone") or "")
    if not killzone or killzone == "Outside Killzone":
        return
    color = "#e7b84a" if "London" in killzone else "#67a8ff"
    body.append(
        f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" height="{plot_h}" fill="{color}" opacity="0.035"/>'
    )
    _draw_inline_tag(body, pad_l + 12, pad_t + 20, f"{killzone.upper()} ACTIVE", color, fg="#08090a", ledger=label_ledger, lane="left", priority=4)


_KILLZONE_BANDS = (
    ("LDN KZ", 7 * 60, 10 * 60, "#e7b84a"),
    ("NY KZ", 12 * 60, 15 * 60, "#67a8ff"),
)


def _draw_killzone_time_bands(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    slot: float,
    pad_t: float,
    plot_h: float,
    *,
    show_labels: bool = True,
) -> None:
    """Vertical London/NY killzone bands on intraday execution charts."""
    if len(candles) < 3:
        return
    deltas = [int(candles[i + 1]["t"]) - int(candles[i]["t"]) for i in range(min(8, len(candles) - 1))]
    median_delta = sorted(deltas)[len(deltas) // 2]
    if median_delta > 3_600_000:  # daily/4h charts: bands would be meaningless
        return

    def minute_of_day(ts_ms: int) -> int:
        return int(ts_ms // 60_000) % 1440

    for label, start_min, end_min, color in _KILLZONE_BANDS:
        run_start: int | None = None
        for index in range(len(candles) + 1):
            inside = False
            if index < len(candles):
                minute = minute_of_day(int(candles[index]["t"]))
                inside = start_min <= minute < end_min
            if inside and run_start is None:
                run_start = index
            elif not inside and run_start is not None:
                x1 = x_at(run_start) - slot * 0.5
                x2 = x_at(index - 1) + slot * 0.5
                body.append(
                    f'<rect x="{x1:.2f}" y="{pad_t}" width="{max(0.0, x2 - x1):.2f}" height="{plot_h}" '
                    f'fill="{color}" opacity="0.06"/>'
                )
                if show_labels:
                    body.append(
                        f'<text x="{x1 + 5:.2f}" y="{pad_t + 14:.2f}" fill="{color}" opacity="0.75" '
                        f'font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="800">{label}</text>'
                    )
                run_start = None


def _draw_ict_line(
    body: list[str],
    y_at,
    pad_l: float,
    width: int,
    pad_r: float,
    price: float | None,
    label: str,
    color: str,
    label_ledger: _LabelLedger,
    *,
    dash: str = "",
    weight: float = 1.35,
    opacity: float = 0.88,
    priority: int = 3,
) -> None:
    """ICT-style horizontal level: full-width line + short tag sitting on the line."""
    if price is None or not label:
        return
    y = y_at(price)
    placed = label_ledger.place(y, lane="ict", priority=priority, height=18)
    if placed is None:
        return
    y = placed
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    body.append(
        f'<line x1="{pad_l:.2f}" y1="{y:.2f}" x2="{width - pad_r:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="{weight:.2f}"{dash_attr} opacity="{opacity:.2f}"/>'
    )
    tag_w = max(34, len(label) * 6.8 + 12)
    body.append(
        f'<rect x="{pad_l + 5:.2f}" y="{y - 9:.2f}" width="{tag_w:.2f}" height="18" rx="2" '
        f'fill="{color}" opacity="0.9"/>'
        f'<text x="{pad_l + 11:.2f}" y="{y + 4:.2f}" fill="#08090a" '
        f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10" font-weight="800">'
        f'{html.escape(label)}</text>'
    )


def _dedupe_ict_prices(levels: list[tuple[float | None, str, str, str, str, float, int]]) -> list[tuple[float, str, str, str, str, float, int]]:
    plan_tags = {"ENTRY", "SL", "TP", "MSS", "C2", "KEY", "HTF"}
    by_price: dict[float, tuple[float, str, str, str, str, float, int]] = {}
    for price, label, color, dash, weight, opacity, priority in levels:
        if price is None:
            continue
        key = round(price, 4)
        existing = by_price.get(key)
        if existing is None:
            by_price[key] = (price, label, color, dash, weight, opacity, priority)
            continue
        # Same price: keep the trade-plan tag over a generic liquidity label.
        if label in plan_tags and existing[1] not in plan_tags:
            by_price[key] = (price, label, color, dash, weight, opacity, priority)
        elif label in plan_tags and existing[1] in plan_tags and priority < existing[6]:
            by_price[key] = (price, label, color, dash, weight, opacity, priority)
    return list(by_price.values())


def _draw_minimal_ict_chart(
    body: list[str],
    y_at,
    pad_l: float,
    width: int,
    pad_r: float,
    pad_t: float,
    plot_h: float,
    *,
    framework: dict[str, Any],
    label_ledger: _LabelLedger,
    last_price: float,
    is_context: bool,
    entry: float | None,
    stop: float | None,
    target: float | None,
    htf_target: float | None,
    reference_level: float | None,
    msb_level: float | None,
    visible: list[dict[str, Any]],
    x_at,
    slot: float,
    signal_index: int | None,
) -> None:
    """Desk chart: ICT lines on the plot, not a text panel below."""
    _draw_framework_dealing_range(
        body, y_at, width, pad_l, pad_r, pad_t, plot_h, framework, label_ledger, show_labels=False,
    )
    dr = framework.get("dealing_range") or {}
    eq = _to_float(dr.get("eq"))
    if eq is None:
        high = _to_float(dr.get("high"))
        low = _to_float(dr.get("low"))
        if high is not None and low is not None:
            eq = (high + low) / 2

    lines: list[tuple[float | None, str, str, str, str, float, int]] = []

    refs = framework.get("reference_levels") or {}
    objective = _framework_objective_level(framework)
    for name in ("PDH", "PDL", "PWH", "PWL"):
        price = _to_float(refs.get(name))
        if price is None:
            continue
        active = objective is not None and _near_price(price, objective)
        lines.append((
            price,
            name,
            THEME["liquidity"] if active else "#8b95a3",
            "7 5" if name.startswith("PW") else "5 4",
            "1.2",
            0.72 if active else 0.48,
            2 if active else 5,
        ))

    pools = (framework.get("liquidity_ranking") or framework.get("liquidity_map") or [])[:5]
    pending = 0
    for pool in pools:
        level = _to_float(pool.get("level"))
        if level is None:
            continue
        side = str(pool.get("side") or "")
        if _pool_taken(side, level, last_price):
            continue
        if objective is not None and _near_price(level, objective):
            continue
        if pending >= 2:
            break
        pending += 1
        short = _liquidity_short_label(str(pool.get("source") or "LIQ"))
        lines.append((level, short, "#7390ad", "4 6", "1.1", 0.55, 4))

    if objective is not None and not (target is not None and _near_price(objective, target)):
        obj_label = _objective_label(framework)
        if not any(_near_price(price, objective) for price, *_ in lines if price is not None):
            lines.append((objective, obj_label, THEME["liquidity"], "6 4", "1.6", 0.9, 1))

    fvg = _rank_framework_zones(framework.get("fvg") or [], objective, limit=1)
    if fvg:
        zone = fvg[0]
        low = _to_float(zone.get("low"))
        high = _to_float(zone.get("high"))
        if low is not None and high is not None:
            direction = str(zone.get("direction") or "")
            color = "#2bbf8a" if direction == "bullish" else "#e05252"
            zone_index = _find_zone_index(visible, min(low, high), max(low, high))
            if zone_index is None:
                zone_index = max(0, (signal_index if signal_index is not None else len(visible) - 1) - 12)
            x1 = max(pad_l, x_at(zone_index) - slot * 0.4)
            x2 = width - pad_r - 8
            y1, y2 = y_at(max(low, high)), y_at(min(low, high))
            body.append(
                f'<rect x="{x1:.2f}" y="{y1:.2f}" width="{max(0, x2 - x1):.2f}" height="{max(3, y2 - y1):.2f}" '
                f'rx="3" fill="{color}" opacity="0.1" stroke="{color}" stroke-width="1" stroke-dasharray="4 4"/>'
            )

    if is_context:
        lines.extend([
            (htf_target, "HTF", "#7c3aed", "6 4", "1.4", 0.82, 2),
            (reference_level, "KEY", "#94a3b8", "4 4", "1.2", 0.65, 3),
        ])
    else:
        lines.extend([
            (entry, "ENTRY", "#f2d17b", "", "2.0", 0.95, 1),
            (stop, "SL", "#e05252", "5 4", "1.5", 0.9, 1),
            (target, "TP", "#67a8ff", "6 4", "1.6", 0.9, 1),
            (reference_level, "C2", "#cbd5e1", "3 5", "1.2", 0.6, 3),
            (msb_level, "MSS", "#f8fafc", "4 4", "1.3", 0.75, 2),
        ])

    if eq is not None:
        lines.append((eq, "EQ", "#9aa4af", "2 6", "1.0", 0.6, 4))

    for price, label, color, dash, weight, opacity, priority in sorted(
        _dedupe_ict_prices(lines),
        key=lambda item: (-item[6], item[0]),
    ):
        _draw_ict_line(
            body, y_at, pad_l, width, pad_r, price, label, color, label_ledger,
            dash=dash, weight=float(weight), opacity=opacity, priority=priority,
        )


def _draw_framework_dealing_range(
    body: list[str],
    y_at,
    width: int,
    pad_l: float,
    pad_r: float,
    pad_t: float,
    plot_h: float,
    framework: dict[str, Any],
    label_ledger: _LabelLedger,
    *,
    show_labels: bool = True,
) -> None:
    dr = framework.get("dealing_range") or {}
    high = _to_float(dr.get("high"))
    low = _to_float(dr.get("low"))
    eq = _to_float(dr.get("eq"))
    if high is None or low is None or high <= low:
        return
    eq = eq if eq is not None else (high + low) / 2
    y_high, y_low, y_eq = y_at(high), y_at(low), y_at(eq)
    left, right = pad_l, width - pad_r
    body.append(
        f'<rect x="{left:.2f}" y="{y_high:.2f}" width="{right - left:.2f}" height="{max(0, y_eq - y_high):.2f}" '
        f'fill="#e05252" opacity="0.055"/>'
        f'<rect x="{left:.2f}" y="{y_eq:.2f}" width="{right - left:.2f}" height="{max(0, y_low - y_eq):.2f}" '
        f'fill="#2bbf8a" opacity="0.055"/>'
        f'<line x1="{left:.2f}" y1="{y_eq:.2f}" x2="{right:.2f}" y2="{y_eq:.2f}" '
        f'stroke="#9aa4af" stroke-width="1" stroke-dasharray="2 6" opacity="0.72"/>'
    )
    if show_labels:
        _draw_inline_tag(body, pad_l + 10, max(pad_t + 18, y_high + 18), "PREMIUM", "#5b2528", ledger=label_ledger, lane="left", priority=4)
        _draw_inline_tag(body, pad_l + 10, y_eq - 12, "EQ", "#343b45", ledger=label_ledger, lane="left", priority=3)
        _draw_inline_tag(body, pad_l + 10, min(pad_t + plot_h - 16, y_low - 12), "DISCOUNT", "#1d4735", ledger=label_ledger, lane="left", priority=4)


def _draw_framework_reference_levels(
    body: list[str],
    y_at,
    width: int,
    pad_l: float,
    pad_r: float,
    framework: dict[str, Any],
    *,
    last_price: float,
    label_ledger: _LabelLedger,
) -> None:
    refs = framework.get("reference_levels") or {}
    objective_level = _framework_objective_level(framework)
    for name in ("PWH", "PWL", "PDH", "PDL"):
        price = _to_float(refs.get(name))
        if price is None:
            continue
        is_weekly = name in {"PWH", "PWL"}
        active = objective_level is not None and _near_price(price, objective_level)
        status = "ACTIVE TARGET" if active else "TAKEN" if _level_taken(name, price, last_price) else ""
        color = THEME["liquidity"] if active else "#aeb7c4" if is_weekly else "#7d8794"
        y = y_at(price)
        dash = "8 5" if not is_weekly else "11 5"
        body.append(
            f'<line x1="{pad_l}" y1="{y:.2f}" x2="{width - pad_r}" y2="{y:.2f}" '
            f'stroke="{color}" stroke-width="{1.5 if is_weekly else 1.1}" stroke-dasharray="{dash}" '
            f'opacity="{0.86 if active else 0.54}"/>'
        )
        _draw_inline_tag(
            body,
            width - pad_r - 10,
            y,
            f"{name}{(' ' + status) if status else ''}",
            color,
            anchor="end",
            ledger=label_ledger,
            lane="right",
            priority=1 if active else 4,
        )


def _draw_framework_liquidity(
    body: list[str],
    y_at,
    width: int,
    pad_l: float,
    pad_r: float,
    framework: dict[str, Any],
    *,
    last_price: float,
    label_ledger: _LabelLedger,
) -> None:
    pools = (framework.get("liquidity_ranking") or framework.get("liquidity_map") or [])[:7]
    objective_level = _framework_objective_level(framework)
    for pool in pools:
        level = _to_float(pool.get("level"))
        if level is None:
            continue
        side = str(pool.get("side") or "")
        source = _liquidity_short_label(str(pool.get("source") or side or "LIQ"))
        strength = str(pool.get("strength") or "Weak")
        active = objective_level is not None and _near_price(level, objective_level)
        taken = _pool_taken(side, level, last_price)
        status = "ACTIVE" if active else "TAKEN" if taken else "PENDING"
        y = y_at(level)
        radius = {"Extreme": 8.0, "Strong": 6.4, "Moderate": 5.0, "Weak": 3.8, "Very Weak": 3.2}.get(strength, 4.0)
        color = THEME["liquidity"] if active else "#7390ad" if not taken else "#64707d"
        opacity = "0.96" if active else "0.68" if not taken else "0.34"
        x = width - pad_r - 32
        body.append(
            f'<line x1="{max(pad_l, x - 72):.2f}" y1="{y:.2f}" x2="{width - pad_r:.2f}" y2="{y:.2f}" '
            f'stroke="{color}" stroke-width="{1.7 if active else 1.0}" stroke-dasharray="4 6" opacity="{opacity}"/>'
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.1f}" fill="none" stroke="{color}" stroke-width="{2.2 if active else 1.4}" opacity="{opacity}">'
            f'<title>Liquidity Pool | Type: {html.escape(source)} | Strength: {html.escape(strength)} | Status: {status}</title></circle>'
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="1.9" fill="{color}" opacity="{opacity}"/>'
        )
        if active:
            body.append(
                f'<path d="M {max(pad_l + 12, x - 240):.2f} {y:.2f} C {x - 175:.2f} {y - 36:.2f}, {x - 86:.2f} {y + 30:.2f}, {x - 14:.2f} {y:.2f}" '
                f'fill="none" stroke="{THEME["liquidity"]}" stroke-width="1.6" stroke-dasharray="8 7" opacity="0.82"/>'
            )
        if taken and not active:
            # Swept pools keep their marker for context but drop the text tag;
            # the right lane stays reserved for actionable levels.
            continue
        _draw_inline_tag(
            body,
            width - pad_r - 46,
            y,
            f"{source} {strength} {status}",
            color,
            anchor="end",
            ledger=label_ledger,
            lane="right",
            priority=1 if active else 3,
        )


def _draw_framework_zones(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    framework: dict[str, Any],
    signal_index: int | None,
    slot: float,
    pad_l: float,
    pad_r: float,
    width: int,
    label_ledger: _LabelLedger,
) -> None:
    objective_level = _framework_objective_level(framework)
    for zone in _rank_framework_zones(framework.get("fvg") or [], objective_level, limit=3):
        freshness = str(zone.get("freshness") or "fresh").lower()
        if freshness == "mitigated" and int(zone.get("age_bars") or 0) > 18:
            continue
        direction = str(zone.get("direction") or "")
        color = "#2bbf8a" if direction == "bullish" else "#e05252"
        opacity = 0.135 if freshness == "fresh" else 0.07 if freshness == "partial" else 0.035
        active = _zone_near_objective(zone, objective_level)
        _draw_framework_zone_box(
            body, candles, x_at, y_at, zone, signal_index, slot, pad_l, pad_r, width,
            label=f"{direction.title()} FVG" if direction else "FVG",
            color=color,
            opacity=opacity + (0.035 if active else 0.0),
            dash="5 4",
            label_ledger=label_ledger,
            priority=2 if active else 4,
        )
    for zone in _rank_framework_zones(framework.get("order_blocks") or [], objective_level, limit=2):
        direction = str(zone.get("direction") or "")
        fresh = str(zone.get("freshness") or "fresh").lower() != "mitigated"
        color = "#278b67" if direction == "bullish" else "#9b3939"
        active = _zone_near_objective(zone, objective_level)
        _draw_framework_zone_box(
            body, candles, x_at, y_at, zone, signal_index, slot, pad_l, pad_r, width,
            label=f"{direction.title()} OB" if direction else "OB",
            color=color,
            opacity=0.13 if fresh else 0.04,
            dash="",
            rounded=True,
            label_ledger=label_ledger,
            priority=2 if active else 4,
        )
    for zone in _rank_framework_zones(framework.get("breaker_blocks") or [], objective_level, limit=1):
        direction = str(zone.get("direction") or "")
        color = "#d2a94d" if direction == "bullish" else "#8db5dc"
        _draw_framework_zone_box(
            body, candles, x_at, y_at, zone, signal_index, slot, pad_l, pad_r, width,
            label="BREAKER",
            color=color,
            opacity=0.08,
            dash="7 5",
            rounded=True,
            label_ledger=label_ledger,
            priority=3,
        )
    for zone in _rank_framework_zones(framework.get("mitigation_blocks") or [], objective_level, limit=1):
        direction = str(zone.get("direction") or "")
        color = "#74a892" if direction == "bullish" else "#b98484"
        _draw_framework_zone_box(
            body, candles, x_at, y_at, zone, signal_index, slot, pad_l, pad_r, width,
            label="MITIGATION",
            color=color,
            opacity=0.035,
            dash="3 5",
            rounded=True,
            label_ledger=label_ledger,
            priority=5,
        )


def _draw_framework_zone_box(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    zone: dict[str, Any],
    signal_index: int | None,
    slot: float,
    pad_l: float,
    pad_r: float,
    width: int,
    *,
    label: str,
    color: str,
    opacity: float,
    dash: str,
    rounded: bool = False,
    label_ledger: _LabelLedger | None = None,
    priority: int = 4,
) -> None:
    low = _to_float(zone.get("low"))
    high = _to_float(zone.get("high"))
    if low is None or high is None:
        return
    bottom_price, top_price = min(low, high), max(low, high)
    zone_index = _find_zone_index(candles, bottom_price, top_price)
    if zone_index is None:
        zone_index = max(0, (signal_index if signal_index is not None else len(candles) - 1) - 18)
    x1 = max(pad_l, x_at(zone_index) - slot * 0.45)
    x2 = width - pad_r - 14
    y1 = y_at(top_price)
    y2 = y_at(bottom_price)
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    body.append(
        f'<rect x="{x1:.2f}" y="{y1:.2f}" width="{max(0, x2 - x1):.2f}" height="{max(3, y2 - y1):.2f}" '
        f'rx="{6 if rounded else 2}" fill="{color}" opacity="{opacity:.3f}" stroke="{color}" '
        f'stroke-width="1.2"{dash_attr}>'
        f'<title>{html.escape(label)} | Low: {_fmt_price(bottom_price)} | High: {_fmt_price(top_price)}</title></rect>'
    )
    if opacity >= 0.08:
        _draw_inline_tag(
            body,
            width - pad_r - 14,
            y1 + 15,
            label,
            color,
            anchor="end",
            ledger=label_ledger,
            lane="right",
            priority=priority,
        )


def _draw_framework_structure(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    framework: dict[str, Any],
    pad_l: float,
    pad_r: float,
    width: int,
    label_ledger: _LabelLedger,
) -> None:
    structure = ((framework.get("timeframes") or {}).get("15m") or {}).get("structure") or {}
    high = _to_float(structure.get("swing_high"))
    prior_high = _to_float(structure.get("prior_swing_high"))
    low = _to_float(structure.get("swing_low"))
    prior_low = _to_float(structure.get("prior_swing_low"))
    if high is None and low is None:
        return
    end = len(candles) - 1
    x_recent = min(width - pad_r - 130, x_at(max(0, end - 5)))
    x_prior = max(pad_l + 70, x_at(max(0, end - 28)))
    if high is not None and prior_high is not None:
        label = "HH" if high > prior_high else "LH"
        color = "#2bbf8a" if label == "HH" else "#e05252"
        body.append(
            f'<line x1="{x_prior:.2f}" y1="{y_at(prior_high):.2f}" x2="{x_recent:.2f}" y2="{y_at(high):.2f}" '
            f'stroke="{color}" stroke-width="1.5" opacity="0.58"/>'
        )
        _draw_inline_tag(body, x_recent + 8, y_at(high) - 12, label, color, ledger=label_ledger, lane="structure", priority=2)
    if low is not None and prior_low is not None:
        label = "HL" if low > prior_low else "LL"
        color = "#2bbf8a" if label == "HL" else "#e05252"
        body.append(
            f'<line x1="{x_prior:.2f}" y1="{y_at(prior_low):.2f}" x2="{x_recent:.2f}" y2="{y_at(low):.2f}" '
            f'stroke="{color}" stroke-width="1.25" opacity="0.48"/>'
        )
        _draw_inline_tag(body, x_recent + 8, y_at(low) + 16, label, color, ledger=label_ledger, lane="structure", priority=2)


def _draw_framework_events(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    y_at,
    framework: dict[str, Any],
    pad_l: float,
    pad_r: float,
    width: int,
    label_ledger: _LabelLedger,
) -> None:
    if not candles or not framework:
        return
    last = candles[-1]
    last_x = x_at(len(candles) - 1)
    last_close = float(last["c"])
    objective_level = _framework_objective_level(framework)
    if objective_level is not None:
        target_y = y_at(objective_level)
        start_y = y_at(last_close)
        target_x = width - pad_r - 42
        body.append(
            f'<path d="M {last_x:.2f} {start_y:.2f} C {last_x + 115:.2f} {start_y:.2f}, {target_x - 115:.2f} {target_y:.2f}, {target_x:.2f} {target_y:.2f}" '
            f'fill="none" stroke="{THEME["liquidity"]}" stroke-width="1.7" stroke-dasharray="9 8" opacity="0.82"/>'
        )
        _draw_inline_tag(
            body,
            target_x - 10,
            target_y - 22,
            f"TARGETING {_objective_label(framework)}",
            THEME["liquidity"],
            anchor="end",
            ledger=label_ledger,
            lane="right",
            priority=1,
        )

    sweep = framework.get("latest_sweep") or {}
    sweep_level = _to_float(sweep.get("level"))
    if sweep and sweep_level is not None:
        index = _timestamp_index(candles, int(sweep.get("time_ms") or 0)) if sweep.get("time_ms") else None
        if index is None:
            index = len(candles) - 1
        x = x_at(index)
        y = y_at(sweep_level)
        strength = str(sweep.get("strength") or "Moderate")
        side = "SSL" if str(sweep.get("type")) == "bullish" else "BSL"
        stroke_w = "2.8" if strength in {"Strong", "Violent"} else "2.1"
        candle = candles[index]
        extreme = float(candle["l"] if str(sweep.get("type")) == "bullish" else candle["h"])
        body.append(
            f'<line x1="{x:.2f}" y1="{y:.2f}" x2="{x:.2f}" y2="{y_at(extreme):.2f}" '
            f'stroke="{THEME["sweep"]}" stroke-width="{stroke_w}" stroke-dasharray="3 3"/>'
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="7" fill="none" stroke="{THEME["sweep"]}" stroke-width="{stroke_w}">'
            f'<title>{side} SWEPT | Strength: {html.escape(strength)}</title></circle>'
        )
        sweep_label_y = label_ledger.place(y - 28, lane="event", priority=1, height=28)
        if sweep_label_y is not None:
            _draw_callout(body, min(width - pad_r - 140, max(pad_l + 140, x + 95)), sweep_label_y, f"{side} SWEPT · {strength}", THEME["sweep"], "#08090a")

    displacement = framework.get("displacement") or {}
    if displacement.get("present"):
        direction = str(displacement.get("direction") or "")
        rank = str(displacement.get("rank") or "Displacement")
        color = "#2bbf8a" if direction == "bullish" else "#e05252"
        y = y_at(float(last["h"] if direction == "bullish" else last["l"]))
        arrow = "M {x} {y1} L {x2} {y2} L {x3} {y2}".format(
            x=f"{last_x:.2f}",
            y1=f"{y - 28:.2f}" if direction == "bullish" else f"{y + 28:.2f}",
            x2=f"{last_x - 9:.2f}",
            x3=f"{last_x + 9:.2f}",
            y2=f"{y - 9:.2f}" if direction == "bullish" else f"{y + 9:.2f}",
        )
        body.append(f'<path d="{arrow}" fill="none" stroke="{color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>')
        _draw_inline_tag(
            body,
            max(pad_l + 12, last_x - 92),
            y - 36 if direction == "bullish" else y + 36,
            f"{rank} displacement",
            color,
            ledger=label_ledger,
            lane="event",
            priority=2,
        )

    mss = framework.get("mss_detail") or {}
    if mss.get("present"):
        direction = str(mss.get("direction") or "")
        y = y_at(last_close)
        label_y = y - 54 if direction == "bullish" else y + 54
        placed_y = label_ledger.place(label_y, lane="event", priority=1, height=28)
        if placed_y is not None:
            _draw_callout(body, min(width - pad_r - 145, max(pad_l + 150, last_x - 95)), placed_y, f"{direction.upper()} MSS", "#f8fafc", "#08090a")
    choch = framework.get("choch_detail") or {}
    if choch.get("present"):
        direction = str(choch.get("direction") or "")
        y = y_at(last_close)
        _draw_inline_tag(
            body,
            min(width - pad_r - 120, max(pad_l + 24, last_x - 55)),
            y + 34,
            f"{direction.upper()} CHOCH",
            THEME["choch"],
            fg="#08090a",
            ledger=label_ledger,
            lane="event",
            priority=2,
        )


def _draw_volume(
    body: list[str],
    candles: list[dict[str, Any]],
    x_at,
    candle_w: float,
    pad_t: float,
    plot_h: float,
) -> None:
    """Subtle volume histogram along the bottom of the plot.

    Volume confirms displacement legs, so it earns a small (12%) strip; bars
    are drawn under candles and stay out of the way of price labels.
    """
    volumes = [max(0.0, _to_float(c.get("v")) or 0.0) for c in candles]
    v_max = max(volumes, default=0.0)
    if v_max <= 0:
        return
    strip_h = plot_h * 0.12
    base_y = pad_t + plot_h
    for index, candle in enumerate(candles):
        volume = volumes[index]
        if volume <= 0:
            continue
        bar_h = max(1.5, (volume / v_max) * strip_h)
        is_bull = float(candle["c"]) >= float(candle["o"])
        color = THEME["bull"] if is_bull else THEME["bear"]
        x = x_at(index)
        body.append(
            f'<rect x="{x - candle_w / 2:.2f}" y="{base_y - bar_h:.2f}" '
            f'width="{candle_w:.2f}" height="{bar_h:.2f}" fill="{color}" opacity="0.28"/>'
        )


def _draw_candles(body: list[str], candles: list[dict[str, Any]], x_at, y_at, candle_w: float, signal_index: int | None) -> None:
    for index, candle in enumerate(candles):
        o, h, l, c = float(candle["o"]), float(candle["h"]), float(candle["l"]), float(candle["c"])
        x = x_at(index)
        up = c >= o
        color = THEME["bull"] if up else THEME["bear"]
        is_signal = signal_index is not None and index == signal_index
        body.append(
            f'<line x1="{x:.2f}" y1="{y_at(h):.2f}" x2="{x:.2f}" y2="{y_at(l):.2f}" '
            f'stroke="{THEME["wick"]}" stroke-width="{1.6 if is_signal else 1.1}" stroke-linecap="round"/>'
        )
        top = y_at(max(o, c))
        bottom = y_at(min(o, c))
        body_h = max(2.0, bottom - top)
        body.append(
            f'<rect x="{x - candle_w / 2:.2f}" y="{top:.2f}" width="{candle_w:.2f}" '
            f'height="{body_h:.2f}" fill="{color}" stroke="{color}" stroke-width="{1.4 if is_signal else 0.6}"/>'
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
    *,
    label_ledger: _LabelLedger | None = None,
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
            label_y = label_ledger.place(top - 12, lane="trade", priority=1, height=28) if label_ledger else top - 12
            if label_y is not None:
                _draw_callout(body, (x1 + x2) / 2, label_y, _target_label(entry, target, stop), "#6b7280", "#ffffff")

    if stop is not None:
        top = min(y_at(entry), y_at(stop))
        height = abs(y_at(entry) - y_at(stop))
        if height >= 3:
            body.append(
                f'<rect x="{x1:.2f}" y="{top:.2f}" width="{x2 - x1:.2f}" height="{height:.2f}" '
                f'fill="#111827" opacity="0.16" stroke="#111827" stroke-width="1" stroke-opacity="0.22"/>'
            )
            label_y = label_ledger.place(top + height + 24, lane="trade", priority=1, height=28) if label_ledger else top + height + 24
            if label_y is not None:
                _draw_callout(body, (x1 + x2) / 2, label_y, _stop_label(entry, stop), "#050505", "#ffffff")


def _draw_crt_setup_overlay(
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
    framework: dict[str, Any],
    label_ledger: _LabelLedger,
) -> None:
    if entry is None:
        return
    crt = framework.get("crt") or {}
    crt_type = str(crt.get("type") or "")
    bullish = "bullish" in crt_type.lower() or (target is not None and target > entry)
    side_color = THEME["bull"] if bullish else THEME["bear"]
    entry_color = "#f2d17b"
    stop_color = "#e05252"
    target_color = THEME["liquidity"]

    start_index = signal_index if signal_index is not None else max(0, count - 16)
    x1 = min(width - pad_r - 245, max(pad_l + 96, x_at(max(0, start_index - 4))))
    x2 = width - pad_r - 18
    if x2 <= x1:
        return

    range_low = min(value for value in (entry, stop) if value is not None)
    range_high = max(value for value in (entry, stop) if value is not None)
    midpoint = (range_high + range_low) / 2
    y_high = y_at(range_high)
    y_low = y_at(range_low)
    y_mid = y_at(midpoint)
    y_entry = y_at(entry)

    body.append(
        f'<rect x="{x1:.2f}" y="{y_high:.2f}" width="{x2 - x1:.2f}" height="{max(4, y_low - y_high):.2f}" '
        f'rx="7" fill="{side_color}" opacity="0.075" stroke="{side_color}" stroke-width="1.6" stroke-dasharray="8 5">'
        f'<title>CRT Setup | Type: {html.escape(crt_type or "CRT")} | Entry: {_fmt_price(entry)}'
        f'{f" | Stop: {_fmt_price(stop)}" if stop is not None else ""}'
        f'{f" | Target: {_fmt_price(target)}" if target is not None else ""}</title></rect>'
        f'<line x1="{x1:.2f}" y1="{y_mid:.2f}" x2="{x2:.2f}" y2="{y_mid:.2f}" '
        f'stroke="#f8fafc" stroke-width="1" stroke-dasharray="3 6" opacity="0.46"/>'
    )

    entry_band = max(5.0, abs(y_low - y_high) * 0.12)
    body.append(
        f'<rect x="{x1:.2f}" y="{y_entry - entry_band / 2:.2f}" width="{x2 - x1:.2f}" height="{entry_band:.2f}" '
        f'rx="4" fill="{entry_color}" opacity="0.16" stroke="{entry_color}" stroke-width="1.5"/>'
        f'<line x1="{x1:.2f}" y1="{y_entry:.2f}" x2="{x2:.2f}" y2="{y_entry:.2f}" '
        f'stroke="{entry_color}" stroke-width="2.2" opacity="0.96"/>'
    )
    _draw_inline_tag(
        body,
        x2 - 8,
        y_entry,
        f"ENTRY ZONE {_fmt_price(entry)}",
        entry_color,
        fg="#08090a",
        anchor="end",
        ledger=label_ledger,
        lane="trade",
        priority=1,
    )

    if stop is not None:
        y_stop = y_at(stop)
        body.append(
            f'<line x1="{x1:.2f}" y1="{y_stop:.2f}" x2="{x2:.2f}" y2="{y_stop:.2f}" '
            f'stroke="{stop_color}" stroke-width="1.7" stroke-dasharray="7 5" opacity="0.88"/>'
        )
        _draw_inline_tag(
            body,
            x2 - 8,
            y_stop,
            f"INVALID {_fmt_price(stop)}",
            stop_color,
            anchor="end",
            ledger=label_ledger,
            lane="trade",
            priority=1,
        )

    if target is not None:
        y_target = y_at(target)
        reward_top = min(y_entry, y_target)
        reward_h = max(4, abs(y_entry - y_target))
        body.append(
            f'<rect x="{x1:.2f}" y="{reward_top:.2f}" width="{x2 - x1:.2f}" height="{reward_h:.2f}" '
            f'rx="7" fill="{target_color}" opacity="0.055" stroke="{target_color}" stroke-width="1.3" stroke-dasharray="10 7"/>'
            f'<line x1="{x1:.2f}" y1="{y_target:.2f}" x2="{x2:.2f}" y2="{y_target:.2f}" '
            f'stroke="{target_color}" stroke-width="2.0" opacity="0.94"/>'
        )
        _draw_inline_tag(
            body,
            x2 - 8,
            y_target,
            f"TARGET {_fmt_price(target)}",
            target_color,
            fg="#08090a",
            anchor="end",
            ledger=label_ledger,
            lane="trade",
            priority=1,
        )
        rr_text = f"CRT {crt.get('rr')}R" if crt.get("rr") else _target_label(entry, target, stop)
        label_y = label_ledger.place(reward_top - 14, lane="trade-callout", priority=1, height=28)
        if label_y is not None:
            _draw_callout(body, (x1 + x2) / 2, label_y, rr_text, target_color, "#08090a")

    _draw_inline_tag(
        body,
        x1 + 8,
        y_high + 15,
        "CRT HIGH",
        "#39414c",
        ledger=label_ledger,
        lane="left",
        priority=3,
    )
    _draw_inline_tag(
        body,
        x1 + 8,
        y_mid,
        "CRT MID",
        "#2f3742",
        ledger=label_ledger,
        lane="left",
        priority=3,
    )
    _draw_inline_tag(
        body,
        x1 + 8,
        y_low - 12,
        "CRT LOW",
        "#39414c",
        ledger=label_ledger,
        lane="left",
        priority=3,
    )


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
    y_min: float | None = None,
    y_max: float | None = None,
) -> None:
    if not zones:
        return
    for zone_order, zone in enumerate(zones):
        low = _to_float(zone.get("low"))
        high = _to_float(zone.get("high"))
        if low is None or high is None:
            continue
        bottom_price, top_price = min(low, high), max(low, high)
        if y_min is not None and y_max is not None and (bottom_price > y_max or top_price < y_min):
            continue  # entirely outside the visible domain
        zone_index = _find_zone_index(candles, bottom_price, top_price)
        if zone_index is None:
            zone_index = max(0, (signal_index if signal_index is not None else len(candles) - 1) - 2)
        if y_min is not None and y_max is not None:
            bottom_price = max(bottom_price, y_min)
            top_price = min(top_price, y_max)
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
        edge_price = top_price if bullish else bottom_price if direction == "bearish" else (top_price + bottom_price) / 2
        edge_y = y_at(edge_price)
        edge_dash = "" if role == "trigger_zone" else "5 4"
        edge_dash_attr = f' stroke-dasharray="{edge_dash}"' if edge_dash else ""
        body.append(
            f'<line x1="{x1:.2f}" y1="{edge_y:.2f}" x2="{x2:.2f}" y2="{edge_y:.2f}" '
            f'stroke="{color}" stroke-width="2.0"{edge_dash_attr} opacity="0.92"/>'
        )
        edge_label = _zone_edge_label(zone)
        _draw_inline_tag(body, width - pad_r - 12, edge_y + (20 if bullish else -18), edge_label, color, anchor="end")
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
    _draw_inline_tag(body, width - pad_r - 12, y + 20 if bullish else y - 18, f"MSB break {'above' if bullish else 'below'}", color, anchor="end")


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
    label = "Turtle Soup low" if bullish else "Turtle Soup high"
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="1.8" stroke-dasharray="8 5" opacity="0.9"/>'
    )
    body.append(f'<circle cx="{x1:.2f}" cy="{y:.2f}" r="4" fill="#ffffff" stroke="{color}" stroke-width="1.5"/>')
    if compact:
        _draw_inline_tag(body, min(width - pad_r - 90, x1 + 8), y + (18 if bullish else -18), "Turtle Soup", color)
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
    label = htf_raid_label or ("daily Turtle Soup candle" if direction else "Turtle Soup candle")
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
    if reference_level is None or not candles:
        return
    signal_index = len(candles) - 1 if signal_index is None else max(0, min(signal_index, len(candles) - 1))
    bullish = direction == "bullish"
    is_msb = trigger_mode in {"mss", "msb"}
    is_raid = trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}
    is_model1 = trigger_mode == "model1"
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
        label = "Turtle Soup low" if bullish else "Turtle Soup high"
    elif is_model1:
        label = "Model #1 level"
    elif is_fvg_trigger:
        label = "FVG confluence"
    elif is_msb:
        label = "MSS break level"
    else:
        label = "prior 20-bar low taken" if bullish else "prior 20-bar high taken"
    right_x = width - pad_r
    body.append(
        f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" '
        f'stroke="{color}" stroke-width="2.1" opacity="0.95"/>'
    )
    if right_x - x2 > 8:
        body.append(
            f'<line x1="{x2:.2f}" y1="{y:.2f}" x2="{right_x:.2f}" y2="{y:.2f}" '
            f'stroke="{color}" stroke-width="1.8" stroke-dasharray="9 5" opacity="0.82"/>'
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
    elif is_raid:
        liq_label = "sell-side liq taken" if bullish else "buy-side liq taken"
        _draw_inline_tag(body, min(width - pad_r - 205, max(pad_l + 8, x1 + 8)), y + (22 if bullish else -18), liq_label, color)
        reclaim_label = "reclaim above" if bullish else "reclaim below"
        _draw_inline_tag(body, width - pad_r - 12, y - 18 if bullish else y + 22, reclaim_label, color, anchor="end")
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
        if is_msb or is_raid or is_fvg_trigger:
            _draw_inline_tag(body, min(width - pad_r - 150, x2 + 10), sy - 14 if bullish else sy + 18, "sweep / invalid", "#ef4444")
        else:
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
        f'stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2 5" opacity="0.55"/>'
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
    has_decision_ui: bool = False,
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

    is_msb = trigger_mode in {"mss", "msb"}
    is_raid = trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}
    is_model1 = trigger_mode == "model1"
    is_fvg_trigger = trigger_mode in {"fvg", "ifvg"}
    if is_msb or is_raid or is_fvg_trigger or is_model1:
        return

    callout_min_x = pad_l + 210
    callout_max_x = width - pad_r - 230

    # When a decision badge/panel already narrates the state (desk cards and
    # the alert modal), the WATCHLIST banner and wait text would duplicate it
    # and pile up over the price action — skip them there.
    if not has_decision_ui:
        label = _clean_setup_label(setup_label, stage, direction)
        banner_color = "#111827"
        if stage == "forming":
            banner_color = "#d97706"
        elif stage == "confirmed":
            banner_color = "#15803d"
        elif stage == "invalidated":
            banner_color = "#b91c1c"
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
            label = "Turtle Soup level"
        elif is_model1:
            label = "Model #1 trigger"
        elif is_fvg_trigger:
            label = "FVG confluence"
        else:
            label = f"MSS close {direction_word}" if is_msb else f"reclaim must close {direction_word}"
        _draw_callout(body, reclaim_x, ry + 28, label, "#111827", "#ffffff")

    wait = "" if (is_raid or has_decision_ui) else _short_wait_text(wait_text, direction)
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
    ledger: _LabelLedger | None = None,
    lane: str | None = None,
    priority: int = 3,
) -> bool:
    text = text.strip()
    if not text:
        return False
    if len(text) > 38:
        text = text[:37].rstrip() + "..."
    tag_w = min(250, max(72, len(text) * 6.8 + 18))
    if ledger is not None:
        placed_y = ledger.place(y, lane=lane or anchor, priority=priority, height=21)
        if placed_y is None:
            return False
        y = placed_y
    rect_x = x - tag_w if anchor == "end" else x
    text_x = rect_x + tag_w - 9 if anchor == "end" else rect_x + 9
    text_anchor = "end" if anchor == "end" else "start"
    body.append(
        f'<rect x="{rect_x:.2f}" y="{y - 11:.2f}" width="{tag_w:.2f}" height="21" rx="4" '
        f'fill="{bg}" opacity="0.9"/>'
        f'<text x="{text_x:.2f}" y="{y + 4:.2f}" fill="{fg}" text-anchor="{text_anchor}" '
        f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="800">{html.escape(text)}</text>'
    )
    return True


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
    if trigger_mode not in {"model1_or_mss", "raid_msb_or_fvg", "mss", "msb", "model1", "fvg", "ifvg"}:
        return
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "SETUP"
    title = "CONFLUENCE MAP" if trigger_mode in {"fvg", "ifvg"} else "CONFIRMATION MAP" if stage != "confirmed" else "CONFIRMED PLAN"
    lines: list[tuple[str, str]] = []
    effective_msb = msb_level if msb_level is not None else reference_level if trigger_mode in {"mss", "msb"} else None
    if effective_msb is not None:
        action = "close above" if direction == "bullish" else "close below"
        lines.append(("MSS", f"{action} {_fmt_price(effective_msb)}"))
    zone_labels = [_zone_label(zone) for zone in zones if zone.get("role") in {"trigger_zone", "fvg_zone", "ifvg_zone"}]
    if zone_labels:
        lines.append(("FVG", " / ".join(zone_labels[:2])))
    if reference_level is not None:
        lines.append(("Turtle Soup", _fmt_price(reference_level)))
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
        color = "#93c5fd" if label == "MSS" else "#86efac" if label == "FVG" else "#fca5a5" if label == "Invalid" else "#d1d5db"
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
    if "model1_or_mss" in value or ("model" in value and "mss" in value):
        return "model1_or_mss"
    if "model" in value:
        return "model1"
    if "mss" in value:
        return "mss"
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
        return f"{kind} confluence"
    if role == "opposing_zone":
        return f"opposing {kind}"
    if side:
        return f"{side} {kind}"
    return kind


def _zone_edge_label(zone: dict[str, Any]) -> str:
    kind = str(zone.get("kind") or "fvg").upper()
    if kind == "IFVG":
        kind = "iFVG"
    role = str(zone.get("role") or "")
    direction = str(zone.get("direction") or "")
    if role == "opposing_zone":
        return f"avoid {kind}"
    if direction == "bullish":
        return f"{kind} supports long"
    if direction == "bearish":
        return f"{kind} supports short"
    return f"{kind} zone"


def _context_setup_label(direction: str) -> str:
    side = "LONG" if direction == "bullish" else "SHORT" if direction == "bearish" else "SETUP"
    target_side = "above" if direction == "bullish" else "below" if direction == "bearish" else "ahead"
    return f"HTF CONTEXT: {side} target {target_side}"


def _reference_label(trigger_mode: str) -> str:
    if trigger_mode in {"mss", "msb"}:
        return "MSS level"
    if trigger_mode == "model1":
        return "Model #1 level"
    if trigger_mode in {"model1_or_mss", "raid_msb_or_fvg"}:
        return "Turtle Soup level"
    if trigger_mode in {"fvg", "ifvg"}:
        return "FVG confluence"
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
        if "MSS level" in text or "MSB level" in text or "market structure" in text:
            return text[:72]
        if "FVG/iFVG" in text:
            return text.replace("FVG/iFVG", "FVG confluence")[:72]
        if "Model #1" in text or "Turtle Soup" in text or "Context CRT" in text or "HTF raid" in text:
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


def _framework_objective_level(framework: dict[str, Any]) -> float | None:
    objective = framework.get("liquidity_objective")
    if isinstance(objective, dict):
        level = _to_float(objective.get("level"))
        if level is not None:
            return level
    objective_text = str(objective or "")
    for pool in framework.get("liquidity_ranking") or framework.get("liquidity_map") or []:
        level = _to_float(pool.get("level"))
        source = str(pool.get("source") or "")
        if level is not None and source and source in objective_text:
            return level
    for token in objective_text.replace("@", " ").replace(",", "").split():
        value = _to_float(token)
        if value is not None:
            return value
    target = _to_float((framework.get("crt") or {}).get("target"))
    return target


def _objective_label(framework: dict[str, Any]) -> str:
    objective = framework.get("liquidity_objective")
    if isinstance(objective, dict):
        label = str(objective.get("source") or objective.get("kind") or objective.get("side") or "").strip()
        return _liquidity_short_label(label).upper() if label else "LIQUIDITY"
    objective_text = str(objective or "").strip()
    if not objective_text or objective_text == "none":
        return "LIQUIDITY"
    label = objective_text.split("@", 1)[0].strip()
    return _liquidity_short_label(label).upper()


def _rank_framework_zones(zones: list[dict[str, Any]], objective_level: float | None, *, limit: int) -> list[dict[str, Any]]:
    def score(zone: dict[str, Any]) -> tuple[int, float]:
        freshness = str(zone.get("freshness") or "fresh").lower()
        fresh_score = 0 if freshness == "fresh" else 1 if freshness == "partial" else 2
        if objective_level is None:
            distance = 0.0
        else:
            low = _to_float(zone.get("low"))
            high = _to_float(zone.get("high"))
            if low is None or high is None:
                distance = float("inf")
            else:
                distance = min(abs(objective_level - low), abs(objective_level - high), abs(objective_level - ((low + high) / 2)))
        return (fresh_score, distance)

    return sorted(zones, key=score)[:limit]


def _zone_near_objective(zone: dict[str, Any], objective_level: float | None) -> bool:
    if objective_level is None:
        return False
    low = _to_float(zone.get("low"))
    high = _to_float(zone.get("high"))
    if low is None or high is None:
        return False
    bottom, top = min(low, high), max(low, high)
    tolerance = max(abs(objective_level), 1.0) * 0.0015
    return bottom - tolerance <= objective_level <= top + tolerance


def _liquidity_short_label(label: str) -> str:
    raw = " ".join(str(label or "").split())
    upper = raw.upper()
    replacements = {
        "BUY-SIDE LIQUIDITY": "BSL",
        "SELL-SIDE LIQUIDITY": "SSL",
        "EQUAL HIGHS": "EQH",
        "EQUAL LOWS": "EQL",
        "SWING HIGHS": "SWING HIGH",
        "SWING LOWS": "SWING LOW",
    }
    if upper in replacements:
        return replacements[upper]
    if upper in {"PDH", "PDL", "PWH", "PWL", "PMH", "PML"}:
        return upper
    return raw[:16] if raw else "LIQ"


def _near_price(a: float, b: float) -> bool:
    return abs(a - b) <= max(abs(a), abs(b), 1.0) * 0.0005


def _clamp(value: float, low: float, high: float) -> float:
    if high < low:
        return low
    return max(low, min(high, value))


def _level_taken(name: str, price: float, last_price: float) -> bool:
    if name.endswith("H"):
        return last_price > price
    if name.endswith("L"):
        return last_price < price
    return False


def _pool_taken(side: str, price: float, last_price: float) -> bool:
    if side == "buy":
        return last_price > price
    if side == "sell":
        return last_price < price
    return False


def _place_y(y: float, occupied: list[float], min_gap: float = 19.0) -> float:
    placed = y
    for existing in occupied:
        if abs(placed - existing) < min_gap:
            placed = existing + min_gap
    occupied.append(placed)
    return placed


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
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _first_number(*values: float | None) -> float | None:
    for value in values:
        converted = _to_float(value)
        if converted is not None:
            return converted
    return None


def build_session_chart_svg(
    candles: list[dict[str, Any]],
    *,
    symbol: str = "",
    projection: dict[str, Any] | None = None,
    width: int = 1280,
    height: int = 640,
    message: str = "No session data",
) -> str:
    projection = projection or {}
    if not candles:
        return _empty_svg(width, height, message)

    visible = candles[-96:] if len(candles) > 96 else candles
    pad_l, pad_r, pad_t, pad_b = 12, 88, 40, 52
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    prices = [float(c["h"]) for c in visible] + [float(c["l"]) for c in visible]
    draw = projection.get("likely_draw") or {}
    draw_level = _to_float(draw.get("level"))
    if draw_level is not None:
        prices.append(draw_level)
    for item in projection.get("ranges") or []:
        prices.extend([_to_float(item.get("high")), _to_float(item.get("low"))])
    prices = [p for p in prices if p is not None]
    y_min, y_max = min(prices), max(prices)
    if y_max == y_min:
        y_max += 1
        y_min -= 1
    spread = y_max - y_min
    y_min -= spread * 0.08
    y_max += spread * 0.08

    slot = plot_w / max(len(visible), 1)
    candle_w = max(3.0, min(14.0, slot * 0.62))

    def x_at(index: int) -> float:
        return pad_l + (index + 0.5) * slot

    def y_at(price: float) -> float:
        return pad_t + (1 - (price - y_min) / (y_max - y_min)) * plot_h

    def index_for_ms(ms: int) -> int | None:
        best_idx = None
        best_diff = None
        for idx, candle in enumerate(visible):
            diff = abs(int(candle["t"]) - ms)
            if best_diff is None or diff < best_diff:
                best_diff = diff
                best_idx = idx
        return best_idx

    body: list[str] = []
    body.append(f'<rect width="{width}" height="{height}" fill="{THEME["bg"]}"/>')
    body.append(f'<rect x="0" y="0" width="{width}" height="34" fill="{THEME["header"]}"/>')
    status = projection.get("status") or "neutral"
    status_label = {"bullish": "Bullish draw", "bearish": "Bearish draw"}.get(status, "Neutral / wait")
    title = f"{symbol} · 15m Sessions" if symbol else "15m Sessions"
    body.append(
        f'<text x="{pad_l}" y="22" fill="{THEME["header_text"]}" font-family="Inter,system-ui,sans-serif" '
        f'font-size="14" font-weight="600">{html.escape(title)}</text>'
    )
    body.append(
        f'<text x="{width - pad_r - 8}" y="22" fill="{THEME["grid_text"]}" text-anchor="end" '
        f'font-family="Inter,system-ui,sans-serif" font-size="12">{html.escape(status_label)}</text>'
    )

    body.append(
        f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" height="{plot_h}" '
        f'fill="{THEME["plot"]}" stroke="{THEME["plot_border"]}" stroke-width="1"/>'
    )

    for i in range(6):
        gy = pad_t + (i / 5) * plot_h
        price = y_max - (i / 5) * (y_max - y_min)
        body.append(
            f'<line x1="{pad_l}" y1="{gy:.2f}" x2="{width - pad_r}" y2="{gy:.2f}" '
            f'stroke="{THEME["grid"]}" stroke-width="1" opacity="0.45"/>'
        )
        body.append(
            f'<text x="{width - pad_r + 10}" y="{gy + 4:.2f}" fill="{THEME["grid_text"]}" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10">{_fmt_price(price)}</text>'
        )

    for item in projection.get("ranges") or []:
        start_ms = int(item.get("start_ms") or 0)
        end_ms = int(item.get("end_ms") or 0)
        start_idx = index_for_ms(start_ms)
        end_idx = index_for_ms(end_ms)
        if start_idx is None or end_idx is None:
            continue
        left = min(x_at(start_idx), x_at(end_idx)) - slot * 0.5
        right = max(x_at(start_idx), x_at(end_idx)) + slot * 0.5
        key = str(item.get("key") or "")
        color, opacity = SESSION_BOX_COLORS.get(key, ("#64748b", 0.12))
        body.append(
            f'<rect x="{left:.2f}" y="{pad_t}" width="{max(2, right - left):.2f}" height="{plot_h}" '
            f'fill="{color}" opacity="{opacity}"/>'
        )
        label_x = left + 6
        active = " · LIVE" if item.get("active") else ""
        body.append(
            f'<text x="{label_x:.2f}" y="{pad_t + 14}" fill="{color}" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">'
            f'{html.escape(str(item.get("name") or key))}{html.escape(active)}</text>'
        )
        high = _to_float(item.get("high"))
        low = _to_float(item.get("low"))
        if high is not None:
            yh = y_at(high)
            body.append(
                f'<line x1="{left:.2f}" y1="{yh:.2f}" x2="{width - pad_r}" y2="{yh:.2f}" '
                f'stroke="{color}" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.85"/>'
            )
            body.append(
                f'<text x="{width - pad_r + 10}" y="{yh + 4:.2f}" fill="{color}" '
                f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10">{_fmt_price(high)} H</text>'
            )
        if low is not None:
            yl = y_at(low)
            body.append(
                f'<line x1="{left:.2f}" y1="{yl:.2f}" x2="{width - pad_r}" y2="{yl:.2f}" '
                f'stroke="{color}" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.85"/>'
            )
            body.append(
                f'<text x="{width - pad_r + 10}" y="{yl + 4:.2f}" fill="{color}" '
                f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10">{_fmt_price(low)} L</text>'
            )

    _draw_candles(body, visible, x_at, y_at, candle_w, None)

    latest_close = _to_float(projection.get("latest_price"))
    if latest_close is not None:
        yp = y_at(latest_close)
        body.append(
            f'<line x1="{pad_l}" y1="{yp:.2f}" x2="{width - pad_r}" y2="{yp:.2f}" '
            f'stroke="{THEME["last_price"]}" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.9"/>'
        )
        body.append(
            f'<rect x="{width - pad_r + 4}" y="{yp - 10:.2f}" width="72" height="18" rx="3" fill="{THEME["last_price"]}"/>'
            f'<text x="{width - pad_r + 40}" y="{yp + 4:.2f}" fill="#ffffff" text-anchor="middle" '
            f'font-family="JetBrains Mono,ui-monospace,monospace" font-size="10" font-weight="700">'
            f'{_fmt_price(latest_close)}</text>'
        )

    if draw_level is not None:
        yd = y_at(draw_level)
        body.append(
            f'<line x1="{pad_l}" y1="{yd:.2f}" x2="{width - pad_r}" y2="{yd:.2f}" '
            f'stroke="#fbbf24" stroke-width="1.4" opacity="0.9"/>'
        )
        body.append(
            f'<text x="{pad_l + 8}" y="{yd - 6:.2f}" fill="#fbbf24" '
            f'font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600">Likely draw</text>'
        )

    footer_y = height - 36
    body.append(f'<rect x="0" y="{footer_y}" width="{width}" height="36" fill="{THEME["header"]}"/>')
    current = projection.get("current_session") or "—"
    nxt = projection.get("next_session") or "—"
    body.append(
        f'<text x="{pad_l}" y="{height - 14}" fill="{THEME["grid_text"]}" '
        f'font-family="Inter,system-ui,sans-serif" font-size="11">'
        f'Now: {html.escape(str(current))} · Next: {html.escape(str(nxt))}</text>'
    )
    trigger = str(projection.get("trigger") or "")
    if trigger:
        short = trigger if len(trigger) <= 92 else f"{trigger[:89]}…"
        body.append(
            f'<text x="{width - pad_r - 8}" y="{height - 14}" fill="{THEME["header_text"]}" text-anchor="end" '
            f'font-family="Inter,system-ui,sans-serif" font-size="11">{html.escape(short)}</text>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="geometricPrecision">{"".join(body)}</svg>'
    )


def _empty_svg(width: int, height: int, message: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'<rect width="{width}" height="{height}" fill="{THEME["bg"]}"/>'
        f'<text x="{width / 2:.1f}" y="{height / 2:.1f}" fill="{THEME["grid_text"]}" '
        f'text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="15" font-weight="600">'
        f"{html.escape(message)}</text></svg>"
    )
