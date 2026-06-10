from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from tradebot.journal import JOURNAL_PENDING, JOURNAL_SKIPPED
from tradebot.models import Alert, Candle
from tradebot.web import create_app
from tradebot.web.runtime import (
    ActivityStore,
    AlertStore,
    BotController,
    DashboardLogHandler,
    _desk_chart_url,
    _desk_decision,
    _desk_direction,
    _desk_preferred_side,
    _desk_setup_candidates,
    _desk_timeframe_charts,
    _desk_priority_score,
    _desk_session_projection,
    _projection_aligns_with_bias,
)


def test_alert_store_serializes_alerts(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    alert = Alert(
        setup_name="kod",
        symbol="BTC/USDT",
        timeframe="15m",
        candle=Candle(1, 1, 2, 0.5, 1.5, 100),
        details=["Stage: Setup confirmed"],
        stage="confirmed",
        direction="bullish",
        profile="intraday",
    )

    store.add(alert, delivered=True)

    latest = store.latest()
    assert latest[0]["setup_name"] == "kod"
    assert latest[0]["stage"] == "confirmed"
    assert latest[0]["delivered"] is True
    assert store.count() == 1


def test_alert_store_hides_cb_and_ml_from_active_queue(tmp_path: Path):
    store = AlertStore.load(tmp_path / "alerts.json")
    for grade in ("CB", "ML", "A"):
        store.add(
            Alert(
                setup_name="kod",
                symbol=f"{grade}/USDT",
                timeframe="1h",
                candle=Candle(1, 1, 2, 0.5, 1.5, 100),
                details=[f"Setup: {grade} — test"],
                stage="confirmed",
                direction="bullish",
                profile="swing",
                alert_key=f"key-{grade}",
                trade_plan={"setup_grade": grade},
            ),
            delivered=True,
        )

    latest = store.latest()

    assert [item["symbol"] for item in latest] == ["A/USDT"]
    assert store.count() == 1


def test_log_handler_returns_records_after_id():
    handler = DashboardLogHandler()
    record = __import__("logging").LogRecord("x", 20, __file__, 1, "hello %s", ("bot",), None)

    handler.emit(record)

    assert handler.since(0)[0]["message"] == "hello bot"
    assert handler.since(1) == []


def test_activity_store_keeps_current_search_context():
    store = ActivityStore()

    store.add(
        {
            "phase": "strategy",
            "message": "Looking for KOD Turtle Soup Reclaim on BTC/USDT.",
            "symbol": "BTC/USDT",
            "setup": "kod",
            "looking_for": ["HTF liquidity objective.", "Trigger sweep and reclaim."],
        }
    )

    snapshot = store.snapshot()
    assert snapshot["current"]["phase"] == "strategy"
    assert snapshot["current"]["symbol"] == "BTC/USDT"
    assert snapshot["current"]["looking_for"] == ["HTF liquidity objective.", "Trigger sweep and reclaim."]
    assert snapshot["events"][0]["message"].startswith("Looking for")


def test_session_projection_marks_session_raid_and_focus():
    def candle(hour: int, minute: int, open_: float, high: float, low: float, close: float) -> Candle:
        opened = datetime(2026, 6, 4, hour, minute, tzinfo=timezone.utc)
        return Candle(int(opened.timestamp() * 1000), open_, high, low, close, 100)

    candles = []
    for hour in range(0, 5):
        candles.append(candle(hour, 0, 105, 110, 100, 106))
        candles.append(candle(hour, 15, 106, 109, 101, 105))
    candles.append(candle(6, 0, 101, 104, 98, 102))
    for hour in range(7, 10):
        candles.append(candle(hour, 0, 106, 114, 102, 108))
        candles.append(candle(hour, 15, 108, 112, 103, 107))
    candles.append(candle(12, 30, 103, 106, 101, 105))
    candles.append(candle(12, 45, 105, 107, 104, 106))

    projection = _desk_session_projection("NAS100", candles)

    assert projection is not None
    assert projection["symbol"] == "NAS100"
    assert projection["focus"] == "NY AM focus"
    assert projection["timeframe"] == "15m"
    assert projection["status"] == "bullish"
    assert projection["current_session"] == "NY AM"
    assert projection["taken_liquidity"] == "London low swept and reclaimed"
    assert projection["likely_draw"]["direction"] == "bullish"
    assert _projection_aligns_with_bias(projection, "bullish") is True
    assert _projection_aligns_with_bias(projection, "bearish") is False


def test_cloud_config_contains_nas100_external_symbol():
    from tradebot.config import load_config

    config = load_config(Path("config.cloud.yaml"))

    assert "NAS100" in config.scanner.symbols
    assert config.exchange.external_symbols["NAS100"] == "yahoo:NQ=F"


def test_desk_chart_url_carries_structure_and_fvg_annotations():
    url = _desk_chart_url(
        "ETH/USDT",
        "1h",
        1_700_000_000_000,
        "bullish",
        reference_level=95,
        sweep_extreme=94,
        msb_level=108,
        msb_at_ms=1_699_990_000_000,
        fvg_zone={"low": 101, "high": 103, "kind": "fvg", "direction": "bullish"},
        model_statuses=[
            {"name": "Model #1", "status": "armed", "trigger": "15m", "detail": "Wait Candle 3 close."},
            {"name": "MSS Entry", "status": "waiting", "trigger": "15m", "detail": "Wait structure shift."},
        ],
    )

    query = parse_qs(urlparse(url).query)

    assert query["trigger_mode"] == ["model1_or_mss"]
    assert query["msb_at_ms"] == ["1699990000000"]
    assert query["fvg_zone_low"] == ["101"]
    assert query["fvg_zone_high"] == ["103"]
    assert query["fvg_zone_direction"] == ["bullish"]
    assert query["model_0_name"] == ["Model #1"]
    assert query["model_0_status"] == ["armed"]
    assert query["model_1_name"] == ["MSS Entry"]


def test_desk_setup_candidates_promote_matching_pdf_model():
    direction = {
        "direction": "bullish",
        "objective": {"level": 120},
        "raid": {"level": 100, "sweep_extreme": 98},
        "key_level": {"status": "pass"},
        "candle_3": {"status": "pass", "trigger_mode": "model1"},
        "trigger_mode": "model1",
        "trigger_confirmed": True,
        "msb_level": 110,
        "smt_status": {"status": "pass", "state": "unavailable", "detail": "SMT unavailable"},
    }

    candidates = _desk_setup_candidates(direction, "ready", "4h", "15m", [], "wait")

    by_key = {item["key"]: item for item in candidates}
    assert by_key["model1"]["status"] == "ready"
    assert by_key["model1"]["trade"] is True
    assert by_key["kod"]["status"] == "ready"
    assert by_key["smt_kod"]["status"] == "unavailable"


def test_desk_direction_prefers_framework_bias_side():
    directions = [
        {
            "direction": "bearish",
            "status": "wait",
            "gate": {"status": "blocked"},
            "quality": {"score": 92},
            "objective": {"distance_atr": 0.2},
        },
        {
            "direction": "bullish",
            "status": "block",
            "gate": {"status": "blocked"},
            "quality": {"score": 10},
            "objective": {"distance_atr": 2.4},
        },
    ]

    assert _desk_preferred_side({"macro_bias": "Strong Bullish"}) == "bullish"
    assert _desk_direction(directions)["direction"] == "bearish"
    assert _desk_direction(directions, preferred_side="bullish")["direction"] == "bullish"


def test_desk_timeframe_charts_include_full_mtf_stack():
    charts = _desk_timeframe_charts(
        "BTC/USDT",
        "bullish",
        "4h",
        "15m",
        {"status": "waiting"},
        htf_target=120,
        reference_level=100,
        sweep_extreme=98,
        msb_level=110,
        active_setup={"name": "Model #1"},
        setup_candidates=[
            {"name": "Model #1", "status": "armed", "trigger": "15m", "detail": "Wait Candle 3 close."},
        ],
    )

    assert [item["timeframe"] for item in charts] == ["1M", "1w", "1d", "4h", "1h", "15m"]
    assert [item["active"] for item in charts] == [False, False, False, True, False, True]
    trigger_query = parse_qs(urlparse(charts[-1]["url"]).query)
    assert trigger_query["timeframe"] == ["15m"]
    assert trigger_query["trigger_mode"] == ["model1_or_mss"]
    assert trigger_query["model_0_name"] == ["Model #1"]


def test_desk_pdf_framework_checklist_blocks_priority_until_full_gate_passes():
    blockers = [
        "HTF narrative: opposing HTF bias",
        "Candle 3 Model #1/MSS: missing 1h confirmation",
        "FVG: missing same-direction FVG confluence",
        "Session: outside London/New York killzone",
    ]
    decision = _desk_decision(
        "blocked",
        "bullish",
        {"level": 110, "distance_atr": 0.8},
        {"level": 104},
        blockers,
        "wait",
    )

    labels = [item["label"] for item in decision["checklist"]]
    assert labels == [
        "HTF narrative",
        "Key level",
        "Candle 2 Turtle Soup",
        "Candle 3 Model #1/MSS",
        "FVG",
        "Session",
        "Risk",
    ]
    assert decision["label"] == "NO TRADE: BLOCKED"
    score = _desk_priority_score("blocked", "A+", {"level": 110, "distance_atr": 0.8}, {"level": 104}, blockers, decision["checklist"])
    assert score <= 24


def test_journal_auto_skips_pending_entries_without_active_alert(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        journal_file=tmp_path / "journal.json",
        alerts_file=tmp_path / "alerts.json",
        dry_run=True,
    )
    stale_key = "stale-key"
    live_key = "live-key"
    controller.journal.upsert_from_alert(
        stale_key,
        {
            "symbol": "BTC/USDT",
            "setup_name": "kod",
            "stage": "forming",
            "direction": "bullish",
        },
    )
    controller.journal.upsert_from_alert(
        live_key,
        {
            "symbol": "PAXG/USDT",
            "setup_name": "kod",
            "stage": "confirmed",
            "direction": "bullish",
            "trade_plan": {"setup_grade": "A+"},
        },
    )
    controller.alerts.add(
        Alert(
            setup_name="kod",
            symbol="PAXG/USDT",
            timeframe="1h",
            candle=Candle(2, 1, 2, 0.5, 1.5, 100),
            details=["live"],
            stage="confirmed",
            direction="bullish",
            profile="swing",
            alert_key=live_key,
            trade_plan={"setup_grade": "A+"},
        ),
        delivered=True,
    )

    payload = controller.journal_list()

    assert controller.journal.get(stale_key)["status"] == JOURNAL_SKIPPED
    assert "Auto skipped" in controller.journal.get(stale_key)["notes"]
    assert controller.journal.get(live_key)["status"] == JOURNAL_PENDING
    assert payload["counts"]["skipped"] == 1
    assert payload["counts"]["pending"] == 1


def test_scan_once_rejects_while_in_progress(tmp_path: Path, monkeypatch):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )
    with controller._lock:
        controller._scan_in_progress = True

    result = controller.scan_once()

    assert result["ok"] is False
    assert "progress" in result["message"].lower()


