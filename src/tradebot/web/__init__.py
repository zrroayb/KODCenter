from __future__ import annotations

import argparse
import hmac
import logging
import os
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, redirect, render_template, request, session

from tradebot.web.runtime import BotController, DashboardLogHandler


def create_app(controller: BotController) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    dashboard_password = os.environ.get("KOD_DASHBOARD_PASSWORD", "")
    password_required = bool(dashboard_password) or controller.cloud_readonly
    app.secret_key = os.environ.get("KOD_SECRET_KEY") or os.environ.get("SECRET_KEY") or dashboard_password or "kod-center-dev-only"
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

    @app.before_request
    def require_login():
        if request.endpoint in {"static", "login", "login_post", "logout", "healthz"}:
            return None
        if not password_required:
            return None
        if controller.cloud_readonly and not dashboard_password:
            message = "Set KOD_DASHBOARD_PASSWORD before exposing the cloud dashboard."
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "message": message}), 503
            return Response(_login_page(message, disabled=True), status=503, mimetype="text/html")
        if session.get("kod_authed"):
            return None
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "message": "Login required."}), 401
        return redirect("/login")

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True})

    @app.get("/login")
    def login():
        if not password_required:
            return redirect("/")
        if controller.cloud_readonly and not dashboard_password:
            return Response(
                _login_page("Set KOD_DASHBOARD_PASSWORD before exposing the cloud dashboard.", disabled=True),
                status=503,
                mimetype="text/html",
            )
        return Response(_login_page(), mimetype="text/html")

    @app.post("/login")
    def login_post():
        if not password_required:
            return redirect("/")
        supplied = request.form.get("password", "")
        if dashboard_password and hmac.compare_digest(supplied, dashboard_password):
            session["kod_authed"] = True
            return redirect("/")
        return Response(_login_page("Wrong password."), status=401, mimetype="text/html")

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect("/login" if password_required else "/")

    @app.get("/")
    def dashboard():
        return render_template("dashboard.html")

    @app.get("/api/status")
    def status():
        return jsonify(controller.status())

    @app.get("/api/logs")
    def logs():
        since = int(request.args.get("since", "0"))
        return jsonify({"logs": controller.logs.since(since)})

    @app.get("/api/alerts")
    def alerts():
        return jsonify({"alerts": controller.alerts_snapshot()})

    @app.post("/api/alerts/<int:alert_id>/dismiss")
    def dismiss_alert(alert_id: int):
        return jsonify(controller.dismiss_alert(alert_id))

    @app.get("/api/chart")
    def chart():
        symbol = request.args.get("symbol", "")
        timeframe = request.args.get("timeframe", "")
        if not symbol or not timeframe:
            return jsonify({"ok": False, "error": "symbol and timeframe are required"}), 400
        limit = min(int(request.args.get("limit", "120")), 300)
        at_ms = request.args.get("at")
        at_value = int(at_ms) if at_ms else None
        return jsonify(controller.chart_data(symbol, timeframe, limit=limit, at_ms=at_value))

    @app.get("/api/chart/png")
    def chart_png():
        symbol = request.args.get("symbol", "")
        timeframe = request.args.get("timeframe", "")
        if not symbol or not timeframe:
            return Response("symbol and timeframe are required", status=400, mimetype="text/plain")
        limit = min(int(request.args.get("limit", "120")), 300)
        at_ms = request.args.get("at")
        at_value = int(at_ms) if at_ms else None
        direction = request.args.get("direction", "")
        role = request.args.get("role", "")
        stage = request.args.get("stage", "")
        snapshot = request.args.get("snapshot") in {"1", "true", "yes"}
        levels = {
            key: float(request.args.get(key))
            for key in ("entry", "stop", "tp1", "tp2", "final_target")
            if request.args.get(key) not in (None, "")
        }
        annotations = {
            "reference_level": _float_arg("reference_level"),
            "sweep_extreme": _float_arg("sweep_extreme"),
            "htf_target": _float_arg("htf_target"),
            "msb_level": _float_arg("msb_level"),
            "msb_at_ms": _int_arg("msb_at_ms"),
            "structure_stop": _float_arg("structure_stop"),
            "raid_level": _float_arg("raid_level"),
            "raid_extreme": _float_arg("raid_extreme"),
            "htf_raid_at_ms": _int_arg("htf_raid_at_ms"),
            "htf_raid_label": request.args.get("htf_raid_label", ""),
            "zones": _zone_args(),
            "wait_text": request.args.get("wait_text", ""),
            "setup_label": request.args.get("setup_label", ""),
            "trigger_mode": request.args.get("trigger_mode", ""),
            "decision_status": request.args.get("decision_status", ""),
            "decision_label": request.args.get("decision_label", ""),
            "decision_subtitle": request.args.get("decision_subtitle", ""),
            "checklist": _checklist_args(),
        }
        svg = controller.chart_png(
            symbol,
            timeframe,
            limit=limit,
            at_ms=at_value,
            direction=direction,
            levels=levels or None,
            role=role,
            stage=stage,
            snapshot=snapshot,
            annotations=annotations,
        )
        return Response(
            svg,
            mimetype="image/svg+xml",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"},
        )

    @app.get("/api/journal")
    def journal():
        status = request.args.get("status") or None
        symbol = request.args.get("symbol") or None
        setup = request.args.get("setup") or None
        direction = request.args.get("direction") or None
        outcome = request.args.get("outcome") or None
        limit = int(request.args.get("limit", "200"))
        return jsonify(
            controller.journal_list(
                status=status,
                symbol=symbol,
                setup=setup,
                direction=direction,
                outcome=outcome,
                limit=limit,
            )
        )

    @app.post("/api/journal/<path:alert_key>")
    def journal_update(alert_key: str):
        payload = request.get_json(silent=True) or {}
        if not payload:
            return jsonify({"ok": False, "message": "Update payload is required."}), 400
        return jsonify(controller.journal_update(alert_key, payload))

    @app.get("/api/activity")
    def activity():
        return jsonify(controller.activity.snapshot())

    @app.get("/api/desk")
    def desk():
        force = request.args.get("refresh") == "1"
        return jsonify(controller.desk_snapshot(force=force))

    @app.get("/api/config")
    def config():
        return jsonify(controller.config_snapshot())

    @app.post("/api/start")
    def start():
        return jsonify(controller.start())

    @app.post("/api/stop")
    def stop():
        return jsonify(controller.stop())

    @app.post("/api/scan-once")
    def scan_once():
        return jsonify(controller.scan_once())

    @app.post("/api/replay")
    def replay():
        payload = request.get_json(silent=True) or {}
        bars = int(payload.get("bars", request.args.get("bars", 120)))
        return jsonify(controller.replay_recent(bars=bars))

    return app


