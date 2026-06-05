from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramConfig:
    bot_token_env: str = "TELEGRAM_BOT_TOKEN"
    chat_id_env: str = "TELEGRAM_CHAT_ID"
    dry_run: bool = False


@dataclass(frozen=True)
class ExchangeConfig:
    id: str = "binance"
    market_type: str = "spot"
    timeout_ms: int = 10000


@dataclass(frozen=True)
class ScannerConfig:
    timeframe: str = "15m"
    poll_seconds: int = 60
    candle_limit: int = 250
    use_closed_candle: bool = True
    symbols: tuple[str, ...] = ()


@dataclass(frozen=True)
class SetupConfig:
    name: str
    enabled: bool
    cooldown_minutes: int
    type: str = "conditions"
    conditions: dict[str, Any] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AppConfig:
    telegram: TelegramConfig
    exchange: ExchangeConfig
    scanner: ScannerConfig
    setups: tuple[SetupConfig, ...]


def load_config(path: Path) -> AppConfig:
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}")

    with path.open("r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle) or {}

    telegram_raw = raw.get("telegram", {})
    exchange_raw = raw.get("exchange", {})
    scanner_raw = raw.get("scanner", {})
    setups_raw = raw.get("setups", [])

    if not scanner_raw.get("symbols"):
        raise ConfigError("scanner.symbols must contain at least one market symbol")
    if not setups_raw:
        raise ConfigError("setups must contain at least one setup")

    scanner = ScannerConfig(
        timeframe=str(scanner_raw.get("timeframe", "15m")),
        poll_seconds=int(scanner_raw.get("poll_seconds", 60)),
        candle_limit=int(scanner_raw.get("candle_limit", 250)),
        use_closed_candle=bool(scanner_raw.get("use_closed_candle", True)),
        symbols=tuple(str(symbol) for symbol in scanner_raw["symbols"]),
    )

    if scanner.poll_seconds < 10:
        raise ConfigError("scanner.poll_seconds should be at least 10 seconds")
    if scanner.candle_limit < 50:
        raise ConfigError("scanner.candle_limit should be at least 50 candles")

    setups = []
    for item in setups_raw:
        name = str(item.get("name", "")).strip()
        if not name:
            raise ConfigError("each setup needs a non-empty name")
        setup_type = str(item.get("type", "conditions")).strip() or "conditions"
        conditions = item.get("conditions", {})
        if setup_type == "conditions" and not isinstance(conditions, dict):
            raise ConfigError(f"setup {name!r} needs a conditions object")
        if setup_type == "kod_turtle_soup":
            _validate_kod_setup(name, item)
        elif setup_type != "conditions":
            raise ConfigError(f"unsupported setup type for {name!r}: {setup_type!r}")

        params = {
            key: value
            for key, value in item.items()
            if key not in {"name", "enabled", "cooldown_minutes", "type", "conditions"}
        }
        setups.append(
            SetupConfig(
                name=name,
                enabled=bool(item.get("enabled", True)),
                cooldown_minutes=int(item.get("cooldown_minutes", 60)),
                type=setup_type,
                conditions=conditions if isinstance(conditions, dict) else {},
                params=params,
            )
        )

    return AppConfig(
        telegram=TelegramConfig(
            bot_token_env=str(telegram_raw.get("bot_token_env", "TELEGRAM_BOT_TOKEN")),
            chat_id_env=str(telegram_raw.get("chat_id_env", "TELEGRAM_CHAT_ID")),
            dry_run=bool(telegram_raw.get("dry_run", False)),
        ),
        exchange=ExchangeConfig(
            id=str(exchange_raw.get("id", "binance")),
            market_type=str(exchange_raw.get("market_type", "spot")),
            timeout_ms=int(exchange_raw.get("timeout_ms", 10000)),
        ),
        scanner=scanner,
        setups=tuple(setups),
    )


def _validate_kod_setup(name: str, item: dict[str, Any]) -> None:
    profiles = item.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise ConfigError(f"setup {name!r} needs at least one KOD profile")

    for profile in profiles:
        if not isinstance(profile, dict):
            raise ConfigError(f"setup {name!r} profiles must be objects")
        if not profile.get("context_timeframe"):
            raise ConfigError(f"setup {name!r} profile needs context_timeframe")
        if not profile.get("trigger_timeframe"):
            raise ConfigError(f"setup {name!r} profile needs trigger_timeframe")
