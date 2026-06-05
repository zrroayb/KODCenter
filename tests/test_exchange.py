from __future__ import annotations

from tradebot.config import ExchangeConfig
from tradebot.exchange import ExchangeClient


class FakeYahooResponse:
    def __init__(self, timestamps: list[int]):
        self.timestamps = timestamps

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        opens = [100 + index for index, _ in enumerate(self.timestamps)]
        return {
            "chart": {
                "result": [
                    {
                        "timestamp": self.timestamps,
                        "indicators": {
                            "quote": [
                                {
                                    "open": opens,
                                    "high": [value + 3 for value in opens],
                                    "low": [value - 2 for value in opens],
                                    "close": [value + 1 for value in opens],
                                    "volume": [10 + index for index, _ in enumerate(self.timestamps)],
                                }
                            ]
                        },
                    }
                ],
                "error": None,
            }
        }


def test_exchange_routes_external_nas100_to_yahoo(monkeypatch):
    calls = []

    def fake_get(url, params, headers, timeout):
        calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        return FakeYahooResponse([1_800_000, 2_700_000, 3_600_000])

    monkeypatch.setattr("tradebot.exchange.requests.get", fake_get)
    client = ExchangeClient(ExchangeConfig(id="missing", external_symbols={"NAS100": "yahoo:NQ=F"}))

    candles = client.fetch_candles("NAS100", "15m", 2)

    assert calls[0]["url"].endswith("/NQ%3DF")
    assert calls[0]["params"]["interval"] == "15m"
    assert len(candles) == 2
    assert candles[-1].timestamp_ms == 3_600_000_000
    assert candles[-1].close == 103


def test_yahoo_four_hour_candles_are_aggregated(monkeypatch):
    def fake_get(url, params, headers, timeout):
        assert params["interval"] == "1h"
        return FakeYahooResponse([index * 3_600 for index in range(8)])

    monkeypatch.setattr("tradebot.exchange.requests.get", fake_get)
    client = ExchangeClient(ExchangeConfig(id="missing", external_symbols={"NAS100": "yahoo:NQ=F"}))

    candles = client.fetch_candles("NAS100", "4h", 2)

    assert len(candles) == 2
    assert candles[0].open == 100
    assert candles[0].high == 106
    assert candles[0].low == 98
    assert candles[0].close == 104
    assert candles[0].volume == 46
    assert candles[1].open == 104
    assert candles[1].close == 108
