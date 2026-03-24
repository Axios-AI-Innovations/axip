/**
 * AXIP Hive Portal — Public Network Portal
 *
 * The front door to the AXIP network. Shows network status,
 * onboarding instructions for external agents, and capability directory.
 *
 * Runs on port 4202 (separate from admin dashboard at 4201).
 * Proxies relay API data with sanitization — no sensitive fields leak.
 */

import express from 'express';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { relayFetch, sanitizeAgent, sanitizeTask } from './proxy.js';
import {
  initDataSources, closeDataSources,
  getSkillPerformance, getRecentLearningInsights, getInsightCountByDay,
  getBrainStats, getBrainGrowth, getImprovementPipeline, getBuildOutcomes
} from './data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));

const app = express();

// PUB-2: CORS headers — allow external agents and dashboards to query the portal API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Initialize data sources for Agent Intelligence dashboard
initDataSources();

// ─── Static HTML ────────────────────────────────────────────────
const portalHTML = readFileSync(join(__dirname, 'pages', 'index.html'), 'utf-8');

app.get('/', (req, res) => {
  res.type('html').send(portalHTML);
});

// ─── Health Check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Network Status (sanitized) ────────────────────────────────
app.get('/api/network/status', async (req, res) => {
  try {
    const [stats, agents] = await Promise.all([
      relayFetch('/api/stats'),
      relayFetch('/api/agents')
    ]);

    if (!stats || !agents) {
      return res.json({
        relay_online: false,
        agents_online: 0,
        agents_total: 0,
        capabilities: [],
        tasks_completed: 0,
        total_settled_usd: 0,
        agents: []
      });
    }

    // Collect unique capabilities from online agents
    const onlineAgents = agents.filter(a => a.status === 'online');
    const allCaps = new Set();
    onlineAgents.forEach(a => (a.capabilities || []).forEach(c => allCaps.add(c)));

    res.json({
      relay_online: true,
      agents_online: stats.agents?.online || 0,
      agents_total: stats.agents?.total || 0,
      capabilities: [...allCaps],
      tasks_completed: stats.tasks?.settled || 0,
      total_settled_usd: stats.ledger?.total_settled_usd || 0,
      agents: agents.map(sanitizeAgent)
    });
  } catch (err) {
    console.error(`[hive-portal] /api/network/status error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Capabilities Directory ─────────────────────────────────────
app.get('/api/network/capabilities', async (req, res) => {
  try {
    const agents = await relayFetch('/api/agents');

    if (!agents) {
      return res.json({ capabilities: [] });
    }

    // Aggregate capabilities across all agents
    const capMap = new Map();
    for (const agent of agents) {
      for (const cap of (agent.capabilities || [])) {
        if (!capMap.has(cap)) {
          capMap.set(cap, {
            name: cap,
            providers: 0,
            online_providers: 0,
            price_range: { min: null, max: null },
            avg_reputation: 0,
            reputations: []
          });
        }

        const entry = capMap.get(cap);
        entry.providers++;
        if (agent.status === 'online') entry.online_providers++;

        // Track price range
        const price = agent.pricing?.[cap]?.base_usd;
        if (price != null) {
          if (entry.price_range.min === null || price < entry.price_range.min) entry.price_range.min = price;
          if (entry.price_range.max === null || price > entry.price_range.max) entry.price_range.max = price;
        }

        // Track reputation for averaging
        if (agent.reputation != null) {
          entry.reputations.push(agent.reputation);
        }
      }
    }

    // Compute average reputation and clean up
    const capabilities = [...capMap.values()].map(cap => {
      const avg = cap.reputations.length > 0
        ? cap.reputations.reduce((a, b) => a + b, 0) / cap.reputations.length
        : null;
      delete cap.reputations;
      cap.avg_reputation = avg ? Math.round(avg * 100) / 100 : null;
      return cap;
    });

    res.json({ capabilities });
  } catch (err) {
    console.error(`[hive-portal] /api/network/capabilities error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Recent Tasks (sanitized) ───────────────────────────────────
app.get('/api/network/tasks/recent', async (req, res) => {
  try {
    const tasks = await relayFetch('/api/tasks');

    if (!tasks) {
      return res.json({ tasks: [] });
    }

    // Return last 20 tasks, sanitized (no descriptions, no agent IDs)
    const recent = tasks
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20)
      .map(sanitizeTask);

    res.json({ tasks: recent });
  } catch (err) {
    console.error(`[hive-portal] /api/network/tasks/recent error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Manifest (pass-through — public by design) ────────────────
app.get('/api/network/manifest', async (req, res) => {
  try {
    const manifest = await relayFetch('/api/manifest');
    if (!manifest) {
      return res.json({ error: 'Relay unavailable' });
    }
    res.json(manifest);
  } catch (err) {
    console.error(`[hive-portal] /api/network/manifest error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Agent Intelligence API ──────────────────────────────────────

app.get('/api/intelligence/overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const [skills, insights, brain, pipeline, builds] = await Promise.all([
      Promise.resolve(getSkillPerformance(days)),
      Promise.resolve(getRecentLearningInsights(5)),
      getBrainStats(),
      Promise.resolve(getImprovementPipeline()),
      Promise.resolve(getBuildOutcomes(30))
    ]);

    // Compute aggregate success rate
    const totalCalls = skills.reduce((sum, s) => sum + s.total_calls, 0);
    const totalSuccess = skills.reduce((sum, s) => sum + s.success_count, 0);
    const successRate = totalCalls > 0 ? Math.round(100 * totalSuccess / totalCalls) : 100;

    // Count total proposed ideas
    const proposedCount = pipeline.reduce((sum, p) => sum + p.count, 0);

    res.json({
      skills,
      recent_insights: insights,
      brain: brain || { total: 0, by_type: {}, by_agent: [] },
      pipeline,
      builds,
      stats: {
        insight_count: insights.length,
        success_rate: successRate,
        brain_total: brain?.total || 0,
        ideas_total: proposedCount
      }
    });
  } catch (err) {
    console.error(`[hive-portal] /api/intelligence/overview error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/intelligence/skills', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const skills = getSkillPerformance(days);
    res.json({ skills, days });
  } catch (err) {
    console.error(`[hive-portal] /api/intelligence/skills error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/intelligence/learning', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const insights = getRecentLearningInsights(limit);
    const trend = getInsightCountByDay(30);
    res.json({ insights, trend });
  } catch (err) {
    console.error(`[hive-portal] /api/intelligence/learning error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/intelligence/brain', async (req, res) => {
  try {
    const [stats, growth] = await Promise.all([
      getBrainStats(),
      getBrainGrowth(30)
    ]);
    res.json({
      stats: stats || { total: 0, by_type: {}, by_agent: [] },
      growth
    });
  } catch (err) {
    console.error(`[hive-portal] /api/intelligence/brain error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/intelligence/pipeline', (req, res) => {
  try {
    const pipeline = getImprovementPipeline();
    const builds = getBuildOutcomes(30);
    res.json({ pipeline, builds });
  } catch (err) {
    console.error(`[hive-portal] /api/intelligence/pipeline error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Start Server ───────────────────────────────────────────────
const { host, port } = config.server;

const server = app.listen(port, host, () => {
  console.log('');
  console.log(chalk.cyan('  ╔══════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('     AXIP HIVE PORTAL                ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray(`     http://${host}:${port}`) + '              ' + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray(`  Relay API:  ${config.relay.api_url}`));
  console.log(chalk.gray(`  Public WS:  ${config.relay.public_ws_url}`));
  console.log('');
});

// ─── Graceful Shutdown ──────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[hive-portal] ${signal} received — shutting down`);
  closeDataSources().catch(() => {});
  server.close(() => {
    console.log('[hive-portal] Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
