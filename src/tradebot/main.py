from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

from dotenv import load_dotenv

from tradebot.config import ConfigError, load_config
from tradebot.exchange import ExchangeClient
from tradebot.scanner import Scanner
from tradebot.state import StateStore
from tradebot.telegram import TelegramNotifier


def main() -> None:
    args = _parse_args()
    load_dotenv(args.env_file)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    try:
        config = load_config(args.config)
    except ConfigError as exc:
        raise SystemExit(f"Config error: {exc}") from exc

    exchange = ExchangeClient(config.exchange)
    notifier = TelegramNotifier(config.telegram, force_dry_run=args.dry_run)
    state = StateStore.load(args.state_file)
    scanner = Scanner(config, exchange, notifier, state)

    if args.once:
        alert_count = scanner.scan_once()
        logging.info("scan complete: %s alert(s)", alert_count)
        return

    logging.info("scanner started; press Ctrl+C to stop")
    while True:
        alert_count = scanner.scan_once()
        logging.info("scan complete: %s alert(s)", alert_count)
        time.sleep(config.scanner.poll_seconds)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Telegram trade setup alert bot")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--state-file", type=Path, default=Path(".tradebot_state.json"))
    parser.add_argument("--once", action="store_true", help="run one scan and exit")
    parser.add_argument("--dry-run", action="store_true", help="print alerts instead of sending Telegram messages")
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    return parser.parse_args()


if __name__ == "__main__":
    main()

