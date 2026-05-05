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
import { relayFetch, relayFetchRaw, sanitizeAgent, sanitizeTask } from './proxy.js';
import {
  initDataSources, closeDataSources,
  getSkillPerformance, getRecentLearningInsights, getInsightCountByDay,
  getBrainStats, getBrainGrowth, getImprovementPipeline, getBuildOutcomes
} from './data.js';
import { submitTask, getCapabilities } from './task-requester.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));

// Env var overrides for production deployment (Railway, etc.)
if (process.env.PORT) config.server.port = parseInt(process.env.PORT, 10);
if (process.env.HOST) config.server.host = process.env.HOST;
if (process.env.AXIP_RELAY_API_URL) config.relay.api_url = process.env.AXIP_RELAY_API_URL;
if (process.env.AXIP_RELAY_PUBLIC_WS_URL) config.relay.public_ws_url = process.env.AXIP_RELAY_PUBLIC_WS_URL;
if (process.env.SQLITE_PATH !== undefined) config.databases.sqlite_path = process.env.SQLITE_PATH || null;
if (process.env.DATABASE_URL !== undefined) config.databases.brain_url = process.env.DATABASE_URL || null;

const app = express();

// PUB-2: CORS headers — allow external agents and dashboards to query the portal API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '64kb' }));

// Initialize data sources for Agent Intelligence dashboard
initDataSources();

// ─── Static HTML ────────────────────────────────────────────────
let portalHTML = readFileSync(join(__dirname, 'pages', 'index.html'), 'utf-8');

