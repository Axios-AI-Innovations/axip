#!/bin/bash
# ─────────────────────────────────────────────────────
#  AXIP Protocol Demo — End-to-End (Isolated)
#  Axios AI Innovations
#
#  Runs a full prospect research flow on separate ports
#  so the live relay + agents are not affected.
#
#  Usage: bash demo/run-demo.sh
# ─────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   AXIP — Axios Agent Interchange Protocol Demo v0.1          ║"
echo "║   By Axios AI Innovations                                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Install deps if needed ───────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[SETUP] Installing dependencies..."
  npm install
  echo ""
fi

# ─── Isolated demo environment ────────────────────────────────
# Use separate ports and databases so the live system is untouched
export AXIP_RELAY_PORT=4210
export AXIP_RELAY_HOST=127.0.0.1
export AXIP_DASH_PORT=4211
export AXIP_DASH_HOST=127.0.0.1
export AXIP_RELAY_URL="ws://127.0.0.1:4210"
export AXIP_DB_PATH="$PROJECT_DIR/packages/relay/data/demo-relay.db"
export SCOUT_DB_PATH="$PROJECT_DIR/packages/agent-beta/data/demo-beta.db"

echo "[SETUP] Demo environment:"
echo "        Relay:     ws://127.0.0.1:4210"
echo "        Dashboard: http://127.0.0.1:4211"
echo "        Relay DB:  packages/relay/data/demo-relay.db"
echo "        Beta DB:   packages/agent-beta/data/demo-beta.db"
echo ""

# Clean previous demo state (never touch live DBs)
rm -f "$AXIP_DB_PATH" "$AXIP_DB_PATH-shm" "$AXIP_DB_PATH-wal" 2>/dev/null || true
rm -f "$SCOUT_DB_PATH" "$SCOUT_DB_PATH-shm" "$SCOUT_DB_PATH-wal" 2>/dev/null || true
rm -rf ~/.axip/eli-alpha ~/.axip/scout-beta ~/.axip/demo-client 2>/dev/null || true
echo "[SETUP] ✓ Cleaned previous demo state (identities + databases)"
echo ""

# ─── Process Management ──────────────────────────────────────

PIDS=()

cleanup() {
  echo ""
  echo "[DEMO]  Shutting down demo processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "[DEMO]  ✓ All demo processes stopped. Live system unaffected."
}

trap cleanup EXIT

# ─── 1. Start Demo Relay Server ───────────────────────────────

echo "[DEMO]  Starting demo relay server (port 4210)..."
node packages/relay/src/index.js &
PIDS+=($!)
sleep 3

# ─── 2. Start Demo Agent Beta (web_search provider) ──────────

echo "[DEMO]  Starting demo Agent Beta (web_search, summarize)..."
node packages/agent-beta/src/index.js &
PIDS+=($!)
sleep 2

# ─── 3. Start Demo Agent Alpha (prospect_research) ───────────

echo "[DEMO]  Starting demo Agent Alpha (prospect_research)..."
node packages/agent-alpha/src/index.js &
PIDS+=($!)
sleep 2

# ─── 4. Run Demo Client ──────────────────────────────────────

echo "[DEMO]  Starting demo client..."
node demo/client.js

# Client exits on completion — show wrap-up
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   Demo complete!                                             ║"
echo "║                                                              ║"
echo "║   Demo Dashboard: http://127.0.0.1:4211                     ║"
echo "║   Live Dashboard: check the Demo tab                        ║"
echo "║                                                              ║"
echo "║   Press Ctrl+C to stop demo processes.                      ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Keep running so dashboard stays accessible
wait
