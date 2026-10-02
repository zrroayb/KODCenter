# Tradebot CRT Command Center

A CRT market scanner, chart workspace, replay tool and local trade journal.

CRT is the active strategy. The browser and the scheduled scanner use the same
deterministic runtime.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8787/`.

## Deployment

The live site is Render (`render.yaml`, `npm start`), auto-deployed from `main`. `vite preview`
serves both the SPA and the `/api/*` endpoints (Gemini, Telegram alert, alert history).

A GitHub Actions job (`background-scan.yml`) runs the scanner on a schedule and posts READY
setups to the site's `/api/telegram/ready-alert` (SCAN_TOKEN bearer); the server dedupes and
sends to Telegram. Run it by hand against a local or live site:

```bash
CLOUD_SCAN_URL=http://127.0.0.1:4173 \
SCAN_TOKEN=local-secret \
npm run cloud:scan
```

## Telegram and Gemini

For local Vite development, place secrets in `.env` and restart:

```bash
TELEGRAM_BOT_TOKEN=123456:your_bot_token
TELEGRAM_CHAT_ID=123456789
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```

Only `READY` setups send Telegram notifications. The alert includes entry, stop, TP1, RR, grade, score, and the main reasons. If the env values are empty, alerts stay disabled and the app keeps running.
Gemini is optional. When `GEMINI_API_KEY` is present, selected trades and Telegram READY alerts include a short Turkish AI commentary.

`GOOGLE_API_KEY` is also accepted as a fallback key name.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

This tool is for market analysis and educational research. It does not provide financial advice and does not execute trades.
