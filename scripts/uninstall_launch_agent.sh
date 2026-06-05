#!/usr/bin/env bash
set -euo pipefail

LABEL="com.ayberkgocer.tradebot"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "Tradebot background service removed."
echo "State, journal, alerts, and logs were left in the project folder."
