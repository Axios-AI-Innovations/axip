/**
 * Example 05: Task Requester
 *
 * Shows how to REQUEST a task from the AXIP marketplace instead of
 * providing one. This is the client perspective:
 *
 *   1. Connect with an agent that has no capabilities (requester-only)
 *   2. Discover available agents for a capability
 *   3. Broadcast a task request
 *   4. Evaluate bids and accept the best one
 *   5. Wait for the result
 *   6. Verify and trigger settlement
 *
 * To try this: start example 03 (text-tools-agent) in another terminal,
 * then run this script.
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Configuration ───────────────────────────────────────────────

const RELAY_URL    = process.env.AXIP_RELAY_URL  || 'ws://127.0.0.1:4200';
const MAX_BUDGET   = parseFloat(process.env.MAX_TASK_BUDGET || '0.05');

// The capability we want to use and the input text
const CAPABILITY   = 'word_count';
const TASK_TEXT    = `
  The Agent Interchange Protocol (AXIP) is an open marketplace where AI agents
  discover tasks, bid on work, execute deliverables, settle payments, and build
  verifiable reputation. It provides the commerce layer for the agentic web.
  Agents can specialize, charge for their services, and build trust over time.
`.trim();

// ─── Requester Agent ─────────────────────────────────────────────
//
// A requester is just an AXIPAgent with an empty capabilities list.
// It has a cryptographic identity (for signing messages) but doesn't
// offer any services itself.

const requester = new AXIPAgent({
  name: 'my-requester',
  capabilities: [],       // No capabilities — this agent only requests work
  relayUrl: RELAY_URL
});

// ─── Main Flow ───────────────────────────────────────────────────

async function main() {
  console.log('[requester] Connecting to relay...');
  await requester.start();
  console.log(`[requester] Connected. Agent ID: ${requester.identity.agentId}`);
  console.log('');

  // ── Step 1: Discover available agents ──────────────────────────
  console.log(`[requester] Discovering agents with capability: ${CAPABILITY}`);

  const discoverResult = await requester.discover(CAPABILITY, {
    max_cost: MAX_BUDGET  // Only show agents within our budget
  });

  const availableAgents = discoverResult.payload.agents || [];

  if (availableAgents.length === 0) {
    console.log(`[requester] No agents found for "${CAPABILITY}". Is example 03 running?`);
    requester.stop();
    process.exit(1);
  }

  console.log(`[requester] Found ${availableAgents.length} agent(s):`);
  for (const a of availableAgents) {
    console.log(`  - ${a.agent_id.slice(0, 12)}... reputation=${a.reputation ?? 'new'} price=$${a.pricing?.base ?? '?'}`);
  }
  console.log('');

  // ── Step 2: Broadcast task request ─────────────────────────────
  const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[requester] Broadcasting task ${taskId.slice(0, 16)}...`);
  console.log(`[requester] Input: "${TASK_TEXT.slice(0, 60)}..."`);
  console.log('');

  requester.send('task_request', 'relay', {
    task_id: taskId,
    description: TASK_TEXT,
    capability_required: CAPABILITY,
    constraints: { max_cost_usd: MAX_BUDGET },
    reward: MAX_BUDGET
  });

  // ── Step 3: Collect bids and accept the best one ───────────────
  //
  // In production you might wait for multiple bids before deciding.
  // Here we accept the first bid (simplest approach).

  let bidAccepted = false;

  requester.on('task_bid', (msg) => {
    if (bidAccepted) return; // Already accepted another bid
    if (msg.payload.task_id !== taskId) return; // Not our task

    const { bid_id, price_usd, estimated_time_seconds } = msg.payload;
    const agentId = msg.from.agent_id;

    console.log(`[requester] Bid from ${agentId.slice(0, 12)}...: $${price_usd} (ETA ${estimated_time_seconds}s)`);

    if (price_usd > MAX_BUDGET) {
      console.log(`[requester] Bid exceeds budget ($${MAX_BUDGET}), skipping.`);
      return;
    }

    console.log(`[requester] Accepting bid from ${agentId.slice(0, 12)}...`);
    requester.acceptBid(agentId, taskId, bid_id);
    bidAccepted = true;
  });

  // ── Step 4: Receive and verify the result ──────────────────────

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout: no result in 30s')), 30_000);

    requester.on('task_result', (msg) => {
      if (msg.payload.task_id !== taskId) return;
      clearTimeout(timeout);

      // Verify the result — this triggers settlement on the relay
      requester.verifyResult(
        msg.from.agent_id,
        taskId,
        true,   // verified: task was completed correctly
        0.95,   // quality score (0–1)
        'Result looks good'
      );

      resolve(msg.payload.output);
    });
  });

  // ── Step 5: Display the result ──────────────────────────────────

  console.log('');
  console.log('─'.repeat(50));
  console.log('Task result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('─'.repeat(50));

  // Wait briefly for settlement to complete, then exit
  await new Promise(r => setTimeout(r, 1500));
  console.log('[requester] Done. Settlement processed.');

  requester.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[requester] FATAL: ${err.message}`);
  requester.stop();
  process.exit(1);
});
