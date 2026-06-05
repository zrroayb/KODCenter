from __future__ import annotations

import time
from urllib.parse import quote

import requests

from tradebot.config import ExchangeConfig
from tradebot.models import Candle


class ExchangeClient:
    def __init__(self, config: ExchangeConfig):
        import ccxt

        self.config = config
        self._ccxt = ccxt
        self._exchanges: dict[str, object] = {}
        self._last_provider_by_symbol: dict[str, str] = {}

    def fetch_candles(
        self,
        symbol: str,
        timeframe: str,
        limit: int,
        since_ms: int | None = None,
    ) -> list[Candle]:
        external = self.config.external_symbols.get(symbol)
        if external:
            candles = self._fetch_external_candles(symbol, external, timeframe, limit, since_ms=since_ms)
            self._last_provider_by_symbol[symbol] = external
            return candles

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

    def _fetch_external_candles(
        self,
        symbol: str,
        provider: str,
        timeframe: str,
        limit: int,
        since_ms: int | None = None,
    ) -> list[Candle]:
        provider_name, _, provider_symbol = provider.partition(":")
        if provider_name == "yahoo" and provider_symbol:
            return _fetch_yahoo_candles(provider_symbol, timeframe, limit, since_ms=since_ms, timeout_ms=self.config.timeout_ms)
        raise ValueError(f"Unsupported external provider for {symbol}: {provider}")

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


def _fetch_yahoo_candles(
    yahoo_symbol: str,
    timeframe: str,
    limit: int,
    since_ms: int | None = None,
    timeout_ms: int = 10000,
) -> list[Candle]:
    if timeframe == "4h":
        candles = _fetch_yahoo_candles(yahoo_symbol, "1h", max(limit * 4 + 8, 80), since_ms=since_ms, timeout_ms=timeout_ms)
        return _aggregate_candles(candles, 4 * 60 * 60 * 1000)[-limit:]

    interval = _yahoo_interval(timeframe)
    now = int(time.time())
    if since_ms is not None:
        period1 = max(0, int(since_ms // 1000))
    else:
        period1 = max(0, now - _yahoo_lookback_seconds(timeframe, limit))
    params = {
        "period1": period1,
        "period2": now + 24 * 60 * 60,
        "interval": interval,
        "includePrePost": "true",
        "events": "history",
    }
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(yahoo_symbol, safe='')}"
    response = requests.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=max(5, timeout_ms / 1000))
    response.raise_for_status()
    payload = response.json()
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"Yahoo chart error for {yahoo_symbol}: {chart['error']}")
    result = (chart.get("result") or [None])[0]
    if not result:
        return []
    timestamps = result.get("timestamp") or []
    quote_data = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    candles: list[Candle] = []
    for index, timestamp in enumerate(timestamps):
        try:
            open_ = quote_data.get("open", [])[index]
            high = quote_data.get("high", [])[index]
            low = quote_data.get("low", [])[index]
            close = quote_data.get("close", [])[index]
            volume_values = quote_data.get("volume") or []
            volume = volume_values[index] if index < len(volume_values) and volume_values[index] is not None else 0
        except IndexError:
            continue
        if open_ is None or high is None or low is None or close is None:
            continue
        candles.append(
            Candle(
                timestamp_ms=int(timestamp) * 1000,
                open=float(open_),
                high=float(high),
                low=float(low),
                close=float(close),
                volume=float(volume),
            )
        )
    return candles[-limit:]


def _yahoo_interval(timeframe: str) -> str:
    if timeframe in {"15m", "1h", "1d"}:
        return timeframe
    raise ValueError(f"Unsupported Yahoo timeframe: {timeframe}")


def _yahoo_lookback_seconds(timeframe: str, limit: int) -> int:
    if timeframe == "15m":
        return min(59 * 24 * 60 * 60, max(7 * 24 * 60 * 60, limit * 15 * 60 * 3))
    if timeframe == "1h":
        return min(59 * 24 * 60 * 60, max(14 * 24 * 60 * 60, limit * 60 * 60 * 3))
    if timeframe == "1d":
        return max(90 * 24 * 60 * 60, limit * 24 * 60 * 60 * 2)
    return 30 * 24 * 60 * 60


def _aggregate_candles(candles: list[Candle], bucket_ms: int) -> list[Candle]:
    buckets: dict[int, list[Candle]] = {}
    for candle in candles:
        bucket = (candle.timestamp_ms // bucket_ms) * bucket_ms
        buckets.setdefault(bucket, []).append(candle)
    aggregated: list[Candle] = []
    for timestamp in sorted(buckets):
        items = buckets[timestamp]
        aggregated.append(
            Candle(
                timestamp_ms=timestamp,
                open=items[0].open,
                high=max(item.high for item in items),
                low=min(item.low for item in items),
                close=items[-1].close,
                volume=sum(item.volume for item in items),
            )
        )
    return aggregated
