from types import SimpleNamespace

from tradebot.analysis import ANALYSIS_TIMEFRAMES
from tradebot.models import Candle
from tradebot.scanner import Scanner


def test_scanner_builds_framework_context_from_all_analysis_timeframes():
    exchange = _FakeExchange()
    config = SimpleNamespace(scanner=SimpleNamespace(candle_limit=80, use_closed_candle=False))
    scanner = Scanner(config, exchange, notifier=object(), state=object())

    context = scanner._build_framework_context("BTC/USDT", {})

    assert context is not None
    assert [timeframe for _, timeframe, _ in exchange.requests] == list(ANALYSIS_TIMEFRAMES)
    assert context["asset"] == "BTC/USDT"
    assert "timeframes" in context


class _FakeExchange:
    def __init__(self):
        self.requests = []

    def fetch_candles(self, symbol, timeframe, limit):
        self.requests.append((symbol, timeframe, limit))
        return [_candle(index, 100 + index * 0.1) for index in range(limit)]


def _candle(index, close):
    return Candle(
        timestamp_ms=index * 60_000,
        open=close - 0.05,
        high=close + 0.3,
        low=close - 0.3,
        close=close,
        volume=100,
    )
