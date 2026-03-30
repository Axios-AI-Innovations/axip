/**
 * Agent Summarize — Database Layer
 *
 * SQLite database for cost tracking.
 * Uses better-sqlite3 (synchronous API).
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const DB_PATH = process.env.SUMMARIZE_DB_PATH || join(PROJECT_ROOT, 'data', 'summarize.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

let db;

export function initDatabase() {
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_calls_task ON api_calls(task_name);
  `);

  console.log(`[db] Database initialized at ${DB_PATH}`);
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[db] Database closed.');
  }
}
