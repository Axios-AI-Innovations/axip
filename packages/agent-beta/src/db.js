/**
 * Agent Beta — Database Layer
 *
 * SQLite database for cost tracking and search caching.
 * Follows the relay's single-file pattern (simpler than Eli's two-file split).
 * Uses better-sqlite3 (synchronous API).
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const DB_PATH = process.env.SCOUT_DB_PATH || join(PROJECT_ROOT, 'data', 'beta.db');

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

let db;

/**
 * Initialize the database connection and create tables.
 * Call once at startup.
 */
export function initDatabase() {
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Every LLM inference call (mirrors Eli's api_calls schema)
    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      task_name TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0.0,
      duration_ms INTEGER,
      error TEXT
    );

    -- Search result cache (DDG rate limit protection)
    CREATE TABLE IF NOT EXISTS search_cache (
      query_hash TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_calls_task ON api_calls(task_name);
    CREATE INDEX IF NOT EXISTS idx_search_cache_time ON search_cache(cached_at);
  `);

  console.log(`[db] Database initialized at ${DB_PATH}`);
  return db;
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb() {
  if (!db) {
    throw new Error('[db] Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    console.log('[db] Database connection closed.');
  }
}
