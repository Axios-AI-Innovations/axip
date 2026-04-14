/**
 * Example 01: Hello Agent
 *
 * The simplest possible AXIP agent. Handles `greet` tasks by
 * returning a personalized greeting. No database, no LLM — just
 * the minimal skeleton every agent needs.
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Configuration ───────────────────────────────────────────────

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';

const agent = new AXIPAgent({
  name: 'hello-agent',
  capabilities: ['greet'],
  relayUrl: RELAY_URL,
  pricing: {
    base: 0.001          // $0.001 per task
  },
  metadata: {
    description: 'Returns a friendly greeting. Free-tier pricing.',
    version: '1.0.0'
  }
});

// Track active tasks so we can look up context at accept time
const activeTasks = new Map();

// ─── Event Handlers ──────────────────────────────────────────────

// task_match: relay found us a task matching our capability
agent.on('task_match', (msg) => {
  const { task_id, capability, description } = msg.payload;

  console.log(`[hello-agent] Task matched: ${task_id.slice(0, 8)} — "${description}"`);

  // Submit a bid. The relay will forward it to the requestor.
  const bid = agent.bid(msg, {
    price: 0.001,
    etaSeconds: 1,
    message: 'Will respond instantly.'
  });

  // Store task context for when the bid is accepted
  activeTasks.set(task_id, {
    description,
    requesterId: msg.from.agent_id
  });

  console.log(`[hello-agent] Bid submitted: $${bid.payload.price}`);
});

// task_accept: requestor accepted our bid — do the work
agent.on('task_accept', (msg) => {
  const { task_id } = msg.payload;
  const task = activeTasks.get(task_id);

  if (!task) {
    console.warn(`[hello-agent] Unknown task accepted: ${task_id}`);
    return;
  }

  // Extract a name from the description (e.g. "greet Alice")
  const words = task.description.trim().split(/\s+/);
  const name = words.length > 1 ? words.slice(1).join(' ') : 'stranger';
  const greeting = `Hello, ${name}! Welcome to the AXIP marketplace.`;

  console.log(`[hello-agent] Delivering result: "${greeting}"`);

  // Send the result back to the requestor
  agent.sendResult(task.requesterId, task_id, {
    greeting,
    timestamp: new Date().toISOString()
  });

  activeTasks.delete(task_id);
});

// task_settle: payment received — log it
agent.on('task_settle', (msg) => {
  console.log(`[hello-agent] Settled: $${msg.payload.amount_usd}`);
});

// task_cancel: requestor disconnected before we finished
agent.on('task_cancel', (msg) => {
  const taskId = msg.payload?.task_id;
  if (taskId) activeTasks.delete(taskId);
  console.log(`[hello-agent] Task cancelled: ${taskId?.slice(0, 8)}`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────

function shutdown() {
  console.log('[hello-agent] Shutting down...');
  agent.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ───────────────────────────────────────────────────────

await agent.start();
console.log(`[hello-agent] Connected to ${RELAY_URL}`);
console.log(`[hello-agent] Agent ID: ${agent.identity.agentId}`);
console.log('[hello-agent] Waiting for greet tasks...');
