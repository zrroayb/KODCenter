from pathlib import Path
from datetime import datetime, timedelta, timezone

from tradebot.alert_store import PersistentAlertStore
from tradebot.models import Alert, Candle
from tradebot.web.runtime import AlertStore


def test_persistent_alerts_survive_reload(tmp_path: Path):
    path = tmp_path / "alerts.json"
    store = AlertStore.load(path)
    alert = Alert(
        setup_name="kod",
        symbol="BTC/USDT",
        timeframe="15m",
        candle=Candle(1, 1, 2, 0.5, 1.5, 100),
        details=["test"],
        alert_key="btc-key",
    )
    store.add(alert, delivered=True)

    reloaded = AlertStore.load(path)
    assert reloaded.count() == 1
    assert reloaded.list_active()[0]["symbol"] == "BTC/USDT"


def test_dismissed_alerts_hidden_until_user_removes(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    alert = Alert(
        setup_name="kod",
        symbol="ETH/USDT",
        timeframe="5m",
        candle=Candle(2, 1, 2, 0.5, 1.5, 100),
        details=["test"],
        alert_key="eth-key",
    )
    item = store.add(alert, delivered=True)
    assert store.count() == 1

    store.dismiss(item["id"])
    assert store.count() == 0
    assert len(store.list_active()) == 0

    reloaded = AlertStore.load(tmp_path / "alerts.json")
    assert reloaded.count() == 0


def test_same_alert_key_updates_existing_active_alert(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    candle = Candle(3, 1, 2, 0.5, 1.5, 100)
    alert = Alert(
        setup_name="kod",
        symbol="BTC/USDT",
        timeframe="15m",
        candle=candle,
        details=["first"],
        alert_key="same-key",
    )
    first = store.add(alert, delivered=True)
    second = store.add(alert, delivered=True)

    assert first["id"] == second["id"]
    assert store.count() == 1


def test_lifecycle_forming_does_not_downgrade_confirmed_alert(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    key = "kod|BTC/USDT|swing|bullish|123"
    confirmed = store.add(
        Alert(
            setup_name="kod",
            symbol="BTC/USDT",
            timeframe="1h",
            candle=Candle(10, 1, 2, 0.5, 1.5, 100),
            details=["confirmed"],
            stage="confirmed",
            direction="bullish",
            profile="swing",
            alert_key=key,
        ),
        delivered=True,
    )
    downgraded = store.add(
        Alert(
            setup_name="kod",
            symbol="BTC/USDT",
            timeframe="1h",
            candle=Candle(11, 1, 2, 0.5, 1.5, 100),
            details=["forming"],
            stage="forming",
            direction="bullish",
            profile="swing",
            alert_key=key,
        ),
        delivered=False,
    )

    assert downgraded["id"] == confirmed["id"]
    assert downgraded["stage"] == "confirmed"
    assert downgraded["details"] == ["confirmed"]


def test_old_forming_alerts_are_auto_hidden_by_timeframe(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    now = datetime.now(timezone.utc)
    item = store.add(
        Alert(
            setup_name="kod",
            symbol="BTC/USDT",
            timeframe="5m",
            candle=Candle(4, 1, 2, 0.5, 1.5, 100),
            details=["forming"],
            stage="forming",
            direction="bullish",
            profile="scalping",
            trigger_timeframe="5m",
            alert_key="old-forming",
        ),
        delivered=True,
    )
    item["updated_at"] = (now - timedelta(minutes=46)).isoformat()
    store.save()

    assert store.list_active(now=now) == []
    assert store.count_active(now=now) == 0
    assert store.alerts[0]["dismissed_reason"] == "expired_forming_setup"


def test_confirmed_alerts_do_not_expire_by_age(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    now = datetime.now(timezone.utc)
    item = store.add(
        Alert(
            setup_name="kod",
            symbol="BTC/USDT",
            timeframe="5m",
            candle=Candle(5, 1, 2, 0.5, 1.5, 100),
            details=["confirmed"],
            stage="confirmed",
            direction="bullish",
            profile="scalping",
            trigger_timeframe="5m",
            alert_key="old-confirmed",
            trade_plan={"entry": 100, "risk": 2, "trigger_atr": 2},
        ),
        delivered=True,
    )
    item["updated_at"] = (now - timedelta(days=2)).isoformat()
    store.save()

    assert len(store.list_active(now=now)) == 1
    assert store.count_active(now=now) == 1


def test_missed_setups_are_auto_hidden_by_price(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    store.add(
        Alert(
            setup_name="kod-turtle-soup-reclaim",
            symbol="BTC/USDT",
            timeframe="15m",
            candle=Candle(6, 100, 102, 99, 101, 100),
            details=["confirmed"],
            stage="confirmed",
            direction="bullish",
            profile="intraday",
            trigger_timeframe="15m",
            alert_key="missed-confirmed",
            trade_plan={"entry": 100, "risk": 2, "trigger_atr": 2},
        ),
        delivered=True,
    )

    dismissed = store.dismiss_missed_setups(
        setup_name="kod-turtle-soup-reclaim",
        symbol="BTC/USDT",
        timeframe="15m",
        profile="intraday",
        current_price=103,
        max_chase_atr=0.75,
        max_chase_r=0.75,
    )

    assert len(dismissed) == 1
    assert store.count() == 0
    assert store.alerts[0]["dismissed_reason"].startswith("missed_chase")


def test_invalidated_setups_are_auto_hidden_by_stop(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    store.add(
        Alert(
            setup_name="kod-turtle-soup-reclaim",
            symbol="BTC/USDT",
            timeframe="1h",
            candle=Candle(7, 100, 102, 99, 101, 100),
            details=["confirmed"],
            stage="confirmed",
            direction="bullish",
            profile="swing",
            trigger_timeframe="1h",
            alert_key="invalid-confirmed",
            trade_plan={"entry": 100, "stop": 98, "risk": 2},
        ),
        delivered=True,
    )

    dismissed = store.dismiss_invalidated_setups(
        setup_name="kod-turtle-soup-reclaim",
        symbol="BTC/USDT",
        timeframe="1h",
        profile="swing",
        current_price=97.9,
    )

    assert len(dismissed) == 1
    assert store.count() == 0
    assert store.alerts[0]["dismissed_reason"].startswith("stop_invalidated")
