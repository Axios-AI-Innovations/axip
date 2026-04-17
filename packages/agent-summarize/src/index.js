/**
 * Agent Summarize (summarizer-alpha) — Text & URL Summarization Agent
 *
 * A dedicated summarization agent that provides the `summarize` capability
 * via real LLM inference (qwen3:14b on local Ollama).
 *
 * Accepts both plain text and URLs. For URLs, fetches the page first,
 * then summarizes the extracted content.
 *
 * Boot sequence:
 *   1. Load environment variables
 *   2. Initialize SQLite database
 *   3. Health check Ollama (verify qwen3:14b is available)
 *   4. Create AXIPAgent and wire event handlers
 *   5. Connect to relay
 *
 * AGT-4 Production Upgrade (2026-04-17):
 *   - Relay error handling: rate-limit backoff, duplicate nonce recovery
 *   - Ollama circuit breaker: pause bidding if LLM is unavailable
 *   - Periodic health stats: log summary every 5 minutes
 *   - Task timeout: 90s hard limit per summarize task
 *   - Version bumped to 0.2.0
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AXIPAgent } from '@axip/sdk';
import chalk from 'chalk';
import { initDatabase, closeDatabase } from './db.js';
import { healthCheck } from './llm/ollama.js';
import { summarize } from './skills/summarize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const axipConfig = config.axip || {};
const biddingConfig = axipConfig.bidding || {};

const PREFIX = chalk.magenta('[SUMMARIZE]');

let agent = null;
const activeTasks = new Map();

// ─── Production Resilience State ────────────────────────────────────
//
// These variables implement the circuit breaker and rate-limit backoff
// patterns. They are in-memory only — reset on restart is intentional
// (prevents stuck-open circuit state across restarts).

// Relay rate limiting: when the relay sends RATE_LIMITED, pause all bids
// for RATE_LIMIT_PAUSE_MS to let the window reset.
const RATE_LIMIT_PAUSE_MS = 65_000; // 65s — just over the relay's 1-min window
let rateLimitedUntil = 0; // epoch ms; 0 = not rate limited

// Ollama circuit breaker: track consecutive task failures due to Ollama.
// After OLLAMA_FAILURE_THRESHOLD failures, pause all new bids.
// Probe again every OLLAMA_PROBE_INTERVAL_MS.
const OLLAMA_FAILURE_THRESHOLD = 3;
const OLLAMA_PROBE_INTERVAL_MS = 60_000; // 1 min between probes when circuit open
let ollamaFailures = 0;
let ollamaCircuitOpen = false;
let ollamaNextProbe = 0; // epoch ms

// Task statistics (for periodic health log)
const stats = {
  tasksAccepted: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  tasksCancelled: 0,
  bidsPlaced: 0,
  rateLimitHits: 0,
  ollamaErrors: 0,
  startedAt: Date.now()
};

const BANNER = `
╔══════════════════════════════════════╗
║  📝  AGENT SUMMARIZE  📝             ║
║    Text & URL Summarization v0.2.0  ║
╚══════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);
  console.log(`${PREFIX} Starting at ${new Date().toISOString()}`);
  console.log(`${PREFIX} Instance: ${config.instance?.id || 'summarizer-alpha'}`);
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
      console.error(`${PREFIX} WARNING: Ollama not running at ${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}`);
      console.error(`${PREFIX} LLM summarization will fail. Circuit breaker will activate.`);
      // Pre-open circuit breaker so we don't accept tasks we can't service
      ollamaFailures = OLLAMA_FAILURE_THRESHOLD;
      ollamaCircuitOpen = true;
      ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
    } else if (!health.model_available) {
      console.error(`${PREFIX} WARNING: Model ${model} not found in Ollama.`);
      console.error(`${PREFIX} Available models: ${health.models.join(', ') || 'none'}`);
      console.error(`${PREFIX} Run: ollama pull ${model}`);
      ollamaFailures = OLLAMA_FAILURE_THRESHOLD;
      ollamaCircuitOpen = true;
      ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
    } else {
      console.log(`${PREFIX} ${chalk.green('✓')} Ollama healthy. Model: ${model}`);
    }
  } catch (err) {
    console.error(`${PREFIX} WARNING: Ollama health check failed: ${err.message}`);
    ollamaFailures = OLLAMA_FAILURE_THRESHOLD;
    ollamaCircuitOpen = true;
    ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
  }

  // ─── 3. Create AXIP Agent ───────────────────────────────────────
  agent = new AXIPAgent({
    name: axipConfig.agent_name || 'summarizer-alpha',
    capabilities: axipConfig.capabilities || ['summarize'],
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

  // ─── 6. Periodic health stats ───────────────────────────────────
  const STATS_INTERVAL_MS = 5 * 60_000; // 5 minutes
  setInterval(() => _logHealthStats(), STATS_INTERVAL_MS);
}

// ─── Event Handlers ───────────────────────────────────────────────

function _wireEventHandlers() {
  // ── task_request: auto-bid on summarize tasks ────────────────────
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    if (capability !== 'summarize') {
      return;
    }

    if (!biddingConfig.auto_bid) {
      console.log(`${PREFIX} Auto-bid disabled. Ignoring task ${taskId}`);
      return;
    }

    // ── Production gate: check circuit breaker and backoff states ──

    // Gate 1: relay rate limit backoff
    if (Date.now() < rateLimitedUntil) {
      const pauseSec = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
      console.log(`${PREFIX} ${chalk.yellow('⏸')} Rate-limited by relay. Skipping task (${pauseSec}s remaining)`);
      return;
    }

    // Gate 2: Ollama circuit breaker
    if (ollamaCircuitOpen) {
      // Probe: try Ollama again if the probe window has passed
      if (Date.now() >= ollamaNextProbe) {
        const model = config.models?.ollama?.primary || 'qwen3:14b';
        try {
          const health = await healthCheck(model);
          if (health.running && health.model_available) {
            ollamaCircuitOpen = false;
            ollamaFailures = 0;
            console.log(`${PREFIX} ${chalk.green('✓')} Ollama recovered — circuit breaker closed.`);
          } else {
            ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
            console.log(`${PREFIX} ${chalk.yellow('⚡')} Ollama still unavailable. Next probe in 60s.`);
          }
        } catch {
          ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
        }
      }

      if (ollamaCircuitOpen) {
        console.log(`${PREFIX} ${chalk.yellow('⚡')} Ollama circuit open. Skipping task ${taskId.slice(0, 16)}`);
        return;
      }
    }

    // Gate 3: concurrent task limit
    if (activeTasks.size >= (biddingConfig.max_concurrent_tasks || 3)) {
      console.log(`${PREFIX} At max concurrent tasks (${activeTasks.size}). Skipping ${taskId}`);
      return;
    }

    console.log(`${PREFIX} ${chalk.bold('◄')} Task received: "${msg.payload.description?.slice(0, 80)}"`);

    const pricing = axipConfig.pricing?.summarize || {};
    const price = pricing.base_usd || 0.03;
    const model = config.models?.ollama?.primary || 'qwen3:14b';

    const bidMsg = agent.sendBid(msg.from.agent_id, taskId, {
      price,
      etaSeconds: biddingConfig.default_eta_seconds || 20,
      confidence: biddingConfig.default_confidence || 0.90,
      model,
      message: `Text & URL summarization via ${model}.`
    });

    activeTasks.set(taskId, {
      capability,
      description: msg.payload.description,
      constraints: msg.payload.constraints || {},
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    stats.bidsPlaced++;
    console.log(`${PREFIX} ${chalk.bold('►')} Bid sent: $${price}, ETA ${biddingConfig.default_eta_seconds || 20}s`);
  });

  // ── task_accept: execute summarization ──────────────────────────
  agent.on('task_accept', async (msg) => {
    const taskId = msg.payload.task_id;
    const taskInfo = activeTasks.get(taskId);

    if (!taskInfo) {
      console.warn(`${PREFIX} Accepted unknown task: ${taskId}`);
      return;
    }

    stats.tasksAccepted++;
    const hasUrl = taskInfo.constraints?.url || /^https?:\/\//i.test(taskInfo.description?.trim());
    console.log(`${PREFIX} ${chalk.green('✓')} Task accepted! Summarizing${hasUrl ? ' URL' : ' text'} (${taskInfo.description?.length || 0} chars)`);

    const TASK_TIMEOUT_MS = 90_000; // 90s — summarize may need a fetch + LLM pass

    try {
      const startTime = Date.now();

      // Race task execution against hard timeout
      const output = await Promise.race([
        summarize(taskInfo.description, taskInfo.constraints),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Task timeout after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS)
        )
      ]);

      const actualTime = Math.round((Date.now() - startTime) / 1000);
      const model = config.models?.ollama?.primary || 'qwen3:14b';

      console.log(`${PREFIX} ${chalk.gray('…')} Summary: ${output.summary_length} words from ${output.original_length}${output.source_url ? ` [${output.source_url.slice(0, 50)}]` : ''}`);

      agent.sendResult(taskInfo.requesterId, taskId, output, {
        actualCost: 0,
        actualTime,
        modelUsed: model
      });

      stats.tasksCompleted++;
      console.log(`${PREFIX} ${chalk.bold('►')} Results delivered for ${taskId.slice(0, 16)} (${actualTime}s)`);

      // Ollama success: reset failure counter
      if (ollamaFailures > 0) {
        ollamaFailures = 0;
        console.log(`${PREFIX} ${chalk.green('✓')} Ollama healthy — resetting failure counter.`);
      }

    } catch (err) {
      stats.tasksFailed++;
      console.error(`${PREFIX} ${chalk.red('✗')} Task failed: ${err.message}`);

      // Detect Ollama failures from error messages
      const isOllamaError = err.message.includes('Ollama') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('timed out') ||
        err.message.includes('connect ECONNREFUSED 127.0.0.1:11434');

      if (isOllamaError) {
        ollamaFailures++;
        stats.ollamaErrors++;
        console.log(`${PREFIX} ${chalk.yellow('⚡')} Ollama error detected (failures: ${ollamaFailures}/${OLLAMA_FAILURE_THRESHOLD})`);
        if (ollamaFailures >= OLLAMA_FAILURE_THRESHOLD) {
          ollamaCircuitOpen = true;
          ollamaNextProbe = Date.now() + OLLAMA_PROBE_INTERVAL_MS;
          console.log(`${PREFIX} ${chalk.red('⚡')} Ollama circuit breaker OPEN — pausing new bids for ${OLLAMA_PROBE_INTERVAL_MS / 1000}s`);
        }
      }

      // Deliver error result so requester doesn't hang
      agent.sendResult(taskInfo.requesterId, taskId,
        { error: `Summarize task failed: ${err.message}` },
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
      stats.tasksCancelled++;
      console.log(`${PREFIX} ${chalk.yellow('✕')} Task cancelled by relay (requester disconnected): ${taskId.slice(0, 16)}`);
      activeTasks.delete(taskId);
    }
  });

  // ── error_message: relay sent an error response ─────────────────
  // Handle relay error messages gracefully — especially rate limiting.
  agent.on('error_message', (msg) => {
    const code = msg.payload?.code || 'UNKNOWN';
    const message = msg.payload?.message || '';

    if (code === 'RATE_LIMITED') {
      stats.rateLimitHits++;
      rateLimitedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      console.log(`${PREFIX} ${chalk.red('⚠')} Relay RATE_LIMITED — pausing bids for ${RATE_LIMIT_PAUSE_MS / 1000}s`);
    } else if (code === 'REPLAY_DETECTED') {
      // Non-fatal: nonce was reused (e.g. from rapid reconnect). Log and continue.
      console.warn(`${PREFIX} ${chalk.yellow('⚠')} Relay rejected message (REPLAY_DETECTED) — likely a rapid reconnect. Continuing.`);
    } else if (code === 'EXPIRED_MESSAGE') {
      // Clock skew or very slow message delivery. Log and continue.
      console.warn(`${PREFIX} ${chalk.yellow('⚠')} Relay rejected message (EXPIRED_MESSAGE) — clock skew? ref=${msg.payload?.ref_id}`);
    } else if (code === 'INVALID_SIGNATURE') {
      // Should never happen — means our key is wrong or corrupted.
      console.error(`${PREFIX} ${chalk.red('✗')} INVALID_SIGNATURE from relay — key may be corrupted! ref=${msg.payload?.ref_id}`);
    } else {
      console.warn(`${PREFIX} ${chalk.yellow('⚠')} Relay error: ${code} — ${message}`);
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

// ─── Periodic Health Stats ────────────────────────────────────────

/**
 * Log a compact health summary for PM2 log monitoring.
 * Runs every 5 minutes via setInterval.
 */
function _logHealthStats() {
  const uptimeSec = Math.round((Date.now() - stats.startedAt) / 1000);
  const uptimeMin = Math.round(uptimeSec / 60);

  const circuitStatus = ollamaCircuitOpen ? chalk.red('OPEN') : chalk.green('closed');
  const relayStatus = Date.now() < rateLimitedUntil ? chalk.yellow('rate-limited') : chalk.green('ok');

  console.log(
    `${PREFIX} ${chalk.gray('[HEALTH]')} uptime=${uptimeMin}m ` +
    `tasks=${stats.tasksCompleted}ok/${stats.tasksFailed}fail/${stats.tasksCancelled}cancel ` +
    `bids=${stats.bidsPlaced} ` +
    `ollama=${circuitStatus} relay=${relayStatus} ` +
    `active=${activeTasks.size}`
  );
}

// ─── Graceful Shutdown ────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n${PREFIX} Received ${signal}. Shutting down gracefully...`);

  if (agent) {
    agent.stop();
  }
  closeDatabase();

  _logHealthStats(); // Final stats on shutdown
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
