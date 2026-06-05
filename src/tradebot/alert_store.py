from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from tradebot.models import Alert


FORMING_EXPIRY_MINUTES = {
    "1m": 15,
    "3m": 30,
    "5m": 45,
    "15m": 120,
    "30m": 180,
    "1h": 480,
    "2h": 720,
    "4h": 1440,
    "1d": 4320,
}
PRICE_PRUNE_STAGES = {"forming", "confirmed"}


@dataclass
class PersistentAlertStore:
    path: Path
    alerts: list[dict[str, Any]] = field(default_factory=list)
    _next_id: int = 1

    @classmethod
    def load(cls, path: Path) -> "PersistentAlertStore":
        if not path.exists():
            return cls(path=path)
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        alerts = data.get("alerts", [])
        if not isinstance(alerts, list):
            alerts = []
        next_id = int(data.get("next_id") or 1)
        if alerts:
            next_id = max(next_id, max(int(item.get("id") or 0) for item in alerts) + 1)
        return cls(path=path, alerts=alerts, _next_id=next_id)

    def add(self, alert: Alert, delivered: bool, error: str | None = None) -> dict[str, Any]:
        item = _serialize_alert(alert, delivered, error)
        alert_key = item.get("alert_key")

        for index, existing in enumerate(self.alerts):
            if existing.get("dismissed"):
                continue
            if alert_key and existing.get("alert_key") == alert_key:
                if existing.get("stage") in {"confirmed", "invalidated"} and item.get("stage") == "forming":
                    existing["updated_at"] = _now()
                    self.alerts[index] = existing
                    self.save()
                    return existing
                existing.update(item)
                existing["id"] = existing.get("id")
                existing["dismissed"] = False
                existing["updated_at"] = _now()
                self.alerts[index] = existing
                self.save()
                return existing

        item["id"] = self._next_id
        self._next_id += 1
        item["dismissed"] = False
        item["created_at"] = item["time"]
        item["updated_at"] = item["time"]
        self.alerts.insert(0, item)
        self.save()
        return item

    def list_active(self, limit: int = 200, now: datetime | None = None) -> list[dict[str, Any]]:
        self.prune_expired_setups(now=now)
        active = [item for item in self.alerts if not item.get("dismissed")]
        active.sort(key=lambda item: item.get("time") or "", reverse=True)
        return active[:limit]

    def dismiss(self, alert_id: int) -> dict[str, Any] | None:
        for item in self.alerts:
            if int(item.get("id") or 0) != alert_id:
                continue
            item["dismissed"] = True
            item["dismissed_at"] = _now()
            self.save()
            return item
        return None

    def dismiss_missed_setups(
        self,
        *,
        setup_name: str,
        symbol: str,
        timeframe: str,
        profile: str,
        current_price: float,
        max_chase_atr: float = 0.75,
        max_chase_r: float = 0.75,
    ) -> list[dict[str, Any]]:
        dismissed: list[dict[str, Any]] = []
        for item in self.alerts:
            if item.get("dismissed") or not _matches_scope(item, setup_name, symbol, timeframe, profile):
                continue
            reason = _missed_by_price_reason(item, current_price, max_chase_atr, max_chase_r)
            if reason is None:
                continue
            item["dismissed"] = True
            item["dismissed_at"] = _now()
            item["dismissed_reason"] = reason
            item["missed_current_price"] = current_price
            dismissed.append(item)
        if dismissed:
            self.save()
        return dismissed

    def dismiss_inactive_forming_setups(
        self,
        *,
        setup_name: str,
        symbol: str,
        timeframe: str,
        profile: str,
        reason: str = "inactive_forming_setup",
    ) -> list[dict[str, Any]]:
        dismissed: list[dict[str, Any]] = []
        for item in self.alerts:
            if item.get("dismissed") or not _matches_scope(item, setup_name, symbol, timeframe, profile):
                continue
            if (item.get("stage") or "") != "forming":
                continue
            item["dismissed"] = True
            item["dismissed_at"] = _now()
            item["dismissed_reason"] = reason
            dismissed.append(item)
        if dismissed:
            self.save()
        return dismissed

    def dismiss_invalidated_setups(
        self,
        *,
        setup_name: str,
        symbol: str,
        timeframe: str,
        profile: str,
        current_price: float,
    ) -> list[dict[str, Any]]:
        dismissed: list[dict[str, Any]] = []
        for item in self.alerts:
            if item.get("dismissed") or not _matches_scope(item, setup_name, symbol, timeframe, profile):
                continue
            reason = _invalidated_by_price_reason(item, current_price)
            if reason is None:
                continue
            item["dismissed"] = True
            item["dismissed_at"] = _now()
            item["dismissed_reason"] = reason
            item["invalidated_current_price"] = current_price
            dismissed.append(item)
        if dismissed:
            self.save()
        return dismissed

    def prune_expired_setups(self, now: datetime | None = None) -> list[dict[str, Any]]:
        current_time = now or datetime.now(timezone.utc)
        expired: list[dict[str, Any]] = []
        for item in self.alerts:
            if item.get("dismissed") or not _is_expired_forming_alert(item, current_time):
                continue
            item["dismissed"] = True
            item["dismissed_at"] = _now()
            item["dismissed_reason"] = "expired_forming_setup"
            expired.append(item)
        if expired:
            self.save()
        return expired

    def count_active(self, now: datetime | None = None) -> int:
        self.prune_expired_setups(now=now)
        return sum(1 for item in self.alerts if not item.get("dismissed"))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(
                {"next_id": self._next_id, "alerts": self.alerts},
                handle,
                indent=2,
                sort_keys=True,
            )


