# Tradebot Command Center

Tradebot scans market candles, evaluates configured setups, and sends Telegram alerts when your rules are active. It also includes a local web command center for monitoring runtime status, live logs, strategy coverage, and generated signals.

The bot is alert-only. It does not place orders.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
cp config.example.yaml config.yaml
```

Fill `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:telegram-bot-token
TELEGRAM_CHAT_ID=123456789
```

To get Telegram values:

1. Create a Telegram bot with BotFather and copy the token.
2. Send a message to your bot.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat.id`.

## CLI

Run the scanner loop:

```bash
tradebot --config config.yaml
```

Run one scan:

```bash
tradebot --config config.yaml --once
```

Run without sending Telegram messages:

```bash
tradebot --config config.yaml --dry-run --once
```

## Web Command Center

Start the local dashboard:

```bash
tradebot-web --config config.yaml --dry-run
```

Default URL:

```text
http://127.0.0.1:8787
```

The dashboard shows:

- Engine state, last scan, scan cycles, delivery mode, and watchlist size.
- Signal blotter with stage, profile, direction, close, and rule explanation.
- Strategy matrix with KOD timeframe profiles.
- Market coverage, runtime paths, and live system logs.

To send real Telegram alerts, remove `--dry-run` and make sure `.env` contains your token and chat id.

Start the dashboard and scanner together:

```bash
tradebot-web --config config.yaml --dry-run --auto-start
```

## Free Read-Only Cloud Desk

Use this when you want to open the dashboard from your iPhone while the Mac is off, without running a 24/7 alert bot. This mode does not store alerts, write journal entries, send Telegram messages, or run a background scanner. It wakes when you open the site and builds the current Desk view from live exchange candles.

Local test:

```bash
KOD_DASHBOARD_PASSWORD=change-me tradebot-web --config config.cloud.yaml --host 0.0.0.0 --port 8787 --cloud-readonly --dry-run
```

Deploy on Render Free:

1. Push this repo to GitHub.
2. Create a new Render Blueprint from `render.yaml`, or create a Web Service manually.
3. Set `KOD_DASHBOARD_PASSWORD` in Render environment variables.
4. Open the Render URL from your phone and sign in.

The included `render.yaml` starts:

```bash
tradebot-web --config config.cloud.yaml --host 0.0.0.0 --port $PORT --cloud-readonly --dry-run --log-level INFO
```

Free services can sleep. The first request after sleep may take a little longer, then the Desk refreshes on demand.

## Run In The Background On macOS

Install the bot as a macOS LaunchAgent when you want it to keep running after you close the terminal. The service starts the web dashboard, starts the scanner automatically, and restarts if the process exits.

Test mode, no Telegram messages:

```bash
scripts/install_launch_agent.sh --dry-run
```

Live alert mode:

```bash
scripts/install_launch_agent.sh
```

Open the command center after install:

```text
http://127.0.0.1:8787
```

Logs are written here:

```text
logs/tradebot.out.log
logs/tradebot.err.log
```

Remove the background service:

```bash
scripts/uninstall_launch_agent.sh
```

Live mode uses `.env` for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Keep using `--dry-run` until the watchlist, risk settings, and alert wording look right.

## CRT Secrets Live Framework

The bundled strategy is `kod_turtle_soup`, but live decisions now use the canonical CRT Secrets PDF framework recorded in `docs/trade-style-backup-and-crt-master.md`. The previous Context CRT + MSB/iFVG style is kept there as a historical backup only.

Core logic:

- HTF narrative comes first: monthly/weekly/daily/4H must allow the trade direction.
- A key level must anchor the idea: old/equal high-low, PDH/PDL/PWH/PWL/PMH/PML, or strong liquidity pool.
- Candle 1 maps the CRT range/objective.
- Candle 2 is the Turtle Soup manipulation/raid and is never a trade by itself.
- Candle 3 is the only tradable confirmation candle.
- Active profiles: `4h -> 15m` and `1d -> 1h`.
- Bullish confirmation requires sell-side Turtle Soup, then Candle 3 Model #1 or true MSS/MSB.
- Bearish confirmation requires buy-side Turtle Soup, then Candle 3 Model #1 or true MSS/MSB.
- FVG/iFVG is confluence and target context only; it is not an entry trigger.
- SMT is shown as unavailable until an intermarket feed exists; opposing SMT blocks once feed data is available.
- London/New York killzone is required for Desk `READY`.
- TP1 is the 50% mission target between entry and the final CRT objective.
- Confirmed alerts require displacement quality: directional body, expansion versus ATR, and a close in the correct part of the candle.
- Target quality is guarded: final CRT draw must offer enough room.
- Missed/chased setups are hidden: if price has already moved too far from the planned entry, the bot will not show it as actionable.

Example:

```yaml
setups:
  - name: kod-turtle-soup-reclaim
    type: kod_turtle_soup
    enabled: true
    cooldown_minutes: 45
    profiles:
      - name: intraday
        context_timeframe: 4h
        trigger_timeframe: 15m
      - name: swing
        context_timeframe: 1d
        trigger_timeframe: 1h
    lookback: 20
    msb_profiles:
      - intraday
      - swing
    msb_lookback: 30
    msb_span: 2
    require_htf_raid_confirmation: true
    htf_raid_lookback: 8
    htf_raid_confirmation_bars: 8
    important_candle_min_range_atr: 0.7
    require_displacement_confirmation: true
    displacement_min_body_ratio: 0.55
    displacement_min_range_atr: 0.65
    displacement_close_ratio: 0.7
    min_tp2_rr: 1.25
    min_final_rr: 1.0
    previous_candle_sweep: false
    min_level_age: 4
    objective_max_atr: 1.2
    stop_buffer_atr: 0.1
    max_stop_atr: 1.5
    hide_missed_setups: true
    max_chase_atr: 0.75
    max_chase_r: 0.75
    target_lookback: 60
    fvg_lookback: 50
    htf_alignment:
      mode: strict
      require_objective_for_confirmed: true
      allow_forming_without_alignment: true
      block_opposite_reclaim: true
      require_premium_discount_for_confirmed: false
    alert_stages: [forming, confirmed, invalidated]
    filters: [premium_discount, candle_profile, displacement, session, fvg, ifvg]
```

Alert stages:

- `forming`: reserved for compatibility; live PDF gate does not promote Candle 2 alone.
- `confirmed`: HTF narrative, key level, Turtle Soup, Candle 3 Model #1/MSS, FVG confluence, session, and risk gates passed.
- `invalidated`: sweep occurred, but confirmation failed before the stop zone was protected.

Each alert includes entry, stop, TP1, TP2, final HTF objective, risk width, and the rule explanation.

## Note

This project is not financial advice. Use it as a technical alerting and decision-support tool, and test every setup with dry-run mode first.
