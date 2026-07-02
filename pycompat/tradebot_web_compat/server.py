from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path.cwd()
DIST = ROOT / "dist"
YAHOO_HOST = "https://query2.finance.yahoo.com"


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _format_price(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    if abs(value) >= 1000:
        return f"{value:,.2f}"
    if abs(value) >= 10:
        return f"{value:.2f}"
    return f"{value:.5f}"


def _format_r(value: Any) -> str:
    return f"1:{value:.2f}" if isinstance(value, (int, float)) else "-"


def _fallback_commentary(payload: dict[str, Any], reason: str | None = None) -> dict[str, Any]:
    warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    invalidation = payload.get("invalidation") if isinstance(payload.get("invalidation"), list) else []
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    entry_model = payload.get("entryModel") if isinstance(payload.get("entryModel"), dict) else {}
    stage = str(payload.get("stage") or "").lower()
    if stage == "ready":
        plan = "Plan hazır; giriş, stop ve TP seviyeleri belli."
    elif stage == "missed":
        plan = "Entry kaçmış veya hedefe gitmiş; kovalamadan yeni setup bekle."
    elif stage == "invalidated":
        plan = "Setup bozulmuş; yeni model bekle."
    elif entry_model.get("status") == "confirmed":
        plan = "Entry modeli var ama kalite/RR/filtreler için bekle."
    else:
        plan = "Retest ve MSS/CISD kapanış onayı bekle."

    default_warning = (
        f"PD {context.get('premiumDiscount', '-')}, "
        f"HTF {context.get('dailyBias', '-')}/{context.get('h4Bias', '-')}/{context.get('h1Bias', '-')}"
    )
    warning_text = warnings[0] if warnings else default_warning
    invalidation_text = invalidation[0] if invalidation else f"Stop {_format_price(payload.get('stopLoss'))}."

    commentary = "\n".join(
        [
            f"Yerel özet: {payload.get('symbol', '-')} {str(payload.get('direction', '')).upper()} {stage.upper()} · {payload.get('grade', '-')} · {_format_r(payload.get('rr'))}.",
            f"Dikkat: {warning_text}.",
            f"Bekle/Plan: {plan}",
            f"Invalidation: {invalidation_text}",
        ]
    )
    return {
        "status": "fallback",
        "commentary": commentary[:900],
        "model": "python-local-fallback",
        "reason": reason,
    }


def _telegram_caption(payload: dict[str, Any], ai_commentary: str | None = None) -> str:
    reasons = payload.get("reasons") if isinstance(payload.get("reasons"), list) else []
    target = payload.get("targets", [None])[0] if isinstance(payload.get("targets"), list) else None
    lines = [
        f"<b>READY SETUP</b> {html.escape(str(payload.get('symbol', '-')))} {html.escape(str(payload.get('direction', '')).upper())}",
        f"{html.escape(str(payload.get('grade', '-')))} · Score {payload.get('score', '-')} · Net RR {_format_r(payload.get('rr'))}",
        "",
        f"Entry: <b>{_format_price(payload.get('entry'))}</b>",
        f"Stop: <b>{_format_price(payload.get('stopLoss'))}</b>",
        f"TP1: <b>{_format_price(target)}</b>",
        "",
        "<b>Neden READY?</b>",
    ]
    lines.extend(f"- {html.escape(str(reason))}" for reason in reasons[:5])
    if not reasons:
        lines.append("- Entry/SL/TP planı aktif")
    if ai_commentary:
        lines.extend(["", "<b>AI Yorumu</b>", html.escape(ai_commentary[:900])])
    return "\n".join(lines)


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, timeout: int = 18) -> tuple[int, dict[str, Any]]:
    data = _json_bytes(payload)
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"content-type": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        return response.status, json.loads(body.decode("utf-8") or "{}")


