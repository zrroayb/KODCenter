from pathlib import Path

import pytest

from tradebot.journal import JOURNAL_SKIPPED, JOURNAL_TAKEN, OUTCOME_LOSS, OUTCOME_NONE, OUTCOME_OPEN, TradeJournalStore, make_alert_key
from tradebot.models import Alert, Candle


def test_make_alert_key_is_stable():
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 123456, "kod:intraday:bullish:confirmed")
    assert "BTC/USDT" in key
    assert "confirmed" in key


def test_journal_upsert_and_update_status(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)

    store.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "setup_name": "kod",
            "trade_plan": {"rr_tp1": 1.0, "rr_tp2": 2.0},
        },
    )
    entry = store.set_status(key, JOURNAL_TAKEN, notes="limit girdim")

    assert entry["status"] == JOURNAL_TAKEN
    assert entry["notes"] == "limit girdim"
    assert store.counts()["taken"] == 1


def test_journal_rejects_invalid_status(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(key, {"symbol": "BTC/USDT"})

    with pytest.raises(ValueError):
        store.set_status(key, "invalid")


def test_confirmed_signal_includes_rr_details():
    from tradebot.config import SetupConfig
    from tradebot.kod import KodTurtleSoupEvaluator

    profile = {"name": "intraday", "context_timeframe": "4h", "trigger_timeframe": "15m"}
    setup = SetupConfig(
        name="kod",
        enabled=True,
        cooldown_minutes=45,
        type="kod_turtle_soup",
        params={"profiles": [profile], "alert_stages": ["confirmed"]},
    )

    context = [_candle(index, 106, 108, 104, 106) for index in range(60)]
    context[35] = _candle(35, 106, 110, 104, 107)
    context[-1] = _candle(59, 107, 108.8, 104.8, 108.5)

    trigger = [_candle(index, 103, 104, 102, 103) for index in range(24)]
    trigger[10] = _candle(10, 102, 103, 100, 102)
    trigger.append(_candle(24, 99.5, 103, 99, 101))

    signals = KodTurtleSoupEvaluator().evaluate(setup, profile, context, trigger)
    assert len(signals) == 1
    assert signals[0].trade_plan is not None
    assert signals[0].trade_plan["rr_tp1"] == pytest.approx(1.0)
    assert any("RR TP1" in detail for detail in signals[0].details)


def test_journal_update_entry_trade_details(tmp_path: Path):
    from tradebot.journal import OUTCOME_WIN, compute_r_result

    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "direction": "bullish",
            "trade_plan": {"entry": 100.0, "stop": 98.0, "rr_tp1": 1.0},
        },
    )

    entry = store.update_entry(
        key,
        {
            "status": JOURNAL_TAKEN,
            "actual_entry": 100.5,
            "actual_exit": 103.0,
            "notes": "TP1 aldım",
            "auto_compute": True,
        },
    )

    assert entry["status"] == JOURNAL_TAKEN
    assert entry["notes"] == "TP1 aldım"
    assert entry["r_result"] == pytest.approx(1.0)
    assert entry["outcome"] == OUTCOME_WIN
    assert entry["pnl_pct"] == pytest.approx(2.49, rel=0.01)
    assert compute_r_result(entry) == pytest.approx(1.0)


def test_journal_taken_without_exit_is_open_trade(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "direction": "bullish",
            "trade_plan": {"entry": 100.0, "stop": 98.0},
        },
    )

    entry = store.update_entry(key, {"status": JOURNAL_TAKEN, "actual_entry": 100.0})

    assert entry["outcome"] == OUTCOME_OPEN
    assert store.stats()["open"] == 1


def test_negative_manual_r_is_counted_as_loss(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "setup_name": "kod",
            "direction": "bullish",
            "trade_plan": {"entry": 100.0, "stop": 98.0},
        },
    )

    entry = store.update_entry(key, {"status": JOURNAL_TAKEN, "r_result": -0.75})
    stats = store.stats()

    assert entry["outcome"] == OUTCOME_LOSS
    assert stats["closed"] == 1
    assert stats["losses"] == 1
    assert stats["open"] == 0
    assert stats["total_r"] == -0.75


def test_legacy_open_negative_r_is_counted_as_loss_in_stats(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "ETH/USDT", "15m", "confirmed", "bearish", "intraday", 2)
    store.upsert_from_alert(key, {"symbol": "ETH/USDT", "setup_name": "kod", "direction": "bearish"})
    store.update_entry(key, {"status": JOURNAL_TAKEN, "outcome": OUTCOME_OPEN, "r_result": -1.0})

    stats = store.stats()

    assert stats["closed"] == 1
    assert stats["losses"] == 1
    assert stats["open"] == 0
    assert stats["worst_r"] == -1.0


