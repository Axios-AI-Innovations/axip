/**
 * Example 02: Echo Agent
 *
 * Echoes back whatever the requestor sends. Shows:
 * - Dynamic pricing based on input size
 * - Proper error handling with sendResult({ error })
 * - Reconnect awareness (clearing stale tasks on reconnect)
 * - MAX_CONCURRENT_TASKS guard to avoid overloading
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Configuration ───────────────────────────────────────────────

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';
const BASE_PRICE = parseFloat(process.env.AGENT_BASE_PRICE || '0.002');
const MAX_CONCURRENT_TASKS = 5;

const agent = new AXIPAgent({
  name: 'echo-agent',
  capabilities: ['echo'],
  relayUrl: RELAY_URL,
  pricing: { base: BASE_PRICE },
  metadata: {
    description: 'Returns input unchanged. Useful for testing task lifecycle.',
    max_input_bytes: 65536
  }
});

const activeTasks = new Map();

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Price dynamically: base + $0.0001 per KB of input.
 * Larger inputs cost slightly more to discourage abuse.
 */
function calculatePrice(description) {
  const sizeKb = Buffer.byteLength(description || '', 'utf8') / 1024;
  return Math.max(BASE_PRICE, BASE_PRICE + sizeKb * 0.0001);
}

// ─── Event Handlers ─────────────────────────────────────────────

agent.on('task_match', (msg) => {
  const { task_id, description } = msg.payload;

  // Reject if we're at capacity
  if (activeTasks.size >= MAX_CONCURRENT_TASKS) {
    console.log(`[echo-agent] At capacity (${MAX_CONCURRENT_TASKS}), skipping ${task_id.slice(0, 8)}`);
    return; // Don't bid — relay will try the next agent
  }

  const price = calculatePrice(description);

  const bid = agent.bid(msg, {
    price,
    etaSeconds: 1,
    message: `Will echo ${Buffer.byteLength(description || '', 'utf8')} bytes instantly.`
  });

  activeTasks.set(task_id, {
    description,
    requesterId: msg.from.agent_id
  });

  console.log(`[echo-agent] Bid $${price.toFixed(4)} for task ${task_id.slice(0, 8)}`);
});

agent.on('task_accept', (msg) => {
  const { task_id } = msg.payload;
  const task = activeTasks.get(task_id);

  if (!task) {
    console.warn(`[echo-agent] Accepted unknown task: ${task_id}`);
    return;
  }

  try {
    // Basic input validation
    if (!task.description || task.description.length === 0) {
      throw new Error('Input must not be empty');
    }
    if (Buffer.byteLength(task.description, 'utf8') > 65536) {
      throw new Error('Input exceeds 64 KB limit');
    }

    agent.sendResult(task.requesterId, task_id, {
      echo: task.description,
      bytes: Buffer.byteLength(task.description, 'utf8'),
      timestamp: new Date().toISOString()
    });

    console.log(`[echo-agent] Echoed ${task.description.length} chars for ${task_id.slice(0, 8)}`);
  } catch (err) {
    // Always send a result — even on error — so the requestor is unblocked
    console.error(`[echo-agent] Error on task ${task_id.slice(0, 8)}: ${err.message}`);
    agent.sendResult(task.requesterId, task_id, { error: err.message }, { status: 'failed' });
  }

  activeTasks.delete(task_id);
});

agent.on('task_settle', (msg) => {
  console.log(`[echo-agent] Settled: $${msg.payload.amount_usd}`);
});

agent.on('task_cancel', (msg) => {
  const taskId = msg.payload?.task_id;
  if (taskId) activeTasks.delete(taskId);
});

// Clear stale tasks after reconnect — relay won't re-deliver them
agent.connection.on('connected', () => {
  if (activeTasks.size > 0) {
    console.log(`[echo-agent] Reconnected — clearing ${activeTasks.size} stale task(s)`);
    activeTasks.clear();
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────

function shutdown() {
  console.log('[echo-agent] Shutting down...');
  agent.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ───────────────────────────────────────────────────────

await agent.start();
console.log(`[echo-agent] Connected to ${RELAY_URL}`);
console.log(`[echo-agent] Agent ID: ${agent.identity.agentId}`);
console.log(`[echo-agent] Base price: $${BASE_PRICE}`);
console.log('[echo-agent] Ready.');
