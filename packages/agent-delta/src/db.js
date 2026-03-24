/**
 * Agent Delta (Sentinel) — Database Layer
 *
 * SQLite database for cost tracking and alert history.
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

const DB_PATH = process.env.SENTINEL_DB_PATH || join(PROJECT_ROOT, 'data', 'delta.db');

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

    -- Alert history for sentinel monitoring
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      acknowledged INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_calls_task ON api_calls(task_name);
    CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
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
 * Insert an alert record into the database.
 *
 * @param {Object} alert
 * @param {string} alert.severity - critical/warning/info
 * @param {string} alert.source - Where the alert originated (e.g., 'health-check', 'monitor')
 * @param {string} alert.message - Human-readable alert message
 * @param {Object} [alert.details] - Additional JSON details
 */
export function insertAlert({ severity, source, message, details = {} }) {
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO alerts (severity, source, message, details)
      VALUES (?, ?, ?, ?)
    `).run(severity, source, message, JSON.stringify(details));
  } catch (err) {
    console.error(`[db] Failed to insert alert: ${err.message}`);
  }
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
