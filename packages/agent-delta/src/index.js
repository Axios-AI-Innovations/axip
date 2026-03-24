/**
 * Agent Delta (Sentinel) — Network Monitoring & Anomaly Detection Agent
 *
 * A sentinel agent that monitors the AXIP agent network, performs
 * periodic health checks, and provides alert assessment capabilities
 * via local LLM inference (qwen3:1.7b).
 *
 * Boot sequence (mirrors Eli's pattern):
 *   1. Load environment variables
 *   2. Initialize SQLite database
 *   3. Health check Ollama (verify qwen3:1.7b is available)
 *   4. Create AXIPAgent and wire event handlers
 *   5. Connect to relay
 *   6. Start health check loop
 *
 * Commands come from Eli via AXIP delegation — no Telegram, no gateway.
 * PM2 handles restart on crash.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AXIPAgent } from '@axip/sdk';
import chalk from 'chalk';
import { initDatabase, closeDatabase, insertAlert } from './db.js';
import { healthCheck } from './llm/ollama.js';
import { monitor } from './skills/monitor.js';
import { assessAlert } from './skills/alert.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const axipConfig = config.axip || {};
const biddingConfig = axipConfig.bidding || {};
const healthCheckConfig = config.health_check || {};

const PREFIX = chalk.magenta('[sentinel]');

// Module-level references for shutdown access
let agent = null;
let healthCheckIntervalId = null;
const activeTasks = new Map();

const BANNER = `
${chalk.magenta('╔══════════════════════════════════════════╗')}
${chalk.magenta('║')}   ${chalk.bold.magenta('AGENT DELTA (SENTINEL)')} v${config.instance?.version || '0.1.0'}     ${chalk.magenta('║')}
${chalk.magenta('║')}   Network Monitoring & Anomaly Detection ${chalk.magenta('║')}
${chalk.magenta('╚══════════════════════════════════════════╝')}
`;

async function main() {
  console.log(BANNER);
  console.log(`${PREFIX} Starting at ${new Date().toISOString()}`);
  console.log(`${PREFIX} Instance: ${config.instance?.id || 'sentinel-delta'}`);
  console.log(`${PREFIX} Node.js: ${process.version}`);
  console.log(`${PREFIX} PID: ${process.pid}`);
  console.log('');

  // ─── 1. Database ────────────────────────────────────────────────
  try {
    initDatabase();
  } catch (err) {
    console.error(`${PREFIX} FATAL: Database initialization failed: ${err.message}`);
    process.exit(1);
  }

  // ─── 2. Ollama Health Check ─────────────────────────────────────
  const model = config.models?.ollama?.primary || 'qwen3:1.7b';
  try {
    const health = await healthCheck(model);
    if (!health.running) {
      console.error(`${PREFIX} WARNING: Ollama is not running at ${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}`);
      console.error(`${PREFIX} LLM analysis will fail. Start Ollama and restart Delta.`);
    } else if (!health.model_available) {
      console.error(`${PREFIX} WARNING: Model ${model} not found in Ollama.`);
      console.error(`${PREFIX} Available models: ${health.models.join(', ') || 'none'}`);
      console.error(`${PREFIX} Run: ollama pull ${model}`);
    } else {
      console.log(`${PREFIX} ${chalk.green('✓')} Ollama healthy. Model: ${model}`);
    }
  } catch (err) {
    console.error(`${PREFIX} WARNING: Ollama health check failed: ${err.message}`);
  }

  // ─── 3. Create AXIP Agent ───────────────────────────────────────
  agent = new AXIPAgent({
    name: axipConfig.agent_name || 'sentinel-delta',
    capabilities: axipConfig.capabilities || ['monitor', 'alert'],
    relayUrl: process.env.AXIP_RELAY_URL || axipConfig.relay_url || 'ws://127.0.0.1:4200',
    pricing: axipConfig.pricing || {},
    metadata: axipConfig.metadata || {}
  });

  // ─── 4. Wire Event Handlers ─────────────────────────────────────
  _wireEventHandlers();

  // ─── 5. Connect to Relay ────────────────────────────────────────
  await agent.start();
  console.log('');
  console.log(`${PREFIX} ${chalk.green('✓')} Connected to relay at ${agent.relayUrl}`);
  console.log(`${PREFIX} Agent ID: ${agent.identity.agentId}`);
  console.log(`${PREFIX} ${chalk.gray('Capabilities:')} ${(axipConfig.capabilities || []).join(', ')}`);
  console.log(`${PREFIX} ${chalk.gray('Model:')} ${model} (local Ollama)`);
  console.log('');

  // ─── 6. Start Health Check Loop ─────────────────────────────────
  const intervalSeconds = healthCheckConfig.interval_seconds || 60;
  console.log(`${PREFIX} ${chalk.green('✓')} Starting health check loop (every ${intervalSeconds}s)`);
  healthCheckIntervalId = setInterval(() => runHealthCheck(), intervalSeconds * 1000);

  // Run an initial health check immediately
  setTimeout(() => runHealthCheck(), 2000);

  console.log(`${PREFIX} ${chalk.green('✓')} All systems initialized. Watching the network...`);
  console.log('');
}

// ─── Health Check Loop ───────────────────────────────────────────

/**
 * Periodic health check — fetches network state, runs deterministic
 * checks, and only invokes LLM if anomalies are detected.
 */