def test_r_value_overrides_wrong_manual_outcome_in_stats(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(key, {"symbol": "BTC/USDT", "setup_name": "kod", "direction": "bullish"})
    store.update_entry(key, {"status": JOURNAL_TAKEN, "outcome": "win", "r_result": -1.0})

    stats = store.stats()

    assert stats["wins"] == 0
    assert stats["losses"] == 1
    assert stats["win_rate"] == 0.0


def test_journal_clears_execution_when_trade_is_skipped(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    store.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "direction": "bullish",
            "trade_plan": {"entry": 100.0, "stop": 98.0},
        },
    )
    store.update_entry(
        key,
        {
            "status": JOURNAL_TAKEN,
            "actual_entry": 100.0,
            "actual_exit": 104.0,
            "auto_compute": True,
        },
    )

    entry = store.update_entry(key, {"status": JOURNAL_SKIPPED})

    assert entry["outcome"] == OUTCOME_NONE
    assert entry["actual_entry"] is None
    assert entry["actual_exit"] is None
    assert entry["r_result"] is None
    assert entry["pnl_pct"] is None


def test_journal_stats_and_filters(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key_win = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    key_skip = make_alert_key("kod", "ETH/USDT", "15m", "confirmed", "bearish", "intraday", 2)

    store.upsert_from_alert(key_win, {"symbol": "BTC/USDT", "setup_name": "kod", "direction": "bullish"})
    store.update_entry(key_win, {"status": JOURNAL_TAKEN, "r_result": 2.0, "outcome": "win"})
    store.upsert_from_alert(key_skip, {"symbol": "ETH/USDT", "setup_name": "kod", "direction": "bearish"})
    store.set_status(key_skip, JOURNAL_SKIPPED)

    stats = store.stats()
    assert stats["taken"] == 1
    assert stats["wins"] == 1
    assert stats["win_rate"] == 100.0
    assert stats["efficient"] == 1
    assert stats["efficiency_rate"] == 100.0
    assert stats["by_symbol"]["BTC/USDT"]["taken"] == 1
    assert stats["by_symbol"]["BTC/USDT"]["total_r"] == 2.0
    assert stats["by_grade"]["ungraded"]["taken"] == 1

    filtered = store.list_entries(symbol="ETH/USDT", status=JOURNAL_SKIPPED)
    assert len(filtered) == 1
    assert filtered[0]["symbol"] == "ETH/USDT"


def test_journal_tracks_open_running_r_separately(tmp_path: Path):
    store = TradeJournalStore.load(tmp_path / "journal.json")
    key_open = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    key_loss = make_alert_key("kod", "ETH/USDT", "15m", "confirmed", "bearish", "intraday", 2)

    store.upsert_from_alert(key_open, {"symbol": "BTC/USDT", "setup_name": "kod", "direction": "bullish"})
    store.update_entry(key_open, {"status": JOURNAL_TAKEN, "outcome": OUTCOME_OPEN, "r_result": 1.25})
    store.upsert_from_alert(key_loss, {"symbol": "ETH/USDT", "setup_name": "kod", "direction": "bearish"})
    store.update_entry(key_loss, {"status": JOURNAL_TAKEN, "outcome": OUTCOME_LOSS, "r_result": -1.0})

    stats = store.stats()
    assert stats["taken"] == 2
    assert stats["closed"] == 1
    assert stats["open"] == 1
    assert stats["open_total_r"] == 1.25
    assert stats["open_avg_r"] == 1.25
    assert stats["efficient"] == 1
    assert stats["efficiency_rate"] == 50.0


def test_web_journal_endpoint(tmp_path: Path):
    from tradebot.web import create_app
    from tradebot.web.runtime import BotController

    journal_file = tmp_path / "journal.json"
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        journal_file=journal_file,
        dry_run=True,
    )
    key = make_alert_key("kod", "BTC/USDT", "15m", "confirmed", "bullish", "intraday", 1)
    controller.journal.upsert_from_alert(
        key,
        {
            "symbol": "BTC/USDT",
            "setup_name": "kod",
            "direction": "bullish",
            "trade_plan": {"entry": 100.0, "stop": 98.0},
        },
    )
    app = create_app(controller)
    client = app.test_client()

    response = client.get("/api/journal")
    assert response.status_code == 200
    assert response.get_json()["counts"]["total"] == 1

    response = client.post(
        f"/api/journal/{key}",
        json={"status": JOURNAL_SKIPPED, "notes": "setup geç"},
    )
    assert response.status_code == 200
    assert response.get_json()["ok"] is True
    assert controller.journal.get(key)["status"] == JOURNAL_SKIPPED

    response = client.post(
        f"/api/journal/{key}",
        json={"status": JOURNAL_TAKEN, "actual_entry": 100, "actual_exit": 102, "auto_compute": True},
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["entry"]["r_result"] is not None

    response = client.get("/api/journal?status=taken")
    assert response.status_code == 200
    assert response.get_json()["stats"]["taken"] >= 1


def _candle(index, open_, high, low, close, volume=100):
    return Candle(
        timestamp_ms=index * 60_000,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
    )
