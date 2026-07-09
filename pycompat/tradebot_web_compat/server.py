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
    # CRT mentor fallback: address the first missing SOP step with distinct lines instead of
    # echoing the same audit sentence into both Neden and Beklenen.
    invalidation = payload.get("invalidation") if isinstance(payload.get("invalidation"), list) else []
    entry_model = payload.get("entryModel") if isinstance(payload.get("entryModel"), dict) else {}
    chart = payload.get("chart") if isinstance(payload.get("chart"), dict) else {}
    audit = payload.get("structureAudit") if isinstance(payload.get("structureAudit"), dict) else {}
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    waiting_for = chart.get("waitingFor") if isinstance(chart.get("waitingFor"), list) else []
    stage = str(payload.get("stage") or "").lower()
    direction = str(payload.get("direction") or "").lower()
    entry = payload.get("entry")
    stop = payload.get("stopLoss")

    def evidence_status(label: str) -> str | None:
        for item in evidence:
            if isinstance(item, dict) and label in str(item.get("label", "")).lower():
                return str(item.get("status"))
        return None

    geometry_broken = (
        isinstance(entry, (int, float))
        and isinstance(stop, (int, float))
        and (stop <= entry if direction == "short" else stop >= entry)
    )
    decision_line = chart.get("decisionLine") if isinstance(chart.get("decisionLine"), str) else None
    waiting = waiting_for[0] if waiting_for else None
    audit_decision = audit.get("decision") if isinstance(audit.get("decision"), str) else None
    invalidation_text = invalidation[0] if invalidation else f"Stop {_format_price(stop)}."
    risk_line = f"Risk: {_format_r(payload.get('rr'))} · SL {_format_price(stop)} · {invalidation_text}"

    if stage == "invalidated":
        karar = "Karar: Setup geçersiz; stop görüldü."
        neden = f"Neden: {_format_price(stop)} invalidation seviyesi çalıştı; manipulation senaryosu bozuldu."
        beklenen = "Beklenen: Bu modelden uzak dur; yeni range mumu ve yeni manipulation sweep bekle."
    elif stage == "missed":
        karar = "Karar: Kovalama yok; trade kaçtı."
        neden = "Neden: Entry retest'i verilmeden fiyat hedefe yürüdü; geç girişin RR'ı kalmadı."
        beklenen = "Beklenen: Sonraki HTF mumunda yeni CRT dizilimi (sweep → ChoCH → retest) bekle."
    elif geometry_broken:
        karar = "Karar: Trade edilmez; plan geometrisi bozuk."
        neden = f"Neden: Stop {_format_price(stop)}, entry {_format_price(entry)} seviyesinin yanlış tarafında duruyor."
        beklenen = "Beklenen: Geçerli manipulation wick'i oluşup stop doğru tarafa oturana kadar sadece izle."
    elif evidence_status("manipulation") == "fail":
        karar = "Karar: Bekle; manipulation yok."
        neden = "Neden: CRT range extremi henüz süpürülmedi; likidite alınmadan distribution başlamaz."
        beklenen = f"Beklenen: {waiting or 'Range extremi süpürülüp reclaim kapanışı gelsin.'}"
    elif evidence_status("choch") == "fail" or entry_model.get("status") != "confirmed":
        karar = "Karar: Bekle; karakter değişimi onayı eksik."
        neden = "Neden: Sweep tamam ama ChoCH/Just kapanışı yok; şimdilik bu sadece likidite avı."
        beklenen = f"Beklenen: {decision_line or waiting or 'LTF kapanışın manipulation başlangıç seviyesini kırması gerekiyor.'}"
    elif stage == "ready":
        karar = "Karar: Plan hazır; disiplinle uygula."
        neden = f"Neden: {audit_decision or 'CRT sırası tamam: bias, manipulation, ChoCH ve retest okunuyor.'}"
        beklenen = f"Beklenen: Entry {_format_price(entry)}; EQ seviyesinde kısmi al, kalanı DOL'a taşı."
    else:
        karar = "Karar: Onay geldi; retest bekle, displacement kovalanmaz."
        neden = f"Neden: {audit_decision or decision_line or 'Kalite/RR filtreleri henüz READY vermiyor.'}"
        beklenen = f"Beklenen: Fiyat {_format_price(entry)} retest seviyesine dönsün; temas + tutunma görmeden emir yok."

    commentary = "\n".join([karar, neden, beklenen, risk_line])
    return {
        "status": "fallback",
        "commentary": commentary[:900],
        "model": "python-local-fallback",
        "reason": reason,
    }


