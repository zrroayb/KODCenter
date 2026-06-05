#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ayberkgocer.tradebot"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$ROOT_DIR/logs"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "$ROOT_DIR/.venv/bin/tradebot-web" ]]; then
  echo "Missing executable: $ROOT_DIR/.venv/bin/tradebot-web" >&2
  echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true

DRY_RUN_ARG=""
if [[ "$DRY_RUN" == "true" ]]; then
  DRY_RUN_ARG="    <string>--dry-run</string>"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${ROOT_DIR}/.venv/bin/tradebot-web</string>
    <string>--config</string>
    <string>${ROOT_DIR}/config.yaml</string>
    <string>--env-file</string>
    <string>${ROOT_DIR}/.env</string>
    <string>--state-file</string>
    <string>${ROOT_DIR}/.tradebot_state.json</string>
    <string>--journal-file</string>
    <string>${ROOT_DIR}/.tradebot_journal.json</string>
    <string>--alerts-file</string>
    <string>${ROOT_DIR}/.tradebot_alerts.json</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8787</string>
    <string>--auto-start</string>
    <string>--log-level</string>
    <string>INFO</string>
${DRY_RUN_ARG}
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/tradebot.out.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/tradebot.err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key>
    <string>1</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Tradebot background service installed."
echo "Mode: $([[ "$DRY_RUN" == "true" ]] && echo "dry-run" || echo "live Telegram")"
echo "Dashboard: http://127.0.0.1:8787"
echo "Plist: $PLIST_PATH"
echo "Logs: $LOG_DIR/tradebot.out.log and $LOG_DIR/tradebot.err.log"
