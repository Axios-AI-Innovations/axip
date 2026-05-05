/**
 * AXIP Hive Portal — Data Access Layer
 *
 * Read-only access to Eli's operational databases for the Agent Intelligence dashboard.
 * SQLite: api_calls, eli_outputs, improvement_ideas, builds
 * PostgreSQL: memories (Hive Brain)
 *
 * All queries are READ-ONLY. The portal never writes to either database.
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));

// Env var overrides (mirror of index.js — keep in sync)
if (process.env.SQLITE_PATH !== undefined) config.databases.sqlite_path = process.env.SQLITE_PATH || null;
if (process.env.DATABASE_URL !== undefined) config.databases.brain_url = process.env.DATABASE_URL || null;

let sqliteDb = null;
let pgPool = null;

// ─── Initialization ─────────────────────────────────────────────

/**
 * Open read-only connections to both databases.
 */
export function initDataSources() {
  // SQLite: Eli's operational database (read-only)
  const sqlitePath = config.databases?.sqlite_path;
  if (sqlitePath) {
    try {
      sqliteDb = new Database(sqlitePath, { readonly: true });
      console.log(`  [data] SQLite connected: ${sqlitePath}`);
    } catch (err) {
      console.warn(`  [data] SQLite unavailable: ${err.message}`);
    }
  }

  // PostgreSQL: Hive Brain
  const brainUrl = config.databases?.brain_url;
  if (brainUrl) {
    try {
      pgPool = new pg.Pool({
        connectionString: brainUrl,
        max: 3,
        connectionTimeoutMillis: 5000
      });
      console.log(`  [data] PostgreSQL pool created: ${brainUrl}`);
    } catch (err) {
      console.warn(`  [data] PostgreSQL unavailable: ${err.message}`);
    }
  }
}

/**
 * Close both database connections.
 */
export async function closeDataSources() {
  if (sqliteDb) {
    try { sqliteDb.close(); } catch { /* ignore */ }
    sqliteDb = null;
  }
  if (pgPool) {
    try { await pgPool.end(); } catch { /* ignore */ }
    pgPool = null;
  }
}

// ─── SQLite Queries (Eli operational data) ──────────────────────

/**
 * Get per-skill performance stats.
 * @param {number} days - Look-back window
 */
export function getSkillPerformance(days = 7) {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(`
      SELECT task_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
        ROUND(AVG(duration_ms), 0) as avg_duration_ms,
        ROUND(SUM(cost_usd), 6) as total_cost
      FROM api_calls
      WHERE timestamp >= datetime('now', '-' || ? || ' days')
      GROUP BY task_name
      ORDER BY total_calls DESC
    `).all(days);
  } catch (err) {
    console.warn(`[data] getSkillPerformance failed: ${err.message}`);
    return [];
  }
}

/**
 * Get recent continuous-learning outputs.
 * @param {number} limit - Max results
 */
export function getRecentLearningInsights(limit = 10) {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(`
      SELECT id, skill, output_text, output_summary, created_at
      FROM eli_outputs
      WHERE skill = 'continuous-learning'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
  } catch (err) {
    console.warn(`[data] getRecentLearningInsights failed: ${err.message}`);
    return [];
  }
}

/**
 * Get learning insight count per day for trend chart.
 * @param {number} days - Look-back window
 */
export function getInsightCountByDay(days = 30) {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM eli_outputs
      WHERE skill = 'continuous-learning'
        AND created_at >= datetime('now', 'localtime', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(days);
  } catch (err) {
    console.warn(`[data] getInsightCountByDay failed: ${err.message}`);
    return [];
  }
}

/**
 * Get improvement pipeline status breakdown.
 */
export function getImprovementPipeline() {
  if (!sqliteDb) return [];
  try {
    return sqliteDb.prepare(`
      SELECT status, COUNT(*) as count
      FROM improvement_ideas
      GROUP BY status
    `).all();
  } catch (err) {
    console.warn(`[data] getImprovementPipeline failed: ${err.message}`);
    return [];
  }
}

/**
 * Get build outcomes.
 * @param {number} days - Look-back window
 */
export function getBuildOutcomes(days = 30) {
  if (!sqliteDb) return { recent: [], stats: null };
  try {
    const recent = sqliteDb.prepare(`
      SELECT id, feature_request, status, cost_usd, duration_ms, created_at
      FROM builds
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    const stats = sqliteDb.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('success', 'restarting') THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures,
        ROUND(COALESCE(SUM(cost_usd), 0), 4) as total_cost
      FROM builds
      WHERE created_at >= datetime('now', 'localtime', '-' || ? || ' days')
    `).get(days);

    return { recent, stats };
  } catch (err) {
    console.warn(`[data] getBuildOutcomes failed: ${err.message}`);
    return { recent: [], stats: null };
  }
}

// ─── PostgreSQL Queries (Hive Brain) ───────────────────────────

/**
 * Get brain memory stats by type.
 */
export async function getBrainStats() {
  if (!pgPool) return null;
  try {
    const client = await pgPool.connect();
    try {
      const total = await client.query('SELECT COUNT(*) as count FROM memories WHERE valid_until IS NULL OR valid_until > NOW()');
      const byType = await client.query(`
        SELECT memory_type, COUNT(*) as count
        FROM memories
        WHERE valid_until IS NULL OR valid_until > NOW()
        GROUP BY memory_type
        ORDER BY count DESC
      `);
      const byAgent = await client.query(`
        SELECT agent_id, COUNT(*) as count
        FROM memories
        WHERE valid_until IS NULL OR valid_until > NOW()
        GROUP BY agent_id
        ORDER BY count DESC
      `);

      return {
        total: parseInt(total.rows[0]?.count || 0),
        by_type: byType.rows.reduce((acc, r) => { acc[r.memory_type] = parseInt(r.count); return acc; }, {}),
        by_agent: byAgent.rows.map(r => ({ agent_id: r.agent_id, count: parseInt(r.count) }))
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`[data] getBrainStats failed: ${err.message}`);
    return null;
  }
}

/**
 * Get brain memory growth over time.
 * @param {number} days - Look-back window
 */
export async function getBrainGrowth(days = 30) {
  if (!pgPool) return [];
  try {
    const result = await pgPool.query(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM memories
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);
    return result.rows.map(r => ({ day: r.day, count: parseInt(r.count) }));
  } catch (err) {
    console.warn(`[data] getBrainGrowth failed: ${err.message}`);
    return [];
  }
}