def test_start_rejects_while_scanning(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )
    with controller._lock:
        controller._scan_in_progress = True

    result = controller.start()

    assert result["ok"] is False


def test_status_exposes_scan_started_at(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )
    with controller._lock:
        controller._scan_in_progress = True
        controller._scan_started_at = "2026-05-23T12:00:00+00:00"

    status = controller.status()

    assert status["scan_in_progress"] is True
    assert status["scan_started_at"] == "2026-05-23T12:00:00+00:00"


def test_cloud_readonly_disables_mutating_runtime_actions(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        journal_file=tmp_path / "journal.json",
        alerts_file=tmp_path / "alerts.json",
        dry_run=True,
        cloud_readonly=True,
    )

    status = controller.status()

    assert status["cloud_readonly"] is True
    assert status["running"] is False
    assert status["dry_run"] is True
    assert status["stored_alerts"] == 0
    assert status["journal_counts"]["total"] == 0
    assert controller.alerts_snapshot() == []
    assert controller.start()["ok"] is False
    assert controller.stop()["ok"] is False
    assert controller.scan_once()["ok"] is True
    assert controller.dismiss_alert(1)["ok"] is False
    assert controller.journal_list()["entries"] == []
    assert controller.journal_update("x", {"status": "taken"})["ok"] is False
    assert controller.replay_recent()["ok"] is False


