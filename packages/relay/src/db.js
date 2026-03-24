/**
 * AXIP Relay — Database Layer
 *
 * SQLite via better-sqlite3. Stores agent registry, task lifecycle,
 * bids, credit ledger, and reputation events.
 *
 * Follows eli-agent patterns: WAL mode, foreign keys ON, sync API.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import * as logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.AXIP_DB_PATH || join(__dirname, '..', 'data', 'relay.db');

let db;

/**
 * Initialize the database and create tables if they don't exist.
 */
export function initDatabase() {
  // Ensure data directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Registered agents
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      name TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      pricing TEXT NOT NULL DEFAULT '{}',
      reputation REAL NOT NULL DEFAULT 0.5,
      balance REAL NOT NULL DEFAULT 1.00,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      registered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Task lifecycle
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      assignee_id TEXT,
      description TEXT NOT NULL,
      capability_required TEXT NOT NULL,
      constraints TEXT DEFAULT '{}',
      reward REAL NOT NULL DEFAULT 0.0,
      state TEXT NOT NULL DEFAULT 'REQUESTED',
      result TEXT,
      quality_score REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT,
      FOREIGN KEY (requester_id) REFERENCES agents(agent_id),
      FOREIGN KEY (assignee_id) REFERENCES agents(agent_id)
    );

    -- Bids on tasks
    CREATE TABLE IF NOT EXISTS bids (
      bid_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      bidder_id TEXT NOT NULL,
      price_usd REAL NOT NULL,
      estimated_time_seconds INTEGER,
      confidence REAL,
      model TEXT,
      message TEXT,
      accepted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(task_id),
      FOREIGN KEY (bidder_id) REFERENCES agents(agent_id)
    );

    -- Credit ledger
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'settlement',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
    );

    -- Reputation events
    CREATE TABLE IF NOT EXISTS reputation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      time_score REAL,
      quality_score REAL,
      format_score REAL,
      reliability_score REAL,
      composite_score REAL NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
    CREATE INDEX IF NOT EXISTS idx_tasks_capability ON tasks(capability_required);
    CREATE INDEX IF NOT EXISTS idx_bids_task ON bids(task_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_agents ON ledger(from_agent, to_agent);
    CREATE INDEX IF NOT EXISTS idx_reputation_agent ON reputation_events(agent_id);
  `);

  // Migration: add metadata column to agents if it doesn't exist
  const cols = db.prepare("PRAGMA table_info(agents)").all();
  if (!cols.find(c => c.name === 'metadata')) {
    db.exec("ALTER TABLE agents ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
    logger.info('relay-db', 'Migration: added metadata column to agents');
  }

  logger.info('relay-db', 'Initialized', { path: DB_PATH });
  return db;
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb() {
  if (!db) throw new Error('[relay-db] Database not initialized. Call initDatabase() first.');
  return db;
}

/**
 * Close the database connection. Call on shutdown.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('relay-db', 'Connection closed.');
  }
}
