#!/usr/bin/env bash
# Daily backup for AXIP: SQLite databases + PostgreSQL hive_brain schema
# Keeps 7 days of backups. Safe to run any time — reads only, never modifies.

set -euo pipefail

AXIP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_ROOT="$AXIP_ROOT/backups"
DATE="$(date +%Y-%m-%d)"
BACKUP_DIR="$BACKUP_ROOT/$DATE"
LOG="$BACKUP_ROOT/backup.log"
PG_DUMP="${PG_DUMP_PATH:-/opt/homebrew/opt/postgresql@17/bin/pg_dump}"
PG_DATABASE="${BRAIN_DATABASE_URL:-postgresql://localhost:5432/hive_brain}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

mkdir -p "$BACKUP_DIR"

log "=== AXIP backup start ($DATE) ==="

# --- SQLite databases ---
SQLITE_COUNT=0
while IFS= read -r -d '' db_file; do
  # Preserve relative path structure: packages/relay/data/relay.db -> relay_data_relay.db
  rel="${db_file#$AXIP_ROOT/packages/}"
  dest_name="${rel//\//_}"
  dest="$BACKUP_DIR/$dest_name"
  # Use SQLite .backup to get a consistent snapshot even if the DB is open
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$db_file" ".backup '$dest'" 2>>"$LOG" && log "  SQLite OK: $dest_name" || log "  SQLite WARN: $dest_name failed"
  else
    cp "$db_file" "$dest" && log "  SQLite (cp) OK: $dest_name" || log "  SQLite WARN: $dest_name failed"
  fi
  SQLITE_COUNT=$((SQLITE_COUNT + 1))
done < <(find "$AXIP_ROOT/packages" -name "*.db" -not -path "*/node_modules/*" -print0)

log "  $SQLITE_COUNT SQLite databases backed up"

# --- PostgreSQL hive_brain (axip_marketplace schema) ---
if [[ -x "$PG_DUMP" ]]; then
  PG_OUT="$BACKUP_DIR/hive_brain_axip_marketplace.sql"
  if "$PG_DUMP" --schema=axip_marketplace "$PG_DATABASE" > "$PG_OUT" 2>>"$LOG"; then
    BYTES=$(wc -c < "$PG_OUT" | tr -d ' ')
    log "  PostgreSQL OK: hive_brain (axip_marketplace) — ${BYTES} bytes"
  else
    log "  PostgreSQL WARN: pg_dump failed (is PostgreSQL running?). SQLite backups are complete."
    rm -f "$PG_OUT"
  fi
else
  log "  PostgreSQL SKIP: pg_dump not found at $PG_DUMP"
fi

# --- Prune backups older than 7 days ---
PRUNED=0
while IFS= read -r -d '' old_dir; do
  rm -rf "$old_dir"
  log "  Pruned: $(basename "$old_dir")"
  PRUNED=$((PRUNED + 1))
done < <(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +7 -print0)
[[ $PRUNED -gt 0 ]] && log "  $PRUNED old backup(s) pruned" || log "  No backups to prune"

log "=== AXIP backup complete ==="
