from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class Candle:
    timestamp_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def opened_at(self) -> datetime:
        return datetime.fromtimestamp(self.timestamp_ms / 1000, tz=timezone.utc)


@dataclass(frozen=True)
class Alert:
    setup_name: str
    symbol: str
    timeframe: str
    candle: Candle
    details: list[str]
    stage: str | None = None
    direction: str | None = None
    profile: str | None = None
    context_timeframe: str | None = None
    trigger_timeframe: str | None = None
    trade_plan: dict[str, Any] | None = None
    alert_key: str | None = None
    signal_alert_id: str | None = None
    trigger_candle: Candle | None = None
    chart_png: bytes | None = None
    chart_caption: str | None = None
    telegram_enabled: bool = True
