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

## Always-on free deployment

Cloudflare keeps the app available continuously. A GitHub Actions job scans all
12 markets every five minutes while the browser is closed, then stores the
latest candles/results in Cloudflare D1. READY alerts are deduplicated and sent
from the Worker.

See [Cloudflare deployment](docs/CLOUDFLARE_DEPLOY.md).

```bash
npm run cloud:migrate:local
npm run cloud:dev
```

Run the background scanner against a deployed or local Worker:

```bash
CLOUD_SCAN_URL=http://127.0.0.1:8790 \
SCAN_TOKEN=local-secret \
npm run cloud:scan
```

## Telegram and Gemini

For local Vite development, place secrets in `.env` and restart:

```bash
TELEGRAM_BOT_TOKEN=123456:your_bot_token
TELEGRAM_CHAT_ID=123456789
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
```

Only `READY` setups send Telegram notifications. The alert includes entry, stop, TP1, RR, grade, score, and the main reasons. If the env values are empty, alerts stay disabled and the app keeps running.
Gemini is optional. When `GEMINI_API_KEY` is present, selected trades and Telegram READY alerts include a short Turkish AI commentary.

`GOOGLE_API_KEY` is also accepted as a fallback key name.

## Verify

```bash
npm test
npm run build
npx wrangler deploy --dry-run
```

This tool is for market analysis and educational research. It does not provide financial advice and does not execute trades.
