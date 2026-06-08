from __future__ import annotations

import os
from io import BytesIO
from html import escape
from dataclasses import dataclass

import requests

from tradebot.config import TelegramConfig
from tradebot.models import Alert


@dataclass(frozen=True)
class TelegramNotifier:
    config: TelegramConfig
    force_dry_run: bool = False

    @property
    def dry_run(self) -> bool:
        return self.force_dry_run or self.config.dry_run

    def send(self, alert: Alert, *, refresh_only: bool = False) -> None:
        if refresh_only:
            return
        message = self._format(alert)
        if self.dry_run:
            print(message)
            return

        token = os.getenv(self.config.bot_token_env)
        chat_id = os.getenv(self.config.chat_id_env)
        if not token:
            raise RuntimeError(f"Missing Telegram token env var: {self.config.bot_token_env}")
        if not chat_id:
            raise RuntimeError(f"Missing Telegram chat id env var: {self.config.chat_id_env}")

        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        response.raise_for_status()
        if alert.chart_png:
            photo = BytesIO(alert.chart_png)
            caption = alert.chart_caption or f"{alert.symbol} chart"
            photo_response = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data={"chat_id": chat_id, "caption": caption},
                files={"photo": ("tradebot-chart.png", photo, "image/png")},
                timeout=20,
            )
            photo_response.raise_for_status()

    def _format(self, alert: Alert) -> str:
        opened_at = alert.candle.opened_at.strftime("%Y-%m-%d %H:%M UTC")
        trigger_tf = getattr(alert, "trigger_timeframe", None) or alert.timeframe
        context_tf = getattr(alert, "context_timeframe", None)
        action = _next_action(alert)
        thesis = _first_detail(alert, ("Why watch?:", "Why LONG?:", "Why SHORT?:", "Summary:"))
        alignment = _first_detail(alert, ("YTL / HTF Alignment:",))
        quality = _first_detail(alert, ("Setup:",))
        order_block = _first_detail(alert, ("Order block:",))
        scenario = _first_detail(alert, ("Scenario:",))
        data_note = _first_detail(alert, ("Data note:",))
        plan_lines = _plan_lines(alert.trade_plan or {}, alert.stage)
        title = _title(alert.stage)
        message = f"<b>{title}</b>\n{escape(alert.symbol)} · {_direction_label(alert.direction or '')}\n"
        if alert.profile:
            message += f"<b>Map:</b> {escape(alert.profile)}"
            if context_tf and trigger_tf:
                message += f" · {escape(context_tf)} → {escape(trigger_tf)}"
            message += "\n"
        message += f"<b>Now:</b> {escape(action)}\n"
        if thesis:
            message += f"<b>Read:</b> {escape(_clean_trader_line(_strip_label(thesis)))}\n"
        if alignment:
            message += f"<b>HTF:</b> {escape(_bias_text(alignment))}\n"
        if quality:
            message += f"<b>Grade:</b> {escape(_quality_text(alert, quality))}\n"
        if order_block:
            message += f"<b>SMC:</b> {escape(_clean_trader_line(_strip_label(order_block)))}\n"
        if scenario:
            message += f"<b>Scenario:</b> {escape(_clean_trader_line(_strip_label(scenario)))}\n"
        if data_note:
            message += f"<b>Data:</b> {escape(_clean_trader_line(_strip_label(data_note)))}\n"
        if plan_lines:
            message += "\n<b>Levels</b>\n" + "\n".join(plan_lines) + "\n"
        message += f"\n<b>Candle:</b> {opened_at}\n"
        message += "<b>Execution:</b> Manual only. Screenshot follows."
        return message


def _title(stage: str | None) -> str:
    if stage == "forming":
        return "WATCHLIST - NO ENTRY"
    if stage == "confirmed":
        return "ENTRY PLAN READY"
    if stage == "invalidated":
        return "SETUP INVALIDATED"
    return "Trade alert"


def _stage_label(stage: str) -> str:
    mapping = {
        "forming": "Forming",
        "confirmed": "Confirmed",
        "invalidated": "Invalidated",
    }
    return mapping.get(stage, stage)


def _direction_label(direction: str) -> str:
    if direction == "bullish":
        return "Bullish (LONG)"
    if direction == "bearish":
        return "Bearish (SHORT)"
    return direction