async function runHealthCheck() {
  try {
    console.log(`${PREFIX} ${chalk.gray('...')} Running health check...`);
    const report = await monitor();

    if (report.status === 'healthy') {
      console.log(`${PREFIX} ${chalk.green('✓')} Network healthy. ${report.agents_online} agent(s) online.`);
    } else if (report.status === 'warning') {
      console.log(`${PREFIX} ${chalk.yellow('⚠')} Network warning: ${report.summary}`);
      for (const issue of report.issues) {
        console.log(`${PREFIX}   ${chalk.yellow(`[${issue.severity}]`)} ${issue.description}`);
      }
      // Persist warnings to database
      insertAlert({
        severity: 'warning',
        source: 'health-check',
        message: report.summary,
        details: report
      });
    } else if (report.status === 'critical') {
      console.log(`${PREFIX} ${chalk.red('✗')} Network CRITICAL: ${report.summary}`);
      for (const issue of report.issues) {
        console.log(`${PREFIX}   ${chalk.red(`[${issue.severity}]`)} ${issue.description}`);
      }
      // Persist critical alerts to database
      insertAlert({
        severity: 'critical',
        source: 'health-check',
        message: report.summary,
        details: report
      });
    }
  } catch (err) {
    console.error(`${PREFIX} ${chalk.red('✗')} Health check failed: ${err.message}`);
  }
}

// ─── Event Handlers ───────────────────────────────────────────────

function _wireEventHandlers() {
  // ── task_request: auto-bid on monitor and alert tasks ──────────
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    // Only bid on capabilities we support
    const supported = axipConfig.capabilities || ['monitor', 'alert'];
    if (!supported.includes(capability)) {
      console.log(`${PREFIX} Ignoring task for capability: ${capability}`);
      return;
    }

    if (!biddingConfig.auto_bid) {
      console.log(`${PREFIX} Auto-bid disabled. Ignoring task ${taskId}`);
      return;
    }

    if (activeTasks.size >= (biddingConfig.max_concurrent_tasks || 10)) {
      console.log(`${PREFIX} At max concurrent tasks (${activeTasks.size}). Skipping ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.bold('◄')} Task received: ${capability} — "${msg.payload.description}"`);

    // Price from config
    const pricing = axipConfig.pricing?.[capability] || {};
    const price = pricing.base_usd || 0.001;
    const model = config.models?.ollama?.primary || 'qwen3:1.7b';

    const bidMsg = agent.sendBid(msg.from.agent_id, taskId, {
      price,
      etaSeconds: biddingConfig.default_eta_seconds || 5,
      confidence: biddingConfig.default_confidence || 0.90,
      model,
      message: `Sentinel ${capability} via ${model}.`
    });

    activeTasks.set(taskId, {
      capability,
      description: msg.payload.description,
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    console.log(`${PREFIX} ${chalk.bold('►')} Bid sent: $${price}, ETA ${biddingConfig.default_eta_seconds || 5}s`);
  });

  // ── task_accept: execute skills ────────────────────────────────
  agent.on('task_accept', async (msg) => {
    const taskId = msg.payload.task_id;
    const taskInfo = activeTasks.get(taskId);

    if (!taskInfo) {
      console.warn(`${PREFIX} Accepted unknown task: ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.green('✓')} Task accepted! Working on ${taskId.slice(0, 16)}...`);

    try {
      let output;
      const startTime = Date.now();

      if (taskInfo.capability === 'monitor') {
        console.log(`${PREFIX} ${chalk.gray('...')} Running network monitor...`);
        output = await monitor(taskInfo.description);
        console.log(`${PREFIX} ${chalk.gray('...')} Monitor result: ${output.status} (${output.issues.length} issues)`);

      } else if (taskInfo.capability === 'alert') {
        console.log(`${PREFIX} ${chalk.gray('...')} Assessing alert: "${taskInfo.description}"`);
        output = await assessAlert(taskInfo.description);
        console.log(`${PREFIX} ${chalk.gray('...')} Alert severity: ${output.severity}, escalate: ${output.escalate}`);

      } else {
        output = { error: `Unknown capability: ${taskInfo.capability}` };
      }

      const actualTime = Math.round((Date.now() - startTime) / 1000);
      const model = config.models?.ollama?.primary || 'qwen3:1.7b';

      // Deliver results
      agent.sendResult(taskInfo.requesterId, taskId, output, {
        actualCost: 0, // All local — $0
        actualTime,
        modelUsed: model
      });

      console.log(`${PREFIX} ${chalk.bold('►')} Results delivered for ${taskId.slice(0, 16)} (${actualTime}s)`);

    } catch (err) {
      console.error(`${PREFIX} ${chalk.red('✗')} Task failed: ${err.message}`);

      // Deliver error result so requester doesn't hang
      agent.sendResult(taskInfo.requesterId, taskId,
        { error: `Delta task failed: ${err.message}` },
        { status: 'failed' }
      );
    }

    activeTasks.delete(taskId);
  });

  // ── task_settle: log settlements ────────────────────────────────
  agent.on('task_settle', (msg) => {
    console.log(`${PREFIX} ${chalk.green('$')} Settlement: $${msg.payload.amount_usd}`);
  });

  // ── Connection lifecycle ────────────────────────────────────────
  agent.on('disconnected', () => {
    console.log(`${PREFIX} Disconnected from relay.`);
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n${PREFIX} Received ${signal}. Shutting down gracefully...`);

  // Clear health check interval
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
    console.log(`${PREFIX} Health check loop stopped.`);
  }

  if (agent) {
    agent.stop();
  }
  closeDatabase();

  console.log(`${PREFIX} Goodbye.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled errors — log and exit (PM2 will restart)
process.on('uncaughtException', (err) => {
  console.error(`${PREFIX} UNCAUGHT EXCEPTION: ${err.message}`);
  console.error(err.stack);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error(`${PREFIX} UNHANDLED REJECTION: ${reason}`);
  shutdown('unhandledRejection');
});

// ─── Start ────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(chalk.red(`${PREFIX} FATAL: ${err.message}`));
  process.exit(1);
});
