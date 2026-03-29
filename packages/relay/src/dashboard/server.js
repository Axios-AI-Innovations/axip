/**
 * Axios Command Center — Unified Dashboard Server
 *
 * Serves a monitoring dashboard combining:
 *   - Eli agent operations (cost, activity, reminders, builds, assessments)
 *   - AXIP network status (agents, tasks, ledger)
 *   - Demo run results (isolated demo relay DB)
 *   - System config (scheduler, model routing)
 *
 * Express on port 4201. Reads AXIP relay DB, Eli's DB, and demo DB (read-only).
 */

import express from 'express';
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath, URL } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
import * as registry from '../registry.js';
import * as taskManager from '../taskManager.js';
import { taskEvents } from '../taskManager.js';
import * as ledgerModule from '../ledger.js';
const ledger = ledgerModule;
import * as pgLedger from '../pg-ledger.js';
import { getDb } from '../db.js';
import * as logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELI_DB_PATH = '/Users/elias/eli-agent/data/eli.db';
const ELI_CONFIG_PATH = '/Users/elias/eli-agent/config/default.json';
const DEMO_DB_PATH = join(__dirname, '..', '..', 'data', 'demo-relay.db');

let eliDb = null;
let demoDb = null;

/** Open Eli's database read-only. Returns null if unavailable. */
function getEliDb() {
  if (eliDb) return eliDb;
  try {
    if (!existsSync(ELI_DB_PATH)) return null;
    eliDb = new Database(ELI_DB_PATH, { readonly: true });
    eliDb.pragma('journal_mode = WAL');
    logger.info('dashboard', 'Connected to Eli DB (read-only)');
    return eliDb;
  } catch (err) {
    logger.error('dashboard', 'Cannot open Eli DB', { error: err.message });
    return null;
  }
}