def test_web_app_exposes_status_endpoint(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )
    app = create_app(controller)

    response = app.test_client().get("/api/status")

    assert response.status_code == 200
    assert response.get_json()["running"] is False


def test_cloud_readonly_requires_password_and_allows_login(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("KOD_DASHBOARD_PASSWORD", "secret")
    monkeypatch.setenv("KOD_SECRET_KEY", "test-secret")
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
        cloud_readonly=True,
    )
    app = create_app(controller)
    client = app.test_client()

    assert client.get("/healthz").status_code == 200
    assert client.get("/").status_code == 302
    assert client.get("/api/status").status_code == 401
    assert client.post("/login", data={"password": "bad"}).status_code == 401

    login = client.post("/login", data={"password": "secret"})

    assert login.status_code == 302
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.get_json()["cloud_readonly"] is True


def test_cloud_readonly_refuses_to_serve_without_password(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("KOD_DASHBOARD_PASSWORD", raising=False)
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
        cloud_readonly=True,
    )
    app = create_app(controller)
    client = app.test_client()

    assert client.get("/").status_code == 503
    response = client.get("/api/status")
    assert response.status_code == 503
    assert "PASSWORD" in response.get_json()["message"]


def test_web_chart_endpoint(tmp_path: Path, monkeypatch):
    from tradebot.web import create_app
    from tradebot.web.runtime import BotController

    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )

    class FakeExchange:
        def fetch_candles(self, symbol, timeframe, limit, since_ms=None):
            base = 1_700_000_000_000
            return [
                __import__("tradebot.models", fromlist=["Candle"]).Candle(
                    base + index * 60_000,
                    100 + index,
                    101 + index,
                    99 + index,
                    100.5 + index,
                    10,
                )
                for index in range(5)
            ]

    monkeypatch.setattr(controller, "_get_exchange", lambda: FakeExchange())
    from types import SimpleNamespace

    controller._last_config = SimpleNamespace(scanner=SimpleNamespace(use_closed_candle=False))
    app = create_app(controller)
    client = app.test_client()

    response = client.get("/api/chart?symbol=BTC/USDT&timeframe=15m&at=1700000000000")
    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert len(body["candles"]) == 5


