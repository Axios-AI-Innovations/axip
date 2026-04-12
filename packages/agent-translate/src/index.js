/**
 * Agent Translate (translator-alpha) — Multilingual Translation Agent
 *
 * Provides translate capability via local Ollama (qwen3:14b).
 * Accepts text + target language and returns translated text with
 * source language detection.
 *
 * Boot sequence:
 *   1. Load environment variables
 *   2. Initialize SQLite database
 *   3. Health check Ollama (verify qwen3:14b is available)
 *   4. Create AXIPAgent and wire event handlers
 *   5. Connect to relay
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AXIPAgent } from '@axip/sdk';
import chalk from 'chalk';
import { initDatabase, closeDatabase } from './db.js';
import { healthCheck } from './llm/ollama.js';
import { translate } from './skills/translate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const axipConfig = config.axip || {};
const biddingConfig = axipConfig.bidding || {};

const PREFIX = chalk.cyan('[TRANSLATE]');

let agent = null;
const activeTasks = new Map();

const BANNER = `
╔══════════════════════════════════════╗
║   🌐  AGENT TRANSLATE  🌐            ║
║    Multilingual Translation v${config.instance?.version || '0.1.0'}  ║
╚══════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);
  console.log(`${PREFIX} Starting at ${new Date().toISOString()}`);
  console.log(`${PREFIX} Instance: ${config.instance?.id || 'translator-alpha'}`);
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
  const model = config.models?.ollama?.primary || 'qwen3:14b';
  try {
    const health = await healthCheck(model);
    if (!health.running) {
      console.error(`${PREFIX} WARNING: Ollama is not running at ${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}`);
      console.error(`${PREFIX} Translation will fail. Start Ollama and restart.`);
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
    name: axipConfig.agent_name || 'translator-alpha',
    capabilities: axipConfig.capabilities || ['translate'],
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
  console.log(`${PREFIX} ${chalk.gray('Pricing:')} $${axipConfig.pricing?.translate?.base_usd || 0.02} per translation`);
  console.log('');
  console.log(`${PREFIX} ${chalk.green('✓')} All systems initialized. Waiting for tasks...`);
  console.log('');
}

// ─── Event Handlers ───────────────────────────────────────────────

function _wireEventHandlers() {
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    const supported = axipConfig.capabilities || ['translate'];
    if (!supported.includes(capability)) {
      console.log(`${PREFIX} Ignoring task for capability: ${capability}`);
      return;
    }

    if (!biddingConfig.auto_bid) {
      console.log(`${PREFIX} Auto-bid disabled. Ignoring task ${taskId}`);
      return;
    }

    if (activeTasks.size >= (biddingConfig.max_concurrent_tasks || 3)) {
      console.log(`${PREFIX} At max concurrent tasks (${activeTasks.size}). Skipping ${taskId}`);
      return;
    }

    const input = msg.payload.input || {};
    const toLang = input.to || 'unknown';
    const fromLang = input.from || 'auto';
    const textLength = (input.text || msg.payload.description || '').length;

    console.log(`${PREFIX} ${chalk.bold('◄')} Task received: ${capability} → ${toLang} (${textLength} chars)`);

    const pricing = axipConfig.pricing?.[capability] || {};
    const price = pricing.base_usd || 0.02;
    const model = config.models?.ollama?.primary || 'qwen3:14b';

    const bidMsg = agent.sendBid(msg.from.agent_id, taskId, {
      price,
      etaSeconds: biddingConfig.default_eta_seconds || 20,
      confidence: biddingConfig.default_confidence || 0.92,
      model,
      message: `Translation to ${toLang} via ${model}. Returns translated text + detected source language.`
    });

    activeTasks.set(taskId, {
      capability,
      payload: input,
      description: msg.payload.description,
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    console.log(`${PREFIX} ${chalk.bold('►')} Bid sent: $${price}, ETA ${biddingConfig.default_eta_seconds || 20}s`);
  });

  agent.on('task_accept', async (msg) => {
    const taskId = msg.payload.task_id;
    const taskInfo = activeTasks.get(taskId);

    if (!taskInfo) {
      console.warn(`${PREFIX} Accepted unknown task: ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.green('✓')} Task accepted! Working on ${taskId.slice(0, 16)}...`);

    try {
      const startTime = Date.now();

      // Extract input — support both structured input and plain description
      let text = taskInfo.payload.text || taskInfo.description || '';
      const to = taskInfo.payload.to || 'English';
      const from = taskInfo.payload.from || 'auto';

      console.log(`${PREFIX} ${chalk.gray('…')} Translating ${text.length} chars → ${to}${from !== 'auto' ? ` (from ${from})` : ''}`);

      const output = await translate({ text, to, from });
      const actualTime = Math.round((Date.now() - startTime) / 1000);

      if (output.error && !output.translated) {
        console.error(`${PREFIX} ${chalk.red('✗')} Translation error: ${output.error}`);
      } else {
        console.log(`${PREFIX} ${chalk.gray('…')} Done: ${output.detected_language} → ${output.target_language}, confidence: ${output.confidence}`);
      }

      agent.sendResult(taskInfo.requesterId, taskId, output, {
        actualCost: 0,
        actualTime,
        modelUsed: config.models?.ollama?.primary || 'qwen3:14b'
      });

      console.log(`${PREFIX} ${chalk.bold('►')} Results delivered for ${taskId.slice(0, 16)} (${actualTime}s)`);

    } catch (err) {
      console.error(`${PREFIX} ${chalk.red('✗')} Task failed: ${err.message}`);

      agent.sendResult(taskInfo.requesterId, taskId,
        { error: `Translation failed: ${err.message}`, translated: '', detected_language: 'unknown', confidence: 0 },
        { status: 'failed' }
      );
    }

    activeTasks.delete(taskId);
  });

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

  agent.on('disconnected', () => {
    console.log(`${PREFIX} Disconnected from relay.`);
  });

  // Clear stale tasks on reconnect
  agent.connection.on('connected', () => {
    if (activeTasks.size > 0) {
      console.log(`${PREFIX} Reconnected — clearing ${activeTasks.size} stale active task(s)`);
      activeTasks.clear();
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

  console.log(`${PREFIX} Goodbye.`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