def _extract_gemini_text(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    for key in ("output_text", "outputText", "text"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    candidates = body.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            content = candidate.get("content") if isinstance(candidate, dict) else None
            parts = content.get("parts") if isinstance(content, dict) else None
            if isinstance(parts, list):
                text = "\n".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
                if text:
                    return text
    return None


def _gemini_commentary(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return _fallback_commentary(payload, "GEMINI_API_KEY missing")
    model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
    prompt = (
        "Türkçe, en fazla 4 kısa satır ICT/KOD trade yorumu yaz. "
        "Kesin al/sat deme, yatırım tavsiyesi verme. Veri:\n"
        + json.dumps(payload, ensure_ascii=False)[:4500]
    )
    try:
        _, body = _post_json(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            {"model": model, "input": prompt},
            headers={"x-goog-api-key": api_key},
            timeout=18,
        )
        text = _extract_gemini_text(body)
        if not text:
            return _fallback_commentary(payload, "Gemini boş yorum döndürdü.")
        return {"status": "ready", "commentary": text[:900], "model": model}
    except Exception as error:  # noqa: BLE001 - HTTP fallback must never break the app.
        return _fallback_commentary(payload, str(error))


class CompatHandler(SimpleHTTPRequestHandler):
    server_version = "KODCenterCompat/0.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

    def _send_json(self, status: int, payload: Any) -> None:
        body = _json_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8") or "{}")
        return value if isinstance(value, dict) else {}

    def _serve_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store" if path.name == "index.html" else "public, max-age=31536000, immutable")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_yahoo(self) -> None:
        path = self.path.lstrip("/")
        if path.startswith("yahoo/"):
            path = path[len("yahoo/") :]
        url = f"{YAHOO_HOST}/{path}"
        request = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("content-type", response.headers.get("content-type", "application/json"))
                self.send_header("cache-control", "no-store")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except Exception as error:  # noqa: BLE001
            self._send_json(502, {"error": str(error)})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            self._send_json(200, {"ok": True, "service": "kod-center"})
            return
        if parsed.path.startswith("/yahoo/"):
            self._proxy_yahoo()
            return

        relative = parsed.path.lstrip("/") or "index.html"
        requested = (DIST / relative).resolve()
        if DIST.resolve() in requested.parents and requested.exists() and requested.is_file():
            self._serve_file(requested)
            return
        self._serve_file(DIST / "index.html")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self._read_json()
        except Exception as error:  # noqa: BLE001
            self._send_json(400, {"status": "error", "error": str(error)})
            return

        if parsed.path == "/api/gemini/trade-commentary":
            self._send_json(200, _gemini_commentary(payload))
            return

        if parsed.path == "/api/telegram/ready-alert":
            token = os.environ.get("TELEGRAM_BOT_TOKEN")
            chat_id = os.environ.get("TELEGRAM_CHAT_ID")
            if not token or not chat_id:
                self._send_json(200, {"status": "disabled", "reason": "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing"})
                return
            if payload.get("stage") != "ready":
                self._send_json(400, {"status": "error", "error": "Only ready alerts are accepted"})
                return
            ai = payload.get("aiCommentary")
            if not isinstance(ai, str) or not ai.strip():
                ai_result = _gemini_commentary(payload.get("tradeContext") if isinstance(payload.get("tradeContext"), dict) else payload)
                ai = ai_result.get("commentary") if ai_result.get("status") in {"ready", "fallback"} else None
            try:
                status, body = _post_json(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    {
                        "chat_id": chat_id,
                        "text": _telegram_caption(payload, ai),
                        "parse_mode": "HTML",
                    },
                    timeout=12,
                )
                self._send_json(200 if status < 400 else 502, {"status": "sent" if status < 400 else "error", "upstream": body})
            except Exception as error:  # noqa: BLE001
                self._send_json(502, {"status": "error", "error": str(error)})
            return

        self._send_json(404, {"status": "error", "error": "Not found"})


def ensure_dist() -> None:
    if (DIST / "index.html").exists():
        return
    print("dist missing; attempting npm ci && npm run build", flush=True)
    subprocess.run(["npm", "ci"], cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Serve the KOD Center React app on Render.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    args, _unknown = parser.parse_known_args(argv)
    ensure_dist()
    server = ThreadingHTTPServer((args.host, args.port), CompatHandler)
    print(f"KOD Center serving {DIST} on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        time.sleep(0.1)


if __name__ == "__main__":
    main()
