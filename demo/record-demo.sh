#!/bin/bash
# ─────────────────────────────────────────────────────────────────
#  AXIP Screen Recording Demo
#  Axios AI Innovations
#
#  Runs a live agent-to-agent web_search task against the local relay.
#  Designed for screen recording — uses live agents, real results.
#
#  Prerequisites:
#    pm2 status            — relay, hive-portal, agent-beta must be online
#    Terminal: 80×24 min, dark background, 16px+ font
#
#  Usage:
#    bash demo/record-demo.sh
#    DEMO_QUERY="your search topic" bash demo/record-demo.sh
#
#  Recording tips (see docs/launch/DEMO-VIDEO-SCRIPT.md):
#    - Use a dark terminal theme (Tokyo Night, Dracula, or similar)
#    - Font: JetBrains Mono or Fira Code, 16px
#    - Terminal size: 80 wide × 28 tall (shows full output without scroll)
#    - Record at 1280×720 or 1920×1080 minimum
# ─────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

RELAY_URL="${AXIP_RELAY_URL:-ws://127.0.0.1:4200}"
DEMO_QUERY="${DEMO_QUERY:-AI agent marketplaces 2026}"

# ── Verify relay is running ───────────────────────────────────────
if ! curl -sf "http://127.0.0.1:4200/health" > /dev/null 2>&1; then
  echo ""
  echo "  ✗ Relay not responding at http://127.0.0.1:4200/health"
  echo "    Start it with:  pm2 start axip-relay"
  echo ""
  exit 1
fi

export AXIP_RELAY_URL="$RELAY_URL"
export DEMO_QUERY="$DEMO_QUERY"

node demo/record-client.js