def _trade_plan_lines(trade_plan: dict) -> str:
    lines = []
    if trade_plan.get("rr_tp1") is not None:
        lines.append(f"<b>RR TP1:</b> {_fmt_rr(trade_plan['rr_tp1'])}\n")
    if trade_plan.get("rr_tp2") is not None:
        lines.append(f"<b>RR TP2:</b> {_fmt_rr(trade_plan['rr_tp2'])}\n")
    if trade_plan.get("rr_final") is not None:
        lines.append(f"<b>RR final:</b> {_fmt_rr(trade_plan['rr_final'])}\n")
    return "".join(lines)


def _status_line(alert: Alert) -> str:
    if alert.stage == "forming":
        return "Not a trade yet. Confirmation is still missing."
    if alert.stage == "confirmed":
        return "Trigger confirmed. Use the plan levels; bot will not place orders."
    if alert.stage == "invalidated":
        return "Setup failed. Stand down and wait for a fresh structure."
    return "New alert."


def _next_action(alert: Alert) -> str:
    trigger_tf = getattr(alert, "trigger_timeframe", None) or alert.timeframe
    direction = alert.direction or ""
    mode = str((alert.trade_plan or {}).get("trigger_mode") or "")
    if alert.stage == "forming":
        if mode == "raid_msb_or_fvg":
            return f"No trade. Wait for closed {trigger_tf} MSB or iFVG reclaim."
        if direction == "bullish":
            return f"No trade. Need closed {trigger_tf} candle above MSB high."
        if direction == "bearish":
            return f"No trade. Need closed {trigger_tf} candle below MSB low."
        return f"No trade. Wait for {trigger_tf} confirmation."
    if alert.stage == "confirmed":
        return "Plan active. Check entry, invalidation and targets."
    if alert.stage == "invalidated":
        return "Stand down. Do not chase."
    return "Review the chart."


def _first_detail(alert: Alert, prefixes: tuple[str, ...]) -> str:
    for detail in alert.details:
        text = str(detail)
        if text.startswith(prefixes):
            return text
    return ""


def _strip_label(line: str) -> str:
    if ":" not in line:
        return line
    return line.split(":", 1)[1].strip()


def _plan_lines(plan: dict, stage: str | None) -> list[str]:
    if not plan:
        return []
    labels = [
        ("entry", "Entry"),
        ("stop", "Invalid"),
        ("tp1", "TP1"),
        ("tp2", "TP2"),
        ("final_target", "Final"),
    ]
    lines = []
    for key, label in labels:
        if plan.get(key) is not None:
            lines.append(f"<b>{label}:</b> {_fmt_price(plan[key])}")
    risk = plan.get("risk")
    if risk is not None:
        lines.append(f"<b>Risk:</b> {_fmt_price(risk)}")
    if plan.get("rr_tp2") is not None:
        lines.append(f"<b>TP2 R:</b> {float(plan['rr_tp2']):.2f}R")
    if plan.get("rr_final") is not None:
        lines.append(f"<b>Final R:</b> {float(plan['rr_final']):.2f}R")
    if stage == "forming":
        return [line.replace("<b>Entry:</b>", "<b>Potential entry:</b>") for line in lines]
    return lines


def _quality_text(alert: Alert, line: str) -> str:
    plan = alert.trade_plan or {}
    base = _strip_label(line)
    score = plan.get("quality_score")
    max_score = plan.get("quality_max_score")
    if score is not None and max_score:
        return f"{base} ({int(score)}/{int(max_score)})"
    return base


def _bias_text(line: str) -> str:
    raw = _strip_label(line)
    if "PASSED" in raw and "BULLISH" in raw:
        return "Bullish HTF bias confirmed."
    if "PASSED" in raw and "BEARISH" in raw:
        return "Bearish HTF bias confirmed."
    if "WATCH ONLY" in raw:
        return "Watch only. HTF bias is not clean enough."
    if "BLOCKED" in raw:
        return "Blocked. HTF bias conflicts."
    return raw


def _clean_trader_line(text: str) -> str:
    replacements = {
        "HTF raid happened. No entry yet; wait for": "Context CRT done. Waiting for",
        "Context CRT happened. No entry yet; wait for": "Context CRT done. Waiting for",
        "the bot still does not place orders": "manual execution only",
        "YTL": "HTF",
    }
    cleaned = text
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    return cleaned


def _fmt_price(value: float | int | str) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return escape(str(value))
    if abs(number) >= 100:
        return f"{number:,.2f}"
    if abs(number) >= 1:
        return f"{number:,.5f}".rstrip("0").rstrip(".")
    return f"{number:.7f}".rstrip("0").rstrip(".")


def _fmt_rr(ratio: float | None) -> str:
    if ratio is None:
        return "—"
    return f"1:{ratio:.2f}"