def _build_gemini_prompt(payload: dict[str, Any]) -> str:
    chart = payload.get("chart") if isinstance(payload.get("chart"), dict) else {}
    entry_model = payload.get("entryModel") if isinstance(payload.get("entryModel"), dict) else {}
    planned_gap = entry_model.get("fairValueGap") if isinstance(entry_model.get("fairValueGap"), dict) else None
    planned_gap_text = (
        json.dumps(planned_gap, ensure_ascii=False)
        if planned_gap
        else "planlı FVG/iFVG yok; FVG kelimesini kullanma"
    )
    key_levels = chart.get("keyLevels") if isinstance(chart.get("keyLevels"), list) else []
    recent_candles = chart.get("recentCandles") if isinstance(chart.get("recentCandles"), list) else []
    waiting_for = chart.get("waitingFor") if isinstance(chart.get("waitingFor"), list) else []
    annotations = chart.get("annotations") if isinstance(chart.get("annotations"), dict) else {}
    structure_audit = payload.get("structureAudit") if isinstance(payload.get("structureAudit"), dict) else {}
    checklist = payload.get("checklist") if isinstance(payload.get("checklist"), list) else []
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    invalidation = payload.get("invalidation") if isinstance(payload.get("invalidation"), list) else []
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}

    prompt = f"""
Sen deneyimli bir Candle Range Theory (CRT) mentorusun; öğrencinin chartını okuyup net ve doğrudan konuşursun.
CRT modelin: bir önceki kapanmış HTF mumu range'dir. Range high/low'unun süpürülmesi manipulation, karşı tarafa dönen hareket distribution'dır.
SOP sıran: HTF bias/DOL uyumu → valid pullback → range extremi sweep + reclaim → LTF ChoCH/Just kapanışı → kırılan seviyenin retest'inden entry → stop manipulation wick'inin dışına → TP1 range EQ (0.5) → TP2 DOL veya range karşı ucu.
Sıra disiplini bozulmaz: sweep yoksa "manipulation bekle" dersin, ChoCH yoksa "kapanış onayı bekle" dersin, retest kaçtıysa "kovalanmaz, yeni model bekle" dersin.
Stop entry'nin yanlış tarafındaysa veya TP entry'nin gerisindeyse bunu sert söyle: bu plan geometrisi bozuk, trade edilmez.
Killzone dışı FX/endeks setup'ı zayıftır; zamanlamayı her zaman değerlendir.
Bu otomatik emir sistemi değildir; al/sat emri verme, kesinlik konuşma, yatırım tavsiyesi yazma.
Türkçe yaz. Teknik terimleri koru. Tam 4 kısa satır yaz.
StructureAudit gerçek kaynak. Audit ile çelişme, audit dışı pattern uydurma.
Chartı gerçekten oku: son mum dizilimi, sweep, ChoCH/Just, entry, stop ve TP mesafesini beraber değerlendir.
Hangi mum/level bekleniyor ise açık söyle. "Şu mumun high/low kapanışı" gibi somut ol.
Eğer StructureAudit POI/FVG yok diyorsa zone varmış gibi konuşma.
Eğer chart verisi plana tersse bunu açıkça eleştir: "bu chartta POI teması yok", "entry chase olur", "stop zaten görülmüş" gibi.
Her satırın rolü farklıdır ve kopya satır yasaktır:
Karar = tek hüküm + kısa gerekçe (Bekle / Trade edilmez / Plan hazır / Kovalama yok gibi).
Neden = chart'taki mevcut kanıt; CRT sırasında hangi adımlar tamam, hangisi eksik.
Beklenen = bir SONRAKİ somut adım; hangi seviye, hangi mumun kapanışı, hangi retest.
Risk = plan seviyeleri ve RR yorumu.
Neden ile Beklenen'e asla aynı cümleyi yazma; ikisi aynı bilgiyi taşıyorsa yanlış yazıyorsun demektir.

Format:
Karar: ...
Neden: ...
Beklenen: ...
Risk: ...

Trade:
Symbol={payload.get("symbol")}
Direction={payload.get("direction")}
Stage={payload.get("stage")}
Grade={payload.get("grade")}
Score={payload.get("score")}
Entry={payload.get("entry")}
Stop={payload.get("stopLoss")}
TP={payload.get("targets")}
NetRR={payload.get("rr")}
GrossRR={payload.get("grossRR")}
EntryModel={entry_model.get("source")}/{entry_model.get("status")}, retest={entry_model.get("retested")}, MSS/CISD={entry_model.get("cisdConfirmed")}
PlannedFVG={planned_gap_text}
Bias D/H4/H1={context.get("dailyBias")}/{context.get("h4Bias")}/{context.get("h1Bias")}
PD={context.get("premiumDiscount")}
Session={context.get("session")}
Feed={context.get("dataFeed")}

ChartRead:
Timeframe={chart.get("timeframe")}
LastPrice={chart.get("lastPrice")}
DecisionLine={chart.get("decisionLine")}

StructureAudit:
{json.dumps(structure_audit, ensure_ascii=False)}

KeyLevels:
{json.dumps(key_levels[:14], ensure_ascii=False)}

WaitingFor:
{json.dumps(waiting_for[:6], ensure_ascii=False)}

ChartAnnotations:
{json.dumps(annotations, ensure_ascii=False)}

RecentCandles:
{json.dumps(recent_candles[-18:], ensure_ascii=False)}

Checklist:
{json.dumps(checklist[:10], ensure_ascii=False)}

Warnings:
{json.dumps(warnings[:8], ensure_ascii=False)}

Evidence:
{json.dumps(evidence[:8], ensure_ascii=False)}

Invalidation:
{json.dumps(invalidation[:3], ensure_ascii=False)}
"""
    return prompt[:5000]