def test_web_chart_png_endpoint(tmp_path: Path, monkeypatch):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )

    class FakeExchange:
        def fetch_candles(self, symbol, timeframe, limit, since_ms=None):
            base = 1_700_000_000_000
            return [
                __import__("tradebot.models", fromlist=["Candle"]).Candle(
                    base + index * 60_000,
                    100 + index,
                    101 + index,
                    99 + index,
                    100.5 + index,
                    10,
                )
                for index in range(5)
            ]

    monkeypatch.setattr(controller, "_get_exchange", lambda: FakeExchange())
    app = create_app(controller)
    client = app.test_client()

    response = client.get(
        "/api/chart/png?symbol=BTC/USDT&timeframe=15m&at=1700000000000&direction=bearish&entry=100&stop=105"
        "&model_0_name=Model%20%231&model_0_status=armed&model_0_trigger=15m&model_0_detail=Wait%20Candle%203"
    )

    assert response.status_code == 200
    assert response.mimetype == "image/svg+xml"
    assert b"<svg" in response.data
    assert b"BTC/USDT" in response.data
    assert b"MODELS / WHAT IS NEEDED" in response.data
    assert b"Model #1" in response.data


def test_web_chart_png_snapshot_stops_at_signal_candle(tmp_path: Path, monkeypatch):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )

    class FakeExchange:
        def fetch_candles(self, symbol, timeframe, limit, since_ms=None):
            base = 1_700_000_000_000
            return [
                Candle(
                    base + index * 60_000,
                    100 + index,
                    101 + index,
                    99 + index,
                    100.5 + index,
                    10,
                )
                for index in range(12)
            ]

    monkeypatch.setattr(controller, "_get_exchange", lambda: FakeExchange())
    app = create_app(controller)
    client = app.test_client()
    at_ms = 1_700_000_000_000 + 5 * 60_000

    response = client.get(
        f"/api/chart/png?symbol=BTC/USDT&timeframe=15m&at={at_ms}&snapshot=1&direction=bullish"
    )

    assert response.status_code == 200
    assert b"C 105.50" in response.data
    assert b"C 111.50" not in response.data


