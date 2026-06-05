from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JOURNAL_PENDING = "pending"
JOURNAL_TAKEN = "taken"
JOURNAL_SKIPPED = "skipped"

VALID_STATUSES = {JOURNAL_PENDING, JOURNAL_TAKEN, JOURNAL_SKIPPED}

OUTCOME_NONE = "none"
OUTCOME_OPEN = "open"
OUTCOME_WIN = "win"
OUTCOME_LOSS = "loss"
OUTCOME_BREAKEVEN = "breakeven"

VALID_OUTCOMES = {OUTCOME_NONE, OUTCOME_OPEN, OUTCOME_WIN, OUTCOME_LOSS, OUTCOME_BREAKEVEN}

TRADE_DETAIL_FIELDS = (
    "outcome",
    "actual_entry",
    "actual_exit",
    "position_size",
    "r_result",
    "pnl_pct",
    "exit_reason",
    "decided_at",
    "closed_at",
)


def make_alert_key(
    setup_name: str,
    symbol: str,
    timeframe: str,
    stage: str,
    direction: str,
    profile: str,
    candle_timestamp_ms: int,
    signal_alert_id: str | None = None,
) -> str:
    base = "|".join(
        [
            setup_name,
            symbol,
            timeframe,
            stage or "alert",
            direction or "",
            profile or "",
            str(candle_timestamp_ms),
        ]
    )
    if signal_alert_id:
        return f"{base}|{signal_alert_id}"
    return base


def alert_snapshot(alert: Any) -> dict[str, Any]:
    trade_plan = getattr(alert, "trade_plan", None) or {}
    return {
        "time": datetime.now(timezone.utc).isoformat(),
        "setup_name": alert.setup_name,
        "symbol": alert.symbol,
        "timeframe": alert.timeframe,
        "stage": alert.stage or "alert",
        "direction": alert.direction or "",
        "profile": alert.profile or "",
        "close": alert.candle.close,
        "candle_timestamp_ms": alert.candle.timestamp_ms,
        "trigger_candle_timestamp_ms": (
            alert.trigger_candle.timestamp_ms
            if getattr(alert, "trigger_candle", None) is not None
            else alert.candle.timestamp_ms
        ),
        "context_timeframe": getattr(alert, "context_timeframe", None) or "",
        "trigger_timeframe": getattr(alert, "trigger_timeframe", None) or getattr(alert, "timeframe", "") or "",
        "details": list(getattr(alert, "details", []) or []),
        "trade_plan": trade_plan,
    }


def default_trade_fields() -> dict[str, Any]:
    return {
        "outcome": OUTCOME_NONE,
        "actual_entry": None,
        "actual_exit": None,
        "position_size": None,
        "r_result": None,
        "pnl_pct": None,
        "exit_reason": "",
        "decided_at": None,
        "closed_at": None,
    }


def _clear_execution_fields(entry: dict[str, Any]) -> None:
    for key in ("actual_entry", "actual_exit", "position_size", "r_result", "pnl_pct"):
        entry[key] = None
    entry["exit_reason"] = ""
    entry["closed_at"] = None


def compute_r_result(entry: dict[str, Any]) -> float | None:
    direction = entry.get("direction") or ""
    plan = entry.get("trade_plan") or {}
    entry_price = _to_float(entry.get("actual_entry"))
    if entry_price is None:
        entry_price = _to_float(plan.get("entry"))
    exit_price = _to_float(entry.get("actual_exit"))
    stop_price = _to_float(plan.get("stop"))

    if entry_price is None or stop_price is None or exit_price is None:
        return None

    risk = abs(entry_price - stop_price)
    if risk == 0:
        return None

    if direction == "bullish":
        reward = exit_price - entry_price
    elif direction == "bearish":
        reward = entry_price - exit_price
    else:
        return None

    return round(reward / risk, 2)