def _telegram_caption(payload: dict[str, Any], ai_commentary: str | None = None) -> str:
    reasons = payload.get("reasons") if isinstance(payload.get("reasons"), list) else []
    if payload.get("alertKind") == "raid":
        raid_note = "raid mumu içeri kapandı" if payload.get("raidClosed") else "raid canlı"
        lines = [
            f"<b>CRT RAID</b> {html.escape(str(payload.get('symbol', '-')))} {html.escape(str(payload.get('direction', '')).upper())} ({html.escape(str(payload.get('rangeTf', '?')))})",
            f"Range: <b>{_format_price(payload.get('rangeLow'))}</b> - <b>{_format_price(payload.get('rangeHigh'))}</b> · {raid_note}",
            "",
            f"{html.escape(str(payload.get('confirmTf', 'LTF')))} ChoCH/Just kapanışı + retest bekleniyor. Bu bir entry sinyali DEĞİL, hazırlık uyarısıdır.",
            "",
        ]
        lines.extend(f"- {html.escape(str(reason))}" for reason in reasons[:5])
        if not reasons:
            lines.append("- Raid + reclaim aktif")
        return "\n".join(lines)
    target = payload.get("targets", [None])[0] if isinstance(payload.get("targets"), list) else None
    priority = payload.get("priority")
    priority_tag = "READY SETUP" if priority == "high" else "READY (orta grade)" if priority == "normal" else "READY (düşük grade · küçük boyut)"
    risk_pct = payload.get("riskPct")
    lines = [
        f"<b>{priority_tag}</b> {html.escape(str(payload.get('symbol', '-')))} {html.escape(str(payload.get('direction', '')).upper())}",
        f"{html.escape(str(payload.get('grade', '-')))} · Score {payload.get('score', '-')} · Net RR {_format_r(payload.get('rr'))}",
    ]
    if isinstance(risk_pct, (int, float)):
        lines.append(f"Önerilen risk: <b>%{risk_pct}</b> (grade'e göre boyut)")
    lines += [
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
    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    prompt = _build_gemini_prompt(payload)
    try:
        _, body = _post_json(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.6, "maxOutputTokens": 640}},
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
