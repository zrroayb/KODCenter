from __future__ import annotations

from tradebot.config import ExchangeConfig
from tradebot.models import Candle


class ExchangeClient:
    def __init__(self, config: ExchangeConfig):
        import ccxt

        self.config = config
        self._ccxt = ccxt
        self._exchanges: dict[str, object] = {}
        self._last_provider_by_symbol: dict[str, str] = {}
        self._get_exchange(config.id)

    def fetch_candles(
        self,
        symbol: str,
        timeframe: str,
        limit: int,
        since_ms: int | None = None,
    ) -> list[Candle]:
        errors: list[str] = []
        for exchange_id in self._candidate_exchange_ids(symbol):
            try:
                exchange = self._get_exchange(exchange_id)
                if not self._exchange_has_symbol(exchange, symbol):
                    errors.append(f"{exchange_id}: symbol not listed")
                    continue
                if since_ms is not None:
                    rows = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since_ms, limit=limit)
                else:
                    rows = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
                self._last_provider_by_symbol[symbol] = exchange_id
                return _rows_to_candles(rows)
            except Exception as exc:
                errors.append(f"{exchange_id}: {type(exc).__name__} {str(exc)[:180]}")
                continue
        provider_text = "; ".join(errors[-6:]) if errors else "no provider candidates"
        raise RuntimeError(f"No candle provider returned {symbol} {timeframe}. {provider_text}")

    def _candidate_exchange_ids(self, symbol: str) -> list[str]:
        ordered: list[str] = []
        for exchange_id in self.config.symbol_exchanges.get(symbol, ()):
            if exchange_id not in ordered:
                ordered.append(exchange_id)
        for exchange_id in (self.config.id, *self.config.fallback_ids):
            if exchange_id not in ordered:
                ordered.append(exchange_id)
        return ordered

    def _get_exchange(self, exchange_id: str):
        if exchange_id in self._exchanges:
            return self._exchanges[exchange_id]
        exchange_class = getattr(self._ccxt, exchange_id, None)
        if exchange_class is None:
            raise ValueError(f"Unsupported exchange id: {exchange_id}")
        options = {
            "enableRateLimit": True,
            "timeout": self.config.timeout_ms,
        }
        if self.config.market_type:
            options["options"] = {"defaultType": self.config.market_type}
        exchange = exchange_class(options)
        exchange.load_markets()
        self._exchanges[exchange_id] = exchange
        return exchange

    @staticmethod
    def _exchange_has_symbol(exchange, symbol: str) -> bool:
        markets = getattr(exchange, "markets", None)
        if not markets:
            return True
        return symbol in markets


def _rows_to_candles(rows) -> list[Candle]:
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
