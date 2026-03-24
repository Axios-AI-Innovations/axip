/**
 * Agent Gamma (Router) — Ultra-Fast Message Classification & Task Routing
 *
 * A core agent that provides classify and route capabilities
 * via local LLM inference (qwen3:1.7b) for minimal latency.
 *
 * Boot sequence (mirrors Eli's pattern):
 *   1. Load environment variables
 *   2. Initialize SQLite database
 *   3. Health check Ollama (verify qwen3:1.7b is available)
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
import { classify } from './skills/classify.js';
import { route } from './skills/route.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const axipConfig = config.axip || {};
const biddingConfig = axipConfig.bidding || {};

const PREFIX = chalk.magenta('[gamma]');

// Module-level agent reference for shutdown access
let agent = null;
const activeTasks = new Map();

const BANNER = `
${chalk.magenta('╔══════════════════════════════════════╗')}
${chalk.magenta('║')}     ${chalk.bold.magenta('AGENT GAMMA (ROUTER)')}  v${config.instance?.version || '0.1.0'}   ${chalk.magenta('║')}
${chalk.magenta('║')}  ${chalk.gray('Ultra-Fast Classification & Routing')} ${chalk.magenta('║')}
${chalk.magenta('╚══════════════════════════════════════╝')}
`;

async function main() {
  console.log(BANNER);
  console.log(`${PREFIX} Starting at ${new Date().toISOString()}`);
  console.log(`${PREFIX} Instance: ${config.instance?.id || 'router-gamma'}`);
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
      console.error(`${PREFIX} LLM inference will fail. Start Ollama and restart Gamma.`);
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
    name: axipConfig.agent_name || 'router-gamma',
    capabilities: axipConfig.capabilities || ['classify', 'route'],
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
  // ── task_request: auto-bid on classify and route tasks ──────────
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    // Only bid on capabilities we support
    const supported = axipConfig.capabilities || ['classify', 'route'];
    if (!supported.includes(capability)) {
      console.log(`${PREFIX} Ignoring task for capability: ${capability}`);
      return;
    }

    if (!biddingConfig.auto_bid) {
      console.log(`${PREFIX} Auto-bid disabled. Ignoring task ${taskId}`);
      return;
    }

    if (activeTasks.size >= (biddingConfig.max_concurrent_tasks || 20)) {
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
      etaSeconds: biddingConfig.default_eta_seconds || 2,
      confidence: biddingConfig.default_confidence || 0.95,
      model,
      message: `Ultra-fast ${capability} via ${model}.`
    });

    activeTasks.set(taskId, {
      capability,
      description: msg.payload.description,
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    console.log(`${PREFIX} ${chalk.bold('►')} Bid sent: $${price}, ETA ${biddingConfig.default_eta_seconds || 2}s`);
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

    try {
      let output;
      const startTime = Date.now();

      if (taskInfo.capability === 'classify') {
        console.log(`${PREFIX} ${chalk.gray('…')} Classifying: "${taskInfo.description}"`);
        output = await classify(taskInfo.description);
        console.log(`${PREFIX} ${chalk.gray('…')} Classification: ${output.intent} / ${output.category} (${output.confidence})`);

      } else if (taskInfo.capability === 'route') {
        console.log(`${PREFIX} ${chalk.gray('…')} Routing: "${taskInfo.description}"`);
        // Parse agents from the description payload if available, otherwise use empty list
        const agents = msg.payload.agents || [];
        output = await route(taskInfo.description, agents);
        console.log(`${PREFIX} ${chalk.gray('…')} Routed to: ${output.recommended_agent_id} (${output.confidence})`);

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
        { error: `Gamma task failed: ${err.message}` },
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
