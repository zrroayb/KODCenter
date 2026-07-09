# Financial Command Center

A stateless, front-end-only trading research MVP built as a modular financial intelligence platform.

KOD is the first strategy module, not the whole product. The architecture separates UI, strategy logic, market intelligence, risk, backtest/review, and data/demo adapters.

## Run

```bash
npm install
npm run dev
```

## Telegram READY Alerts

Create a local `.env` from `.env.example` and restart the dev server:

```bash
TELEGRAM_BOT_TOKEN=123456:your_bot_token
TELEGRAM_CHAT_ID=123456789
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
```

Only `READY` setups send Telegram notifications. The alert includes entry, stop, TP1, RR, grade, score, and the main reasons. If the env values are empty, alerts stay disabled and the app keeps running.
Gemini is optional. When `GEMINI_API_KEY` is present, selected trades and Telegram READY alerts include a short Turkish AI commentary.

For Render, add these in the service **Environment** tab and redeploy:

```bash
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
```

`GOOGLE_API_KEY` is also accepted as a fallback key name.

## Verify

```bash
npm test
npm run build
```

This tool is for market analysis and educational research. It does not provide financial advice and does not execute trades.
