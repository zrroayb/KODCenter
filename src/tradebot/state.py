from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


@dataclass
class StateStore:
    path: Path
    data: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "StateStore":
        if not path.exists():
            return cls(path=path)
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return cls(path=path, data=data)

    def should_alert(
        self,
        setup_name: str,
        symbol: str,
        timeframe: str,
        candle_timestamp_ms: int,
        cooldown_minutes: int,
        alert_id: str | None = None,
    ) -> bool:
        key = self._key(setup_name, symbol, timeframe, alert_id)
        previous = self.data.get(key)
        if previous is None:
            return True

        if int(previous.get("candle_timestamp_ms", 0)) == candle_timestamp_ms:
            return False

        last_sent_at = datetime.fromisoformat(previous["sent_at"])
        return datetime.now(timezone.utc) - last_sent_at >= timedelta(minutes=cooldown_minutes)

    def mark_alerted(
        self,
        setup_name: str,
        symbol: str,
        timeframe: str,
        candle_timestamp_ms: int,
        alert_id: str | None = None,
    ) -> None:
        key = self._key(setup_name, symbol, timeframe, alert_id)
        self.data[key] = {
            "candle_timestamp_ms": candle_timestamp_ms,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(self.data, handle, indent=2, sort_keys=True)

    def _key(self, setup_name: str, symbol: str, timeframe: str, alert_id: str | None = None) -> str:
        base = f"{setup_name}:{symbol}:{timeframe}"
        if alert_id is None:
            return base
        return f"{base}:{alert_id}"