def _login_page(message: str = "", disabled: bool = False) -> str:
    disabled_attr = "disabled" if disabled else ""
    button_text = "Locked" if disabled else "Open Desk"
    message_html = f"<p class='message'>{message}</p>" if message else ""
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KOD Center Login</title>
    <style>
      :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
      body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1015; color: #f4f7fb; padding: 20px; }}
      main {{ width: min(420px, 100%); border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 18px; background: #171b22; padding: 24px; box-shadow: 0 22px 70px rgba(0, 0, 0, 0.38); }}
      .brand {{ width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; background: #f4f7fb; color: #0d1015; font-weight: 800; margin-bottom: 18px; }}
      h1 {{ margin: 0; font-size: 22px; }}
      p {{ margin: 8px 0 18px; color: #9ca3af; line-height: 1.45; }}
      .message {{ color: #fbbf24; }}
      input {{ width: 100%; box-sizing: border-box; min-height: 48px; border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.26); background: #0d1015; color: #f4f7fb; padding: 0 14px; font-size: 15px; }}
      button {{ width: 100%; min-height: 48px; margin-top: 12px; border: 0; border-radius: 12px; background: #f4f7fb; color: #0d1015; font-weight: 800; cursor: pointer; }}
      button:disabled {{ opacity: 0.55; cursor: not-allowed; }}
    </style>
  </head>
  <body>
    <main>
      <div class="brand">KOD</div>
      <h1>KOD Center</h1>
      <p>Private read-only trading desk.</p>
      {message_html}
      <form method="post" action="/login">
        <input name="password" type="password" placeholder="Dashboard password" autocomplete="current-password" {disabled_attr} autofocus>
        <button type="submit" {disabled_attr}>{button_text}</button>
      </form>
    </main>
  </body>
</html>"""


def _float_arg(name: str) -> float | None:
    value = request.args.get(name)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _int_arg(name: str) -> int | None:
    value = request.args.get(name)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _zone_args() -> list[dict[str, Any]]:
    zones: list[dict[str, Any]] = []
    labels = {
        "trigger_zone": "trigger imbalance",
        "fvg_zone": "FVG support",
        "ifvg_zone": "iFVG support",
        "opposing_zone": "opposing imbalance",
    }
    for prefix, label in labels.items():
        low = _float_arg(f"{prefix}_low")
        high = _float_arg(f"{prefix}_high")
        if low is None or high is None:
            continue
        zones.append(
            {
                "low": low,
                "high": high,
                "kind": request.args.get(f"{prefix}_kind", ""),
                "direction": request.args.get(f"{prefix}_direction", ""),
                "label": label,
                "role": prefix,
            }
        )
    return zones


def _checklist_args() -> list[dict[str, str]]:
    labels = {
        "draw": "HTF draw",
        "location": "PD array",
        "raid": "Raid",
        "trigger": "MSB/FVG",
        "risk": "Risk",
    }
    items: list[dict[str, str]] = []
    for key, label in labels.items():
        status = request.args.get(f"check_{key}", "")
        if not status:
            continue
        items.append({"key": key, "label": label, "status": status})
    return items


def main() -> None:
    args = _parse_args()
    controller = BotController(
        config_path=args.config,
        env_file=args.env_file,
        state_file=args.state_file,
        journal_file=args.journal_file,
        alerts_file=args.alerts_file,
        dry_run=args.dry_run,
        cloud_readonly=args.cloud_readonly,
    )
    _configure_logging(controller.logs, args.log_level)
    if args.auto_start:
        controller.start()
    app = create_app(controller)
    app.run(host=args.host, port=args.port, debug=args.debug, use_reloader=False)


def _configure_logging(handler: DashboardLogHandler, log_level: str) -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, log_level))
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s"))
    root.handlers.clear()
    root.addHandler(stream_handler)
    root.addHandler(handler)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tradebot web dashboard")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--state-file", type=Path, default=Path(".tradebot_state.json"))
    parser.add_argument("--journal-file", type=Path, default=Path(".tradebot_journal.json"))
    parser.add_argument("--alerts-file", type=Path, default=Path(".tradebot_alerts.json"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--dry-run", action="store_true", help="record alerts without sending Telegram messages")
    parser.add_argument(
        "--cloud-readonly",
        action="store_true",
        help="serve an on-demand Desk without background scanning, Telegram, alerts, or journal writes",
    )
    parser.add_argument("--auto-start", action="store_true", help="start the scanner loop when the dashboard starts")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    return parser.parse_args()