/** Read Eli's config file. Returns null if unavailable. */
function getEliConfig() {
  try {
    if (!existsSync(ELI_CONFIG_PATH)) return null;
    return JSON.parse(readFileSync(ELI_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/** Open demo relay database read-only. Re-opens each time since the demo may create/destroy it. */
function getDemoDb() {
  try {
    if (!existsSync(DEMO_DB_PATH)) {
      demoDb = null;
      return null;
    }
    // Re-open if the file reappeared after a new demo run
    if (demoDb) {
      try { demoDb.prepare('SELECT 1').get(); return demoDb; } catch { demoDb = null; }
    }
    demoDb = new Database(DEMO_DB_PATH, { readonly: true });
    demoDb.pragma('journal_mode = WAL');
    return demoDb;
  } catch {
    demoDb = null;
    return null;
  }
}

/**
 * Start the dashboard HTTP server.
 */
export function startDashboard(port = 4201, host = '127.0.0.1', manifest = {}) {
  const app = express();

  // ─── Health Check ────────────────────────────────────────────

  app.get('/health', (req, res) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get(); // verify DB is accessible
      const agents_online = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'online'").get().count;
      res.json({ status: 'ok', uptime: process.uptime(), agents_online, relay_version: pkg.version });
    } catch {
      res.status(503).json({ status: 'error', uptime: process.uptime(), agents_online: 0, relay_version: pkg.version });
    }
  });

  // Redirect to unified dashboard at Hive Portal
  app.get('/', (req, res) => {
    res.redirect('http://127.0.0.1:4202/');
  });

  // ─── SSE: Live Activity Stream ─────────────────────────────────

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial keepalive
    res.write(': connected\n\n');

    const handler = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    taskEvents.on('activity', handler);

    // Keepalive every 30s to prevent proxy timeouts
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      taskEvents.off('activity', handler);
      clearInterval(keepalive);
    });
  });

  // ─── Network Manifest ───────────────────────────────────────

  app.get('/api/manifest', (req, res) => {
    res.json(manifest);
  });

  // ─── AXIP API Endpoints ────────────────────────────────────

  app.get('/api/agents', (req, res) => {
    try {
      const agents = registry.getAllAgents().map(a => ({
        ...a,
        capabilities: JSON.parse(a.capabilities || '[]'),
        pricing: JSON.parse(a.pricing || '{}'),
        metadata: JSON.parse(a.metadata || '{}')
      }));
      res.json(agents);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tasks', (req, res) => {
    try {
      res.json(taskManager.getAllTasks());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ledger', (req, res) => {
    try {
      Promise.resolve(ledgerModule.getLedgerHistory()).then(data => res.json(data)).catch(err => res.status(500).json({ error: err.message }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Credit / Balance API (PAY-6) ───────────────────────────

  app.get('/api/credits/balance/:agentId', async (req, res) => {
    if (!pgLedger.isPgAvailable()) {
      return res.status(503).json({ error: 'PostgreSQL credit system unavailable' });
    }
    try {
      const account = await pgLedger.getBalance(req.params.agentId);
      if (!account) return res.status(404).json({ error: 'Agent account not found' });
      res.json({ agent_id: req.params.agentId, ...account });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/credits/transactions/:agentId', async (req, res) => {
    if (!pgLedger.isPgAvailable()) {
      return res.status(503).json({ error: 'PostgreSQL credit system unavailable' });
    }
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const transactions = await pgLedger.getTransactionHistory(req.params.agentId, limit);
      res.json(transactions);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/credits/platform', async (req, res) => {
    if (!pgLedger.isPgAvailable()) {
      return res.status(503).json({ error: 'PostgreSQL credit system unavailable' });
    }
    try {
      const earnings = await pgLedger.getPlatformEarnings();
      res.json(earnings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PAY-7: Deposit bonus preview (no auth required — used for UI price display)
  app.get('/api/credits/deposit-preview', (req, res) => {
    const amount = parseFloat(req.query.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount query param required (positive number)' });
    }
    const preview = ledger.calculateDepositBonus(amount);
    res.json({
      amount_usd: amount,
      bonus_rate: preview.bonusRate,
      bonus_credits: preview.bonusCredits,
      total_credits: preview.totalCredits,
      tiers: [
        { threshold_usd: 200, bonus_rate: 0.10, label: '10% bonus' },
        { threshold_usd: 50,  bonus_rate: 0.05, label: '5% bonus' },
        { threshold_usd: 0,   bonus_rate: 0.00, label: 'No bonus' }
      ]
    });
  });

  // PAY-7: Manual deposit (internal/admin — for testing before Stripe is wired up)
  app.post('/api/credits/deposit', express.json(), async (req, res) => {
    const { agent_id, amount_usd, stripe_payment_id } = req.body || {};
    if (!agent_id || !amount_usd || amount_usd <= 0) {
      return res.status(400).json({ error: 'agent_id and amount_usd required' });
    }
    try {
      // ledger.creditDeposit calls ensurePg() internally
      const result = await ledger.creditDeposit(agent_id, parseFloat(amount_usd), stripe_payment_id || null);
      if (!result.success) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/credits/deposits/:agentId', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const deposits = await ledger.getDepositHistory(req.params.agentId, limit);
      res.json(deposits);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stats', (req, res) => {
    try {
      const db = getDb();
      const agentCount = db.prepare('SELECT COUNT(DISTINCT name) as count FROM agents').get().count;
      const onlineCount = db.prepare("SELECT COUNT(DISTINCT name) as count FROM agents WHERE status = 'online'").get().count;
      const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
      const settledCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE state = 'SETTLED'").get().count;
      const totalSettled = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM ledger').get().total;
      res.json({
        agents: { total: agentCount, online: onlineCount },
        tasks: { total: taskCount, settled: settledCount },
        ledger: { total_settled_usd: totalSettled }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Eli API Endpoints ─────────────────────────────────────

  app.get('/api/eli/cost', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json({ today: 0, week: 0, month: 0, topTasks: [] });
    try {
      const today = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE date(timestamp) = date('now')`).get().total;
      const week = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE timestamp >= datetime('now', '-7 days')`).get().total;
      const month = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`).get().total;
      const topTasks = db.prepare(`
        SELECT task_name, SUM(cost_usd) as total_cost, COUNT(*) as call_count,
          SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END) as paid_count
        FROM api_calls WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
        GROUP BY task_name ORDER BY total_cost DESC LIMIT 5
      `).all();
      res.json({ today, week, month, topTasks });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/budget', (req, res) => {
    const db = getEliDb();
    const config = getEliConfig();
    const budgetConfig = config?.budget || {};
    if (!db) return res.json({ daily: { spend: 0, cap: 3, warning: 2 }, weekly: { spend: 0, cap: 15, warning: 10 }, monthly: { spend: 0, cap: 50, warning: 20 } });
    try {
      const dailySpend = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE date(timestamp) = date('now')`).get().total;
      const weeklySpend = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE timestamp >= datetime('now', '-7 days')`).get().total;
      const monthlySpend = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_calls WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`).get().total;
      res.json({
        daily: {
          spend: dailySpend,
          cap: budgetConfig.daily_cap_usd || 3,
          warning: budgetConfig.daily_warning_usd || 2
        },
        weekly: {
          spend: weeklySpend,
          cap: budgetConfig.weekly_cap_usd || 15,
          warning: budgetConfig.weekly_warning_usd || 10
        },
        monthly: {
          spend: monthlySpend,
          cap: budgetConfig.monthly_cap_usd || 50,
          warning: budgetConfig.monthly_warning_usd || 20
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/tokens', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`
        SELECT provider, model, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output,
          SUM(cost_usd) as total_cost, COUNT(*) as call_count
        FROM api_calls WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
        GROUP BY provider, model ORDER BY total_cost DESC
      `).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/activity', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT skill, output_summary, created_at FROM eli_outputs ORDER BY created_at DESC LIMIT 15`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/reminders', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT id, message, remind_at, event_time, status FROM reminders WHERE status = 'pending' ORDER BY remind_at ASC LIMIT 10`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/builds', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT id, feature_request, status, cost_usd, duration_ms, error, created_at, completed_at FROM builds ORDER BY created_at DESC LIMIT 10`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/assessments', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`
        SELECT a.id, a.client_name, a.industry, a.status, a.created_at, a.completed_at,
          COUNT(w.id) as workflow_count, COALESCE(SUM(w.estimated_annual_value), 0) as total_estimated_value
        FROM assessments a LEFT JOIN assessment_workflows w ON w.assessment_id = a.id
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT 10
      `).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/emails', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json({ total: 0, breakdown: {} });
    try {
      const rows = db.prepare(`SELECT classification, COUNT(*) as count FROM email_log GROUP BY classification`).all();
      const total = rows.reduce((sum, r) => sum + r.count, 0);
      const breakdown = {};
      for (const r of rows) breakdown[r.classification] = r.count;
      res.json({ total, breakdown });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/content', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT id, topic, angle, platform, due_date, status FROM content_calendar ORDER BY due_date ASC LIMIT 10`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/initiatives', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT id, category, description, status, estimated_cost_usd, priority, created_at, completed_at, result_summary FROM initiative_queue ORDER BY created_at DESC LIMIT 10`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/prospects', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`SELECT id, company_name, brief, timestamp FROM prospects ORDER BY timestamp DESC LIMIT 10`).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eli/scheduler', (req, res) => {
    const config = getEliConfig();
    if (!config) return res.json({ jobs: [], activeHours: null });
    res.json({ jobs: config.scheduler?.jobs || [], activeHours: config.scheduler?.active_hours || null });
  });

  app.get('/api/eli/system', (req, res) => {
    const config = getEliConfig();
    if (!config) return res.json({});
    res.json({
      instance: config.instance || {},
      routing: config.models?.routing || {},
      axip: config.axip || {}
    });
  });

  // ─── Assessment Demo API Endpoints ──────────────────────

  app.get('/api/assessment/list', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`
        SELECT a.id, a.client_name, a.industry, a.employee_count, a.tool_stack,
          a.ai_maturity, a.decision_maker, a.status, a.created_at, a.completed_at,
          COUNT(w.id) as workflow_count,
          COALESCE(SUM(w.estimated_annual_value), 0) as total_estimated_value,
          COALESCE(SUM(w.annual_hours_recoverable), 0) as total_hours_recoverable,
          COALESCE(SUM(w.annual_hours_consumed), 0) as total_hours_consumed
        FROM assessments a LEFT JOIN assessment_workflows w ON w.assessment_id = a.id
        WHERE a.status IN ('scored', 'reported')
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT 10
      `).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/assessment/:id', (req, res) => {
    const db = getEliDb();
    if (!db) return res.json(null);
    try {
      const assessment = db.prepare(`
        SELECT * FROM assessments WHERE id = ?
      `).get(req.params.id);
      if (!assessment) return res.json(null);

      const workflows = db.prepare(`
        SELECT * FROM assessment_workflows WHERE assessment_id = ? ORDER BY composite_score DESC
      `).all(req.params.id);

      // Compute summary stats
      const quickWins = workflows.filter(w => w.tier === 'Quick Win');
      const strategic = workflows.filter(w => w.tier === 'Strategic Play');
      const longTerm = workflows.filter(w => w.tier === 'Long-Term');
      const deprioritized = workflows.filter(w => w.tier === 'Deprioritize');

      const totalHoursConsumed = workflows.reduce((s, w) => s + (w.annual_hours_consumed || 0), 0);
      const totalHoursRecoverable = workflows.reduce((s, w) => s + (w.annual_hours_recoverable || 0), 0);
      const totalEstimatedValue = workflows.reduce((s, w) => s + (w.estimated_annual_value || 0), 0);

      // Phase 1 quick wins value
      const phase1Value = quickWins.reduce((s, w) => s + (w.estimated_annual_value || 0), 0);
      const phase1Hours = quickWins.reduce((s, w) => s + (w.annual_hours_recoverable || 0), 0);

      res.json({
        assessment,
        workflows,
        summary: {
          total_workflows: workflows.length,
          quick_wins: quickWins.length,
          strategic_plays: strategic.length,
          long_term: longTerm.length,
          deprioritized: deprioritized.length,
          total_hours_consumed: totalHoursConsumed,
          total_hours_recoverable: totalHoursRecoverable,
          total_estimated_value: totalEstimatedValue,
          phase1_value: phase1Value,
          phase1_hours: phase1Hours,
          automation_rate: totalHoursConsumed > 0 ? totalHoursRecoverable / totalHoursConsumed : 0
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Demo API Endpoints ──────────────────────────────────

  app.get('/api/demo/stats', (req, res) => {
    const db = getDemoDb();
    if (!db) return res.json({ available: false });
    try {
      const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
      const onlineCount = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'online'").get().count;
      const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
      const settledCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE state = 'SETTLED'").get().count;
      const totalSettled = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM ledger').get().total;
      res.json({
        available: true,
        agents: { total: agentCount, online: onlineCount },
        tasks: { total: taskCount, settled: settledCount },
        ledger: { total_settled_usd: totalSettled }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/demo/agents', (req, res) => {
    const db = getDemoDb();
    if (!db) return res.json([]);
    try {
      const agents = db.prepare('SELECT * FROM agents ORDER BY registered_at ASC').all().map(a => ({
        ...a,
        capabilities: JSON.parse(a.capabilities || '[]'),
        pricing: JSON.parse(a.pricing || '{}')
      }));
      res.json(agents);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/demo/tasks', (req, res) => {
    const db = getDemoDb();
    if (!db) return res.json([]);
    try {
      const tasks = db.prepare(`
        SELECT t.*,
          ra.name as requester_name, aa.name as assignee_name
        FROM tasks t
        LEFT JOIN agents ra ON ra.agent_id = t.requester_id
        LEFT JOIN agents aa ON aa.agent_id = t.assignee_id
        ORDER BY t.created_at ASC
      `).all();
      // Attach bids to each task
      for (const task of tasks) {
        task.bids = db.prepare(`
          SELECT b.*, a.name as bidder_name
          FROM bids b LEFT JOIN agents a ON a.agent_id = b.bidder_id
          WHERE b.task_id = ?
          ORDER BY b.created_at ASC
        `).all(task.task_id);
      }
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/demo/ledger', (req, res) => {
    const db = getDemoDb();
    if (!db) return res.json([]);
    try {
      res.json(db.prepare(`
        SELECT l.*, fa.name as from_name, ta.name as to_name
        FROM ledger l
        LEFT JOIN agents fa ON fa.agent_id = l.from_agent
        LEFT JOIN agents ta ON ta.agent_id = l.to_agent
        ORDER BY l.timestamp ASC
      `).all());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/demo/flow', (req, res) => {
    const db = getDemoDb();
    if (!db) return res.json([]);
    try {
      // Build a combined timeline from tasks, bids, ledger, and reputation events
      const events = [];

      // Agent registrations
      for (const a of db.prepare('SELECT * FROM agents ORDER BY registered_at ASC').all()) {
        events.push({
          time: a.registered_at, type: 'agent_registered',
          agent: a.name, agent_id: a.agent_id,
          detail: `Capabilities: ${JSON.parse(a.capabilities || '[]').join(', ')}`
        });
      }

      // Task lifecycle
      for (const t of db.prepare('SELECT t.*, ra.name as requester_name, aa.name as assignee_name FROM tasks t LEFT JOIN agents ra ON ra.agent_id = t.requester_id LEFT JOIN agents aa ON aa.agent_id = t.assignee_id ORDER BY t.created_at ASC').all()) {
        events.push({
          time: t.created_at, type: 'task_created',
          task_id: t.task_id, agent: t.requester_name,
          detail: `${t.capability_required}: ${t.description?.slice(0, 80) || ''}`
        });
        if (t.state === 'SETTLED' || t.state === 'COMPLETED' || t.state === 'VERIFIED') {
          events.push({
            time: t.updated_at, type: `task_${t.state.toLowerCase()}`,
            task_id: t.task_id, agent: t.assignee_name,
            detail: t.quality_score != null ? `Quality: ${t.quality_score}` : ''
          });
        }
      }

      // Bids
      for (const b of db.prepare('SELECT b.*, a.name as bidder_name FROM bids b LEFT JOIN agents a ON a.agent_id = b.bidder_id ORDER BY b.created_at ASC').all()) {
        events.push({
          time: b.created_at, type: b.accepted ? 'bid_accepted' : 'bid_placed',
          task_id: b.task_id, agent: b.bidder_name,
          detail: `$${b.price_usd.toFixed(4)} — ${b.model || 'unknown'}`
        });
      }

      // Settlements
      for (const l of db.prepare('SELECT l.*, fa.name as from_name, ta.name as to_name FROM ledger l LEFT JOIN agents fa ON fa.agent_id = l.from_agent LEFT JOIN agents ta ON ta.agent_id = l.to_agent ORDER BY l.timestamp ASC').all()) {
        events.push({
          time: l.timestamp, type: 'settlement',
          agent: `${l.from_name} → ${l.to_name}`,
          detail: `$${l.amount.toFixed(4)} (${l.type})`
        });
      }

      // Reputation events
      try {
        for (const r of db.prepare('SELECT r.*, a.name as agent_name FROM reputation_events r LEFT JOIN agents a ON a.agent_id = r.agent_id ORDER BY r.timestamp ASC').all()) {
          events.push({
            time: r.timestamp, type: 'reputation_update',
            agent: r.agent_name, task_id: r.task_id,
            detail: `Score: ${r.composite_score.toFixed(2)}`
          });
        }
      } catch { /* reputation_events table may not exist in older DBs */ }

      // Sort by time
      events.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, host, () => {
    logger.info('dashboard', 'Listening', { url: `http://${host}:${port}` });
    getEliDb();
  });
}