def compute_pnl_pct(entry: dict[str, Any]) -> float | None:
    direction = entry.get("direction") or ""
    plan = entry.get("trade_plan") or {}
    entry_price = _to_float(entry.get("actual_entry"))
    if entry_price is None:
        entry_price = _to_float(plan.get("entry"))
    exit_price = _to_float(entry.get("actual_exit"))

    if entry_price is None or exit_price is None or entry_price == 0:
        return None

    if direction == "bullish":
        pct = ((exit_price - entry_price) / entry_price) * 100
    elif direction == "bearish":
        pct = ((entry_price - exit_price) / entry_price) * 100
    else:
        return None

    return round(pct, 2)


def infer_outcome(r_result: float | None) -> str:
    if r_result is None:
        return OUTCOME_NONE
    if r_result > 0.05:
        return OUTCOME_WIN
    if r_result < -0.05:
        return OUTCOME_LOSS
    return OUTCOME_BREAKEVEN


@dataclass
class TradeJournalStore:
    path: Path
    entries: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "TradeJournalStore":
        if not path.exists():
            return cls(path=path)
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        entries = data.get("entries", {})
        if not isinstance(entries, dict):
            entries = {}
        return cls(path=path, entries=entries)

    def upsert_from_alert(self, alert_key: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        now = _now()
        existing = self.entries.get(alert_key)
        if existing is None:
            entry = {
                "alert_key": alert_key,
                "status": JOURNAL_PENDING,
                "notes": "",
                "created_at": now,
                "updated_at": now,
                **default_trade_fields(),
                **snapshot,
            }
            self.entries[alert_key] = entry
            self.save()
            return entry

        preserved = {key: existing[key] for key in ("status", "notes", "created_at", *TRADE_DETAIL_FIELDS) if key in existing}
        existing.update(snapshot)
        existing.update(preserved)
        existing["updated_at"] = now
        self.save()
        return existing

    def set_status(self, alert_key: str, status: str, notes: str | None = None) -> dict[str, Any]:
        if status not in VALID_STATUSES:
            raise ValueError(f"invalid journal status: {status!r}")

        entry = self.entries.get(alert_key)
        if entry is None:
            raise KeyError(f"journal entry not found: {alert_key}")

        previous = entry.get("status", JOURNAL_PENDING)
        entry["status"] = status
        if notes is not None:
            entry["notes"] = notes
        if previous == JOURNAL_PENDING and status in {JOURNAL_TAKEN, JOURNAL_SKIPPED}:
            entry["decided_at"] = _now()
        if status == JOURNAL_SKIPPED:
            entry["outcome"] = OUTCOME_NONE
            _clear_execution_fields(entry)
        elif status == JOURNAL_PENDING:
            entry["outcome"] = OUTCOME_NONE
            entry["decided_at"] = None
            _clear_execution_fields(entry)
        elif status == JOURNAL_TAKEN and entry.get("outcome") in (None, OUTCOME_NONE):
            entry["outcome"] = OUTCOME_OPEN
        entry["updated_at"] = _now()
        self.save()
        return entry

    def update_entry(self, alert_key: str, updates: dict[str, Any]) -> dict[str, Any]:
        entry = self.entries.get(alert_key)
        if entry is None:
            raise KeyError(f"journal entry not found: {alert_key}")

        status_changed = "status" in updates
        explicit_exit = "actual_exit" in updates

        if status_changed:
            status = updates["status"]
            if status not in VALID_STATUSES:
                raise ValueError(f"invalid journal status: {status!r}")
            previous = entry.get("status", JOURNAL_PENDING)
            if previous == JOURNAL_PENDING and status in {JOURNAL_TAKEN, JOURNAL_SKIPPED}:
                entry["decided_at"] = _now()

        for key in TRADE_DETAIL_FIELDS:
            if key not in updates:
                continue
            value = updates[key]
            if key == "outcome" and value not in VALID_OUTCOMES:
                raise ValueError(f"invalid outcome: {value!r}")
            if key in {"actual_entry", "actual_exit", "position_size", "r_result", "pnl_pct"}:
                entry[key] = _to_float(value) if value not in (None, "") else None
            else:
                entry[key] = value

        if status_changed:
            entry["status"] = updates["status"]
            if updates["status"] == JOURNAL_SKIPPED:
                entry["outcome"] = OUTCOME_NONE
                _clear_execution_fields(entry)
            elif updates["status"] == JOURNAL_PENDING:
                entry["outcome"] = OUTCOME_NONE
                entry["decided_at"] = None
                _clear_execution_fields(entry)

        if "notes" in updates:
            entry["notes"] = str(updates["notes"] or "")

        auto_r = updates.get("auto_compute")
        if explicit_exit and entry.get("actual_exit") is None:
            entry["pnl_pct"] = None
            if not auto_r and updates.get("r_result") in (None, ""):
                entry["r_result"] = None
            entry["closed_at"] = None

        if auto_r or (explicit_exit and entry.get("actual_exit") is not None):
            computed_r = compute_r_result(entry)
            if computed_r is not None:
                entry["r_result"] = computed_r
                if updates.get("outcome") in (None, OUTCOME_NONE) and entry.get("status") == JOURNAL_TAKEN:
                    entry["outcome"] = infer_outcome(computed_r)

        manual_r = _to_float(entry.get("r_result"))
        explicit_outcome = "outcome" in updates and updates.get("outcome") not in (None, "", OUTCOME_NONE)
        if (
            entry.get("status") == JOURNAL_TAKEN
            and manual_r is not None
            and not explicit_outcome
            and entry.get("outcome") in (None, OUTCOME_NONE, OUTCOME_OPEN)
        ):
            entry["outcome"] = infer_outcome(manual_r)

        if explicit_exit and entry.get("actual_exit") is not None:
            computed_pnl = compute_pnl_pct(entry)
            if computed_pnl is not None:
                entry["pnl_pct"] = computed_pnl
            if entry.get("closed_at") is None and entry.get("actual_exit") is not None:
                entry["closed_at"] = _now()

        if entry.get("status") == JOURNAL_TAKEN and entry.get("actual_exit") is None:
            if entry.get("outcome") in (None, OUTCOME_NONE):
                entry["outcome"] = OUTCOME_OPEN

        entry["updated_at"] = _now()
        self.save()
        return entry

    def get(self, alert_key: str) -> dict[str, Any] | None:
        entry = self.entries.get(alert_key)
        return dict(entry) if entry is not None else None

    def list_entries(
        self,
        limit: int = 200,
        status: str | None = None,
        symbol: str | None = None,
        setup: str | None = None,
        direction: str | None = None,
        outcome: str | None = None,
    ) -> list[dict[str, Any]]:
        items = list(self.entries.values())
        if status:
            items = [item for item in items if item.get("status") == status]
        if symbol:
            items = [item for item in items if item.get("symbol") == symbol]
        if setup:
            items = [item for item in items if item.get("setup_name") == setup]
        if direction:
            items = [item for item in items if item.get("direction") == direction]
        if outcome:
            items = [item for item in items if item.get("outcome") == outcome]

        items.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)
        items.sort(
            key=lambda item: {
                JOURNAL_PENDING: 0,
                JOURNAL_TAKEN: 1,
                JOURNAL_SKIPPED: 2,
            }.get(item.get("status", JOURNAL_PENDING), 3)
        )
        return items[:limit]

    def counts(self) -> dict[str, int]:
        counts = {JOURNAL_PENDING: 0, JOURNAL_TAKEN: 0, JOURNAL_SKIPPED: 0}
        for entry in self.entries.values():
            status = entry.get("status", JOURNAL_PENDING)
            if status in counts:
                counts[status] += 1
        counts["total"] = len(self.entries)
        return counts

    def stats(self) -> dict[str, Any]:
        taken = [entry for entry in self.entries.values() if entry.get("status") == JOURNAL_TAKEN]
        closed = [
            entry
            for entry in taken
            if _is_closed_for_stats(entry)
        ]
        open_trades = [entry for entry in taken if entry.get("outcome") == OUTCOME_OPEN and not _is_loss(entry)]
        evaluated = [
            entry
            for entry in taken
            if entry.get("outcome") in {OUTCOME_WIN, OUTCOME_LOSS, OUTCOME_BREAKEVEN, OUTCOME_OPEN}
            and _to_float(entry.get("r_result")) is not None
        ]
        efficient = [entry for entry in evaluated if _to_float(entry.get("r_result")) is not None and _to_float(entry.get("r_result")) > 0.05]
        wins = [entry for entry in closed if _is_win(entry)]
        losses = [entry for entry in closed if _is_loss(entry)]
        breakevens = [
            entry
            for entry in closed
            if entry.get("outcome") == OUTCOME_BREAKEVEN
            or (_to_float(entry.get("r_result")) is not None and not _is_win(entry) and not _is_loss(entry))
        ]
        r_values = [_to_float(entry.get("r_result")) for entry in closed]
        r_values = [value for value in r_values if value is not None]
        open_r_values = [_to_float(entry.get("r_result")) for entry in open_trades]
        open_r_values = [value for value in open_r_values if value is not None]
        pnl_values = [_to_float(entry.get("pnl_pct")) for entry in closed]
        pnl_values = [value for value in pnl_values if value is not None]

        closed_count = len(closed)
        win_rate = round((len(wins) / closed_count) * 100, 1) if closed_count else None
        efficiency_rate = round((len(efficient) / len(evaluated)) * 100, 1) if evaluated else None
        avg_r = round(sum(r_values) / len(r_values), 2) if r_values else None
        total_r = round(sum(r_values), 2) if r_values else None
        expectancy_r = avg_r
        best_r = round(max(r_values), 2) if r_values else None
        worst_r = round(min(r_values), 2) if r_values else None
        open_avg_r = round(sum(open_r_values) / len(open_r_values), 2) if open_r_values else None
        open_total_r = round(sum(open_r_values), 2) if open_r_values else None
        avg_pnl = round(sum(pnl_values) / len(pnl_values), 2) if pnl_values else None

        by_setup: dict[str, dict[str, int]] = {}
        by_symbol: dict[str, dict[str, int | float | None]] = {}
        by_grade: dict[str, dict[str, int | float | None]] = {}
        by_framework_grade: dict[str, dict[str, int | float | None]] = {}
        by_session: dict[str, dict[str, int | float | None]] = {}
        by_profile: dict[str, dict[str, int | float | None]] = {}
        by_direction: dict[str, dict[str, int | float | None]] = {}
        by_trigger: dict[str, dict[str, int | float | None]] = {}
        for entry in taken:
            setup = entry.get("setup_name") or "unknown"
            bucket = by_setup.setdefault(setup, {"taken": 0, "wins": 0, "losses": 0})
            bucket["taken"] += 1
            if _is_win(entry):
                bucket["wins"] += 1
            elif _is_loss(entry):
                bucket["losses"] += 1

            symbol = entry.get("symbol") or "unknown"
            _add_breakdown_trade(by_symbol, symbol, entry)
            plan = entry.get("trade_plan") or {}
            grade = str(plan.get("setup_grade") or "ungraded")
            _add_breakdown_trade(by_grade, grade, entry)
            fw_grade = str(entry.get("framework_grade") or "ungraded")
            _add_breakdown_trade(by_framework_grade, fw_grade, entry)
            _add_breakdown_trade(by_session, _session_bucket(entry), entry)
            _add_breakdown_trade(by_profile, _profile_bucket(entry), entry)
            _add_breakdown_trade(by_direction, _direction_bucket(entry), entry)
            _add_breakdown_trade(by_trigger, _trigger_bucket(plan), entry)

        return {
            "taken": len(taken),
            "closed": closed_count,
            "open": len(open_trades),
            "wins": len(wins),
            "losses": len(losses),
            "breakevens": len(breakevens),
            "win_rate": win_rate,
            "efficient": len(efficient),
            "evaluated": len(evaluated),
            "efficiency_rate": efficiency_rate,
            "avg_r": avg_r,
            "expectancy_r": expectancy_r,
            "total_r": total_r,
            "best_r": best_r,
            "worst_r": worst_r,
            "open_avg_r": open_avg_r,
            "open_total_r": open_total_r,
            "avg_pnl_pct": avg_pnl,
            "by_setup": by_setup,
            "by_symbol": _finalize_breakdown(by_symbol),
            "by_grade": _finalize_breakdown(by_grade),
            "by_framework_grade": _finalize_breakdown(by_framework_grade),
            "by_session": _finalize_breakdown(by_session),
            "by_profile": _finalize_breakdown(by_profile),
            "by_direction": _finalize_breakdown(by_direction),
            "by_trigger": _finalize_breakdown(by_trigger),
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump({"entries": self.entries}, handle, indent=2, sort_keys=True)


def _is_win(entry: dict[str, Any]) -> bool:
    r_result = _to_float(entry.get("r_result"))
    if r_result is not None:
        return r_result > 0.05
    return entry.get("outcome") == OUTCOME_WIN


def _is_loss(entry: dict[str, Any]) -> bool:
    r_result = _to_float(entry.get("r_result"))
    if r_result is not None:
        return r_result < -0.05
    return entry.get("outcome") == OUTCOME_LOSS


def _is_closed_for_stats(entry: dict[str, Any]) -> bool:
    if entry.get("outcome") in {OUTCOME_WIN, OUTCOME_LOSS, OUTCOME_BREAKEVEN}:
        return True
    r_result = _to_float(entry.get("r_result"))
    return r_result is not None and r_result < -0.05


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _session_bucket(entry: dict[str, Any]) -> str:
    """Classify a trade into an ICT killzone using its trigger candle time (UTC)."""
    ts = entry.get("trigger_candle_timestamp_ms") or entry.get("candle_timestamp_ms")
    ms = _to_float(ts)
    if ms is None:
        return "Unknown"
    try:
        moment = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return "Unknown"
    minutes = moment.hour * 60 + moment.minute
    if 0 <= minutes < 7 * 60:
        return "Asia"
    if 7 * 60 <= minutes < 10 * 60:
        return "London"
    if 12 * 60 + 30 <= minutes < 16 * 60:
        return "New York AM"
    return "Off-session"


def _profile_bucket(entry: dict[str, Any]) -> str:
    profile = entry.get("profile")
    if isinstance(profile, str) and profile.strip():
        return profile.strip()
    return "unknown"


def _direction_bucket(entry: dict[str, Any]) -> str:
    direction = entry.get("direction")
    if direction == "bullish":
        return "Long"
    if direction == "bearish":
        return "Short"
    return "unknown"


def _trigger_bucket(plan: dict[str, Any]) -> str:
    mode = str(plan.get("trigger_mode") or "").strip().lower()
    labels = {
        "msb": "MSB",
        "fvg": "FVG",
        "ifvg": "iFVG",
        "raid_msb_or_fvg": "Raid+MSB/FVG",
    }
    return labels.get(mode, mode.upper() if mode else "unknown")


def _add_breakdown_trade(target: dict[str, dict[str, Any]], key: str, entry: dict[str, Any]) -> None:
    bucket = target.setdefault(key, {"taken": 0, "wins": 0, "losses": 0, "open": 0, "total_r": 0.0, "r_count": 0})
    bucket["taken"] += 1
    if entry.get("outcome") == OUTCOME_OPEN:
        bucket["open"] += 1
    if _is_win(entry):
        bucket["wins"] += 1
    elif _is_loss(entry):
        bucket["losses"] += 1
    r_result = _to_float(entry.get("r_result"))
    if r_result is not None:
        bucket["total_r"] += r_result
        bucket["r_count"] += 1


def _finalize_breakdown(source: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    finalized: dict[str, dict[str, Any]] = {}
    for key, bucket in source.items():
        taken = int(bucket.get("taken") or 0)
        wins = int(bucket.get("wins") or 0)
        losses = int(bucket.get("losses") or 0)
        r_count = int(bucket.get("r_count") or 0)
        closed = wins + losses
        finalized[key] = {
            "taken": taken,
            "wins": wins,
            "losses": losses,
            "open": int(bucket.get("open") or 0),
            "win_rate": round((wins / closed) * 100, 1) if closed else None,
            "avg_r": round(float(bucket.get("total_r") or 0.0) / r_count, 2) if r_count else None,
            "total_r": round(float(bucket.get("total_r") or 0.0), 2) if r_count else None,
        }
    return finalized


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
