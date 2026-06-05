from __future__ import annotations

from tradebot.config import ExchangeConfig
from tradebot.models import Candle


class ExchangeClient:
    def __init__(self, config: ExchangeConfig):
        import ccxt

        exchange_class = getattr(ccxt, config.id, None)
        if exchange_class is None:
            raise ValueError(f"Unsupported exchange id: {config.id}")

        options = {
            "enableRateLimit": True,
            "timeout": config.timeout_ms,
        }
        if config.market_type:
            options["options"] = {"defaultType": config.market_type}

        self.exchange = exchange_class(options)
        self.exchange.load_markets()

    def fetch_candles(
        self,
        symbol: str,
        timeframe: str,
        limit: int,
        since_ms: int | None = None,
    ) -> list[Candle]:
        if since_ms is not None:
            rows = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since_ms, limit=limit)
        else:
            rows = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        return [
            Candle(
                timestamp_ms=int(row[0]),
                open=float(row[1]),
                high=float(row[2]),
                low=float(row[3]),
                close=float(row[4]),
                volume=float(row[5]),
            )
            for row in rows
        ]