def _serialize_alert(alert: Alert, delivered: bool, error: str | None) -> dict[str, Any]:
    return {
        "time": datetime.now(timezone.utc).isoformat(),
        "setup_name": alert.setup_name,
        "symbol": alert.symbol,
        "timeframe": alert.timeframe,
        "stage": alert.stage or "alert",
        "direction": alert.direction or "",
        "profile": alert.profile or "",
        "close": alert.candle.close,
        "open": alert.candle.open,
        "high": alert.candle.high,
        "low": alert.candle.low,
        "candle_timestamp_ms": alert.candle.timestamp_ms,
        "trigger_candle_timestamp_ms": (
            alert.trigger_candle.timestamp_ms
            if getattr(alert, "trigger_candle", None) is not None
            else alert.candle.timestamp_ms
        ),
        "context_timeframe": alert.context_timeframe or "",
        "trigger_timeframe": alert.trigger_timeframe or alert.timeframe or "",
        "details": alert.details,
        "delivered": delivered,
        "error": error,
        "telegram_enabled": bool(getattr(alert, "telegram_enabled", True)),
        "alert_key": alert.alert_key,
        "trade_plan": alert.trade_plan or {},
    }


def _matches_scope(item: dict[str, Any], setup_name: str, symbol: str, timeframe: str, profile: str) -> bool:
    if item.get("setup_name") != setup_name or item.get("symbol") != symbol:
        return False
    item_timeframe = item.get("trigger_timeframe") or item.get("timeframe") or ""
    if item_timeframe != timeframe:
        return False
    if profile and (item.get("profile") or "") != profile:
        return False
    return True


def _missed_by_price_reason(
    item: dict[str, Any],
    current_price: float,
    max_chase_atr: float,
    max_chase_r: float,
) -> str | None:
    if (item.get("stage") or "") not in PRICE_PRUNE_STAGES:
        return None
    plan = item.get("trade_plan") or {}
    direction = item.get("direction") or ""
    entry = _to_float(plan.get("entry"))
    if entry is None or direction not in {"bullish", "bearish"}:
        return None

    distance = current_price - entry if direction == "bullish" else entry - current_price
    if distance <= 0:
        return None

    limits: list[float] = []
    trigger_atr = _to_float(plan.get("trigger_atr"))
    risk = _to_float(plan.get("risk"))
    if trigger_atr is not None and trigger_atr > 0 and max_chase_atr > 0:
        limits.append(trigger_atr * max_chase_atr)
    if risk is not None and risk > 0 and max_chase_r > 0:
        limits.append(risk * max_chase_r)
    if not limits:
        return None

    limit = min(limits)
    if distance <= limit:
        return None
    return f"missed_chase: price moved {distance:.8g} from entry; limit {limit:.8g}"


def _invalidated_by_price_reason(item: dict[str, Any], current_price: float) -> str | None:
    if (item.get("stage") or "") not in PRICE_PRUNE_STAGES:
        return None
    plan = item.get("trade_plan") or {}
    direction = item.get("direction") or ""
    if direction not in {"bullish", "bearish"}:
        return None

    stop = _to_float(plan.get("stop"))
    if stop is not None:
        if direction == "bullish" and current_price <= stop:
            return f"stop_invalidated: price {current_price:.8g} traded at/below stop {stop:.8g}"
        if direction == "bearish" and current_price >= stop:
            return f"stop_invalidated: price {current_price:.8g} traded at/above stop {stop:.8g}"

    sweep_extreme = _to_float(plan.get("sweep_extreme"))
    if sweep_extreme is not None:
        if direction == "bullish" and current_price < sweep_extreme:
            return f"raid_invalidated: price {current_price:.8g} traded below sweep extreme {sweep_extreme:.8g}"
        if direction == "bearish" and current_price > sweep_extreme:
            return f"raid_invalidated: price {current_price:.8g} traded above sweep extreme {sweep_extreme:.8g}"

    structure_stop = _to_float(plan.get("structure_stop"))
    if structure_stop is not None:
        if direction == "bullish" and current_price < structure_stop:
            return f"structure_invalidated: price {current_price:.8g} traded below structure stop {structure_stop:.8g}"
        if direction == "bearish" and current_price > structure_stop:
            return f"structure_invalidated: price {current_price:.8g} traded above structure stop {structure_stop:.8g}"

    return None


def _is_expired_forming_alert(item: dict[str, Any], now: datetime) -> bool:
    if (item.get("stage") or "") != "forming":
        return False
    timestamp = _parse_datetime(item.get("updated_at") or item.get("created_at") or item.get("time"))
    if timestamp is None:
        return False
    timeframe = str(item.get("trigger_timeframe") or item.get("timeframe") or "").lower()
    expiry_minutes = FORMING_EXPIRY_MINUTES.get(timeframe)
    if expiry_minutes is None:
        expiry_minutes = 120
    return now - timestamp > timedelta(minutes=expiry_minutes)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