def test_fetch_chart_candles_empty_returns_error(tmp_path: Path, monkeypatch):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )

    class EmptyExchange:
        def fetch_candles(self, symbol, timeframe, limit, since_ms=None):
            return []

    monkeypatch.setattr(controller, "_get_exchange", lambda: EmptyExchange())
    candles, error = controller._fetch_chart_candles("BTC/USDT", "15m", 80, 1_700_000_000_000)

    assert candles == []
    assert error == "No candle data returned."


def test_timeframe_window_ms():
    from tradebot.web.runtime import _timeframe_window_ms

    assert _timeframe_window_ms("15m", 10) == 15 * 60 * 1000 * 10
    assert _timeframe_window_ms("4h", 2) == 4 * 60 * 60 * 1000 * 2


def test_web_app_exposes_activity_endpoint(tmp_path: Path):
    controller = BotController(
        config_path=tmp_path / "missing.yaml",
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )
    controller.activity.add({"phase": "scan_start", "message": "Starting scan cycle."})
    app = create_app(controller)

    response = app.test_client().get("/api/activity")

    assert response.status_code == 200
    assert response.get_json()["current"]["message"] == "Starting scan cycle."


def test_web_replay_endpoint_runs_without_sending_alerts(tmp_path: Path, monkeypatch):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        """
telegram:
  dry_run: true
scanner:
  symbols: [BTC/USDT]
  candle_limit: 80
  use_closed_candle: false
setups:
  - name: kod-turtle-soup-reclaim
    type: kod_turtle_soup
    enabled: true
    cooldown_minutes: 45
    profiles:
      - name: swing
        context_timeframe: 1d
        trigger_timeframe: 1h
    previous_candle_sweep: false
    require_htf_raid_confirmation: false
    min_final_rr: 0.5
""",
        encoding="utf-8",
    )
    controller = BotController(
        config_path=config_file,
        env_file=tmp_path / ".env",
        state_file=tmp_path / "state.json",
        dry_run=True,
    )

    class FakeExchange:
        def fetch_candles(self, symbol, timeframe, limit, since_ms=None):
            step = 86_400_000 if timeframe == "1d" else 3_600_000
            return [
                Candle(
                    index * step,
                    100 + index * 0.1,
                    102 + index * 0.1,
                    99 + index * 0.1,
                    101 + index * 0.1,
                    10,
                )
                for index in range(limit)
            ]

    monkeypatch.setattr(controller, "_get_exchange", lambda: FakeExchange())
    app = create_app(controller)

    response = app.test_client().post("/api/replay", json={"bars": 30})

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["summaries"]