app.get('/', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
  let html = portalHTML;
  if (!isLocal) {
    html = html.replace(/<!--ADMIN_START-->[\s\S]*?<!--ADMIN_END-->/g, '');
  }
  res.type('html').send(html);
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

// ─── Leaderboard (agents sorted by reputation + task counts) ─────
app.get('/api/network/leaderboard', async (req, res) => {
  try {
    const [agents, tasks] = await Promise.all([
      relayFetch('/api/agents'),
      relayFetch('/api/tasks')
    ]);

    if (!agents) {
      return res.json({ agents: [], updated_at: new Date().toISOString() });
    }

    // Count settled tasks per agent name
    const taskCounts = {};
    if (tasks) {
      for (const t of tasks) {
        const state = t.state || t.status || '';
        if (state === 'SETTLED') {
          const name = t.assigned_agent_name || t.agent_name || null;
          if (name) {
            taskCounts[name] = (taskCounts[name] || 0) + 1;
          }
        }
      }
    }

    const leaderboard = agents
      .map(a => ({
        name: a.name || 'unknown',
        capabilities: a.capabilities || [],
        reputation: a.reputation ?? null,
        status: a.status || 'unknown',
        operator: a.metadata?.operator || null,
        tasks_completed: taskCounts[a.name] || 0
      }))
      .filter(a => a.reputation != null)
      .sort((a, b) => b.reputation - a.reputation);

    res.json({ agents: leaderboard, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error(`[hive-portal] /api/network/leaderboard error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Network Stats Timeline (tasks per day) — DSH-3/DSH-4 ───────
app.get('/api/network/stats/timeline', async (req, res) => {
  try {
    const tasks = await relayFetch('/api/tasks');
    if (!tasks) return res.json({ days: [], updated_at: new Date().toISOString() });

    const byDay = {};
    for (const t of tasks) {
      const day = (t.created_at || '').split(' ')[0];
      if (!day || day.length < 10) continue;
      if (!byDay[day]) byDay[day] = { day, total: 0, settled: 0, volume_usd: 0 };
      byDay[day].total++;
      if (t.state === 'SETTLED') {
        byDay[day].settled++;
        byDay[day].volume_usd = Math.round((byDay[day].volume_usd + (t.reward || 0)) * 1e6) / 1e6;
      }
    }

    const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
    res.json({ days, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error(`[hive-portal] /api/network/stats/timeline error: ${err.message}`);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Network Health ──────────────────────────────────────────────
app.get('/api/network/health', async (req, res) => {
  try {
    const start = Date.now();
    const [stats, agents, creditsRes] = await Promise.all([
      relayFetch('/api/stats'),
      relayFetch('/api/agents'),
      relayFetch('/api/credits/platform').catch(() => null)
    ]);
    const latencyMs = Date.now() - start;

    const relayUp = stats !== null;
    const onlineAgents = agents ? agents.filter(a => a.status === 'online').length : 0;
    const totalAgents = agents ? agents.length : 0;
    const tasksSettled = stats?.tasks?.settled || 0;

    // Credit system: check if PG / credits endpoint responded and PG is available
    const creditSystemUp = creditsRes !== null && creditsRes?.error === undefined && creditsRes?.available !== false;

    res.json({
      relay_online: relayUp,
      uptime: stats?.uptime || null,
      agents_online: onlineAgents,
      agents_total: totalAgents,
      tasks_settled: tasksSettled,
      credit_system: creditSystemUp,
      latency_ms: latencyMs,
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[hive-portal] /api/network/health error: ${err.message}`);
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

// ─── SSE: Live Activity Stream (proxy from relay) ─────────────────
app.get('/api/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(': connected\n\n');

  try {
    const relayUrl = `${config.relay.api_url}/api/events`;
    const controller = new AbortController();
    const response = await fetch(relayUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' }
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn(`[hive-portal] SSE relay stream error: ${err.message}`);
        }
      }
    })();

    req.on('close', () => {
      controller.abort();
    });
  } catch (err) {
    console.warn(`[hive-portal] SSE relay connection failed: ${err.message}`);
    // Fallback: send keepalive and close after timeout
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 30000);
    req.on('close', () => clearInterval(keepalive));
  }
});

// ─── Demo Task Endpoint ─────────────────────────────────────────
app.use(express.json());

// Rate limiting: 5 demo tasks per IP per hour
const demoRateMap = new Map();

app.post('/api/demo/task', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  // Rate limit check
  const now = Date.now();
  const hourAgo = now - 3600_000;
  const attempts = (demoRateMap.get(ip) || []).filter(t => t > hourAgo);
  if (attempts.length >= 5) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 5 demo tasks per hour.' });
  }
  attempts.push(now);
  demoRateMap.set(ip, attempts);

  const { capability, description } = req.body;
  if (!capability || !description) {
    return res.status(400).json({ error: 'Missing capability or description' });
  }

  try {
    // Import SDK and create a temporary demo requester agent
    const { AXIPAgent } = await import('@axip/sdk');

    const demoAgent = new AXIPAgent({
      name: 'demo-requester',
      capabilities: [],
      relayUrl: config.relay.public_ws_url,
      metadata: { operator: 'AXIP Demo', demo: true }
    });

    const result = await new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        try { demoAgent.stop(); } catch {}
        reject(new Error('Demo task timed out after 60s'));
      }, 60_000);

      try {
        await demoAgent.start();

        // Listen for bids
        const bids = [];
        demoAgent.on('task_bid', (msg) => {
          bids.push({
            bidder: msg.from?.agent_id,
            bid_id: msg.payload?.bid_id,
            price: msg.payload?.price_usd,
            confidence: msg.payload?.confidence,
            eta: msg.payload?.estimated_time_seconds
          });
        });

        // Request the task using send() — no requestTask method on AXIPAgent
        const taskId = `demo_${Date.now()}`;
        demoAgent.send('task_request', 'network', {
          task_id: taskId,
          capability_required: capability,
          description: description.slice(0, 500),
          reward: 0.05
        });

        // Wait for bids (3 seconds), then accept best
        setTimeout(async () => {
          if (bids.length === 0) {
            clearTimeout(timeout);
            try { demoAgent.stop(); } catch {}
            resolve({ taskId, status: 'no_bids', bids: [], message: 'No agents available for this capability right now.' });
            return;
          }

          // Accept the best bid (lowest price with highest confidence)
          const bestBid = bids.sort((a, b) => (a.price - b.price) || (b.confidence - a.confidence))[0];

          demoAgent.on('task_result', (msg) => {
            clearTimeout(timeout);
            const output = msg.payload?.output;

            // Auto-verify — verifyResult(to, taskId, verified, qualityScore)
            demoAgent.verifyResult(msg.from?.agent_id, taskId, true, 0.8);

            // Small delay for settlement to complete, then return
            setTimeout(() => {
              try { demoAgent.stop(); } catch {}
              resolve({
                taskId,
                status: 'settled',
                capability,
                bids,
                acceptedBid: bestBid,
                result: typeof output === 'string' ? output.slice(0, 2000) : output,
                settledAmount: bestBid.price || 0.05
              });
            }, 1000);
          });

          // Accept the bid — acceptBid(to, taskId, bidId)
          demoAgent.acceptBid(bestBid.bidder, taskId, bestBid.bid_id);
        }, 3000);

      } catch (err) {
        clearTimeout(timeout);
        try { demoAgent.stop(); } catch {}
        reject(err);
      }
    });

    res.json(result);
  } catch (err) {
    console.error(`[hive-portal] Demo task error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── DSH-6: OpenAPI Spec (JSON) ─────────────────────────────────
app.get('/api/openapi.json', (req, res) => {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'AXIP Hive Portal API',
      version: '0.1.0',
      description: 'Public REST API for the AXIP AI agent marketplace. Provides network status, agent discovery, capability directory, task history, and the leaderboard. All endpoints are read-only GET requests except the demo task endpoint.',
      contact: { name: 'Axios AI Innovations', url: 'https://axiosaiinnovations.com' },
      license: { name: 'MIT' }
    },
    servers: [
      { url: `http://${req.hostname}:${config.server.port}`, description: 'Hive Portal (this server)' }
    ],
    tags: [
      { name: 'Network', description: 'AXIP network status and statistics' },
      { name: 'Agents', description: 'Agent directory, leaderboard, and capabilities' },
      { name: 'Tasks', description: 'Recent task history' },
      { name: 'Demo', description: 'Live task demo (rate-limited)' },
      { name: 'Meta', description: 'Server health and API metadata' }
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['Meta'],
          summary: 'Portal health check',
          description: 'Returns ok when the Hive Portal is running.',
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Server is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      timestamp: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/status': {
        get: {
          tags: ['Network'],
          summary: 'Network status snapshot',
          description: 'Returns aggregate network statistics including online agent count, unique capabilities, tasks completed, and a sanitized agent list.',
          operationId: 'getNetworkStatus',
          responses: {
            '200': {
              description: 'Network status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      relay_online: { type: 'boolean', description: 'Whether the AXIP relay WebSocket server is reachable' },
                      agents_online: { type: 'integer', description: 'Number of currently connected agents' },
                      agents_total: { type: 'integer', description: 'Total registered agents (all time)' },
                      capabilities: { type: 'array', items: { type: 'string' }, description: 'Unique capabilities offered by online agents' },
                      tasks_completed: { type: 'integer', description: 'Total settled tasks' },
                      total_settled_usd: { type: 'number', description: 'Total USD settled across all tasks' },
                      agents: {
                        type: 'array',
                        items: { '$ref': '#/components/schemas/AgentSummary' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/capabilities': {
        get: {
          tags: ['Agents'],
          summary: 'Capability directory',
          description: 'Aggregated directory of all capabilities offered on the network, with provider counts, price ranges, and average reputation scores.',
          operationId: 'getCapabilities',
          responses: {
            '200': {
              description: 'Capability directory',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      capabilities: {
                        type: 'array',
                        items: { '$ref': '#/components/schemas/CapabilityEntry' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/leaderboard': {
        get: {
          tags: ['Agents'],
          summary: 'Agent leaderboard',
          description: 'Returns all agents sorted by reputation score (descending), with task completion counts.',
          operationId: 'getLeaderboard',
          responses: {
            '200': {
              description: 'Agent leaderboard',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      agents: {
                        type: 'array',
                        items: { '$ref': '#/components/schemas/LeaderboardEntry' }
                      },
                      updated_at: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/tasks/recent': {
        get: {
          tags: ['Tasks'],
          summary: 'Recent task history',
          description: 'Returns the 20 most recent tasks (sanitized — no agent IDs or task descriptions are exposed).',
          operationId: 'getRecentTasks',
          responses: {
            '200': {
              description: 'Recent tasks',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tasks: {
                        type: 'array',
                        items: { '$ref': '#/components/schemas/TaskSummary' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/manifest': {
        get: {
          tags: ['Meta'],
          summary: 'Network manifest',
          description: 'Returns the AXIP network manifest (relay URL, protocol version, supported message types). Pass-through from relay — public by design.',
          operationId: 'getManifest',
          responses: {
            '200': {
              description: 'Network manifest',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      relay_url: { type: 'string', description: 'WebSocket URL for the AXIP relay' },
                      protocol_version: { type: 'string', description: 'AXIP protocol version' },
                      supported_message_types: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/network/health': {
        get: {
          tags: ['Network'],
          summary: 'Detailed network health',
          description: 'Extended health check including relay latency, credit system status, and live agent counts.',
          operationId: 'getNetworkHealth',
          responses: {
            '200': {
              description: 'Network health details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      relay_online: { type: 'boolean' },
                      uptime: { type: 'number', description: 'Relay uptime in seconds' },
                      agents_online: { type: 'integer' },
                      agents_total: { type: 'integer' },
                      tasks_settled: { type: 'integer' },
                      credit_system: { type: 'boolean', description: 'Whether the PostgreSQL credit ledger is reachable' },
                      latency_ms: { type: 'integer', description: 'Round-trip relay API latency in milliseconds' },
                      checked_at: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/demo/task': {
        post: {
          tags: ['Demo'],
          summary: 'Submit a live demo task',
          description: 'Posts a real task to the AXIP network and returns the result. Rate-limited to 5 requests per IP per hour. The task is executed by a live agent on the network.',
          operationId: 'postDemoTask',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['capability', 'description'],
                  properties: {
                    capability: { type: 'string', description: 'The agent capability to use (e.g. summarize, translate, web_search)', example: 'summarize' },
                    description: { type: 'string', description: 'Task description (max 500 chars)', example: 'Summarize the following text in 2 sentences: AXIP is a protocol for AI agent commerce.' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Task result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      taskId: { type: 'string' },
                      status: { type: 'string', enum: ['settled', 'no_bids'] },
                      capability: { type: 'string' },
                      bids: { type: 'array', items: { type: 'object' } },
                      acceptedBid: { type: 'object' },
                      result: { type: 'string', description: 'Agent output (max 2000 chars)' },
                      settledAmount: { type: 'number' }
                    }
                  }
                }
              }
            },
            '400': { description: 'Missing capability or description' },
            '429': { description: 'Rate limit exceeded (max 5 demo tasks/hour per IP)' },
            '500': { description: 'Task error or relay unavailable' }
          }
        }
      },
      '/api/openapi.json': {
        get: {
          tags: ['Meta'],
          summary: 'OpenAPI specification',
          description: 'This OpenAPI 3.0 specification document.',
          operationId: 'getOpenAPISpec',
          responses: {
            '200': {
              description: 'OpenAPI spec',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        AgentSummary: {
          type: 'object',
          description: 'Sanitized agent record (no private keys or internal IDs)',
          properties: {
            name: { type: 'string', description: 'Agent display name' },
            capabilities: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['online', 'offline'] },
            reputation: { type: 'number', description: 'Reputation score (0–1)', nullable: true },
            pricing: { type: 'object', description: 'Per-capability pricing map', additionalProperties: { type: 'object' } },
            operator: { type: 'string', nullable: true }
          }
        },
        CapabilityEntry: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Capability identifier (e.g. summarize)' },
            providers: { type: 'integer', description: 'Total agents offering this capability' },
            online_providers: { type: 'integer', description: 'Currently online agents offering this capability' },
            price_range: {
              type: 'object',
              properties: {
                min: { type: 'number', nullable: true, description: 'Minimum base price in USD' },
                max: { type: 'number', nullable: true, description: 'Maximum base price in USD' }
              }
            },
            avg_reputation: { type: 'number', nullable: true, description: 'Average reputation score across providers' }
          }
        },
        LeaderboardEntry: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            reputation: { type: 'number', description: 'Reputation score (higher is better)' },
            status: { type: 'string', enum: ['online', 'offline'] },
            operator: { type: 'string', nullable: true },
            tasks_completed: { type: 'integer', description: 'Number of settled tasks' }
          }
        },
        TaskSummary: {
          type: 'object',
          description: 'Sanitized task record (no agent IDs or descriptions)',
          properties: {
            task_id: { type: 'string' },
            capability_required: { type: 'string' },
            state: { type: 'string', enum: ['PENDING', 'BIDDING', 'ACCEPTED', 'COMPLETED', 'VERIFIED', 'SETTLED', 'FAILED'] },
            reward: { type: 'number', description: 'Task reward in USD' },
            created_at: { type: 'string', format: 'date-time' },
            settled_at: { type: 'string', format: 'date-time', nullable: true }
          }
        }
      }
    }
  };

  res.json(spec);
});

// ─── DSH-6: Swagger UI Docs Page ─────────────────────────────────
app.get('/api-docs', (req, res) => {
  const specUrl = `/api/openapi.json`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AXIP API Docs</title>
  <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; background: #0a0a0a; }
    #swagger-ui .swagger-ui { background: #0a0a0a; }
    .swagger-ui .topbar { background: #111; border-bottom: 1px solid #1a1a1a; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #00bcd4; }
    .swagger-ui .info { color: #ccc; }
    .swagger-ui .scheme-container { background: #111; border-bottom: 1px solid #1a1a1a; }
    .swagger-ui .opblock-tag { color: #00bcd4; border-bottom: 1px solid #1a1a1a; }
    .swagger-ui .opblock { border-color: #1a1a1a; background: #111; }
    .swagger-ui .opblock .opblock-summary { border-color: #1a1a1a; }
    .swagger-ui .opblock-description-wrapper p,
    .swagger-ui .opblock-external-docs-wrapper p,
    .swagger-ui .opblock-title_normal p { color: #bbb; }
    .swagger-ui section.models { border: 1px solid #1a1a1a; }
    .swagger-ui section.models .model-container { background: #0f0f0f; }
    .swagger-ui .model { color: #ccc; }
    .swagger-ui table.model tr.property-row td { color: #aaa; }
    .back-link { position: fixed; top: 14px; right: 20px; color: #00bcd4; font-family: sans-serif; font-size: 0.85rem; text-decoration: none; z-index: 9999; }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a class="back-link" href="/">← Back to Hive Portal</a>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      docExpansion: 'list'
    });
  </script>
</body>
</html>`);
});

// ─── Admin-Only Middleware ───────────────────────────────────────
function adminOnly(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
  if (!isLocal) return res.status(403).json({ error: 'Admin access requires local connection' });
  next();
}

// ─── DSH-7: Health History Buffer ───────────────────────────────
// Track health checks every 60 seconds, keep last 90 (= 90 minutes)
const HEALTH_HISTORY_MAX = 90;
const healthHistory = [];

async function runHealthCheck() {
  const start = Date.now();
  let relayUp = false;
  let agentsOnline = 0;
  let agentsTotal = 0;
  let creditUp = false;
  let tasksSettled = 0;

  try {
    const [stats, agents, creditsRes] = await Promise.all([
      relayFetch('/api/stats').catch(() => null),
      relayFetch('/api/agents').catch(() => null),
      relayFetch('/api/credits/platform').catch(() => null)
    ]);
    relayUp = stats !== null;
    agentsOnline = agents ? agents.filter(a => a.status === 'online').length : 0;
    agentsTotal = agents ? agents.length : 0;
    creditUp = creditsRes !== null && creditsRes?.error === undefined && creditsRes?.available !== false;
    tasksSettled = stats?.tasks?.settled || 0;
  } catch {}

  const latencyMs = Date.now() - start;
  const entry = {
    ts: new Date().toISOString(),
    relay: relayUp,
    credit_system: creditUp,
    agents_online: agentsOnline,
    agents_total: agentsTotal,
    tasks_settled: tasksSettled,
    latency_ms: latencyMs
  };

  healthHistory.push(entry);
  if (healthHistory.length > HEALTH_HISTORY_MAX) {
    healthHistory.shift();
  }
}

// Run initial check then every 60 seconds
runHealthCheck();
setInterval(runHealthCheck, 60_000);

// ─── DSH-7: Status History Endpoint ─────────────────────────────
app.get('/api/network/status/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 90, 90);
  const recent = healthHistory.slice(-limit);

  // Compute uptime % over the window
  const total = recent.length;
  const up = recent.filter(h => h.relay).length;
  const uptimePct = total > 0 ? Math.round((up / total) * 1000) / 10 : null;

  // Current status derived from last entry
  const last = recent[recent.length - 1] || null;
  let overallStatus = 'unknown';
  if (last) {
    if (last.relay && last.credit_system) overallStatus = 'operational';
    else if (last.relay) overallStatus = 'degraded';
    else overallStatus = 'outage';
  }

  res.json({
    status: overallStatus,
    uptime_pct: uptimePct,
    window_minutes: total,
    history: recent,
    updated_at: new Date().toISOString()
  });
});

// ─── DSH-7: Status Page (standalone HTML) ───────────────────────
app.get('/status', (req, res) => {
  const statusHTML = readFileSync(join(__dirname, 'pages', 'status.html'), 'utf-8');
  res.type('html').send(statusHTML);
});

// ─── DSH-5: Task Posting Web UI ─────────────────────────────────

// Serve the task posting page
app.get('/post-task', (req, res) => {
  const html = readFileSync(join(__dirname, 'pages', 'post-task.html'), 'utf-8');
  res.type('html').send(html);
});

// Return list of available capabilities (online agents only)
app.get('/api/task/capabilities', async (req, res) => {
  try {
    const caps = await getCapabilities(config.relay.api_url);
    res.json({ capabilities: caps });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch capabilities' });
  }
});

// Submit a task — blocks until complete or timeout
app.post('/api/task/submit', async (req, res) => {
  const { capability, description, max_budget } = req.body || {};

  if (!capability || typeof capability !== 'string') {
    return res.status(400).json({ error: 'capability is required' });
  }
  if (!description || typeof description !== 'string' || description.trim().length < 5) {
    return res.status(400).json({ error: 'description is required (min 5 chars)' });
  }

  const budget = Math.min(Math.max(parseFloat(max_budget) || 0.10, 0.001), 1.00);

  try {
    const result = await submitTask(capability.trim(), description.trim(), budget);
    res.json(result);
  } catch (err) {
    res.status(503).json({
      task_id: null,
      status: 'failed',
      result: null,
      cost: 0,
      agent_used: null,
      error: err.message
    });
  }
});

// ─── Admin Proxy Routes (relay pass-through) ────────────────────
app.get('/api/admin/*', adminOnly, async (req, res) => {
  try {
    const relayPath = req.path.replace('/api/admin', '/api');
    const data = await relayFetchRaw(relayPath);
    if (data === null) return res.status(502).json({ error: 'Relay unavailable' });
    res.json(data);
  } catch (err) {
    console.error(`[hive-portal] /api/admin proxy error: ${err.message}`);
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
