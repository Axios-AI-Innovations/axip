/**
 * Agent Beta (Scout) — Live Web Search & Summarization Agent
 *
 * A utility agent that provides web_search and summarize capabilities
 * via real DuckDuckGo search and local LLM inference (qwen3:8b).
 *
 * Boot sequence (mirrors Eli's pattern):
 *   1. Load environment variables
 *   2. Initialize SQLite database
 *   3. Health check Ollama (verify qwen3:8b is available)
 *   4. Create AXIPAgent and wire event handlers
 *   5. Connect to relay
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
import { initDatabase, closeDatabase } from './db.js';
import { healthCheck } from './llm/ollama.js';
import { webSearch } from './skills/webSearch.js';
import { summarize } from './skills/summarize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const axipConfig = config.axip || {};
const biddingConfig = axipConfig.bidding || {};

const PREFIX = chalk.blue('[BETA]');

// Module-level agent reference for shutdown access
let agent = null;
const activeTasks = new Map();

const BANNER = `
╔══════════════════════════════════════╗
║        🔍  AGENT BETA (SCOUT)  🔍   ║
║    Live Web Search + LLM v${config.instance?.version || '0.2.0'}     ║
╚══════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);
  console.log(`${PREFIX} Starting at ${new Date().toISOString()}`);
  console.log(`${PREFIX} Instance: ${config.instance?.id || 'scout-beta'}`);
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
  const model = config.models?.ollama?.primary || 'qwen3:8b';
  try {
    const health = await healthCheck(model);
    if (!health.running) {
      console.error(`${PREFIX} WARNING: Ollama is not running at ${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}`);
      console.error(`${PREFIX} LLM summarization will fail. Start Ollama and restart Beta.`);
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
    name: axipConfig.agent_name || 'scout-beta',
    capabilities: axipConfig.capabilities || ['web_search', 'summarize'],
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
  console.log(`${PREFIX} ${chalk.green('✓')} All systems initialized. Waiting for tasks...`);
  console.log('');
}

// ─── Event Handlers ───────────────────────────────────────────────

function _wireEventHandlers() {
  // ── task_request: auto-bid on web_search and summarize tasks ────
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    // Only bid on capabilities we support
    const supported = axipConfig.capabilities || ['web_search', 'summarize'];
    if (!supported.includes(capability)) {
      console.log(`${PREFIX} Ignoring task for capability: ${capability}`);
      return;
    }

    if (!biddingConfig.auto_bid) {
      console.log(`${PREFIX} Auto-bid disabled. Ignoring task ${taskId}`);
      return;
    }

    if (activeTasks.size >= (biddingConfig.max_concurrent_tasks || 5)) {
      console.log(`${PREFIX} At max concurrent tasks (${activeTasks.size}). Skipping ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.bold('◄')} Task received: ${capability} — "${msg.payload.description}"`);

    // Price from config
    const pricing = axipConfig.pricing?.[capability] || {};
    const price = pricing.base_usd || (capability === 'web_search' ? 0.03 : 0.02);
    const model = config.models?.ollama?.primary || 'qwen3:8b';

    const bidMsg = agent.sendBid(msg.from.agent_id, taskId, {
      price,
      etaSeconds: biddingConfig.default_eta_seconds || 15,
      confidence: biddingConfig.default_confidence || 0.90,
      model,
      message: `Live ${capability} via DDG + ${model}.`
    });

    activeTasks.set(taskId, {
      capability,
      description: msg.payload.description,
      constraints: msg.payload.constraints || {},
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    console.log(`${PREFIX} ${chalk.bold('►')} Bid sent: $${price}, ETA ${biddingConfig.default_eta_seconds || 15}s`);
  });

  // ── task_accept: execute real skills ────────────────────────────
  agent.on('task_accept', async (msg) => {
    const taskId = msg.payload.task_id;
    const taskInfo = activeTasks.get(taskId);

    if (!taskInfo) {
      console.warn(`${PREFIX} Accepted unknown task: ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.green('✓')} Task accepted! Working on ${taskId.slice(0, 16)}...`);

    const TASK_TIMEOUT_MS = 60000; // 60s hard limit per task

    try {
      let output;
      const startTime = Date.now();

      const taskWork = async () => {
        if (taskInfo.capability === 'web_search') {
          console.log(`${PREFIX} ${chalk.gray('…')} Searching: "${taskInfo.description}"`);
          const result = await webSearch(taskInfo.description);
          console.log(`${PREFIX} ${chalk.gray('…')} Found ${result.results.length} results${result.cached ? ' (cached)' : ''}`);
          return result;

        } else if (taskInfo.capability === 'summarize') {
          const hasUrl = taskInfo.constraints?.url || /^https?:\/\//i.test(taskInfo.description.trim());
          console.log(`${PREFIX} ${chalk.gray('…')} Summarizing${hasUrl ? ' URL' : ' text'} (${taskInfo.description.length} chars)`);
          const result = await summarize(taskInfo.description, taskInfo.constraints);
          console.log(`${PREFIX} ${chalk.gray('…')} Summary: ${result.summary_length} words from ${result.original_length}${result.source_url ? ` [${result.source_url.slice(0, 50)}]` : ''}`);
          return result;

        } else {
          return { error: `Unknown capability: ${taskInfo.capability}` };
        }
      };

      // Race task execution against hard timeout
      output = await Promise.race([
        taskWork(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Task timeout after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS)
        )
      ]);

      const actualTime = Math.round((Date.now() - startTime) / 1000);
      const model = config.models?.ollama?.primary || 'qwen3:8b';

      // Deliver results
      agent.sendResult(taskInfo.requesterId, taskId, output, {
        actualCost: 0, // All local — $0
        actualTime,
        modelUsed: model
      });

      console.log(`${PREFIX} ${chalk.bold('►')} Results delivered for ${taskId.slice(0, 16)} (${actualTime}s)`);

    } catch (err) {
      console.error(`${PREFIX} ${chalk.red('✗')} Task failed: ${err.message}`);

      // Deliver error result so Eli doesn't hang
      agent.sendResult(taskInfo.requesterId, taskId,
        { error: `Beta task failed: ${err.message}` },
        { status: 'failed' }
      );
    }

    activeTasks.delete(taskId);
  });

  // ── task_settle: log settlements ────────────────────────────────
  agent.on('task_settle', (msg) => {
    console.log(`${PREFIX} ${chalk.green('$')} Settlement: $${msg.payload.amount_usd}`);
  });

  // ── task_cancel: relay signals requester disconnected — clear local state ──
  agent.on('task_cancel', (msg) => {
    const taskId = msg.payload?.task_id;
    if (taskId && activeTasks.has(taskId)) {
      console.log(`${PREFIX} ${chalk.yellow('✕')} Task cancelled by relay (requester disconnected): ${taskId.slice(0, 16)}`);
      activeTasks.delete(taskId);
    }
  });

  // ── Connection lifecycle ────────────────────────────────────────
  agent.on('disconnected', () => {
    console.log(`${PREFIX} Disconnected from relay.`);
  });

  // Clear stale tasks on reconnect to prevent memory leak / hung tasks
  agent.connection.on('connected', () => {
    if (activeTasks.size > 0) {
      console.log(`${PREFIX} Reconnected — clearing ${activeTasks.size} stale active task(s)`);
      activeTasks.clear();
    } else {
      console.log(`${PREFIX} Reconnected to relay.`);
    }
  });
}

// ─── Graceful Shutdown ────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n${PREFIX} Received ${signal}. Shutting down gracefully...`);

  if (agent) {
    agent.stop();
  }
  closeDatabase();

  console.log(`${PREFIX} Goodbye. 👋`);
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
