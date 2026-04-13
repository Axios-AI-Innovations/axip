/**
 * AXIP Hive Portal — Task Requester
 *
 * Maintains a persistent portal-requester agent connection to the relay.
 * Allows non-SDK web users to submit tasks through the portal UI.
 *
 * The portal acts as a trusted proxy: it submits tasks on behalf of web users,
 * waits for results, and returns them via HTTP.
 */

import { AXIPAgent } from '@axip/sdk';
import { randomUUID } from 'crypto';

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';
const TASK_TIMEOUT_MS = 60_000; // 60 seconds max per task

let agent = null;
let connected = false;
let connecting = false;

/**
 * Initialize (or return existing) portal requester agent.
 * @returns {Promise<AXIPAgent>}
 */
async function getAgent() {
  if (agent && connected) return agent;

  if (connecting) {
    // Wait for in-progress connect
    await new Promise(resolve => setTimeout(resolve, 500));
    return getAgent();
  }

  connecting = true;
  try {
    if (agent) {
      agent.stop();
      agent = null;
    }

    agent = new AXIPAgent({
      name: 'portal-requester',
      capabilities: [],
      relayUrl: RELAY_URL,
      metadata: { operator: 'axip-hive-portal', node_type: 'requester' }
    });

    agent.on('connected', () => { connected = true; });
    agent.on('disconnected', () => { connected = false; });

    await agent.start();
    connected = true;
    console.log('[task-requester] Portal requester connected to relay');
  } finally {
    connecting = false;
  }

  return agent;
}

/**
 * Submit a task through the portal requester agent.
 *
 * @param {string} capability - Required capability (e.g. "web_search")
 * @param {string} description - Task description
 * @param {number} maxBudget - Maximum USD willing to pay
 * @returns {Promise<{ task_id, status, result, cost, agent_used, elapsed_ms }>}
 */
export async function submitTask(capability, description, maxBudget = 0.10) {
  const requester = await getAgent();
  const taskId = `task_${randomUUID()}`;
  const startTime = Date.now();

  // Step 1: Broadcast task_request to network
  requester.send('task_request', 'network', {
    task_id: taskId,
    description,
    capability_required: capability,
    constraints: { max_cost: maxBudget },
    reward: maxBudget
  });

  // Step 2: Wait for first bid
  const bid = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requester.off('task_bid', onBid);
      reject(new Error('No bids received within 30 seconds — no agents available for this capability'));
    }, TASK_TIMEOUT_MS / 2);

    function onBid(msg) {
      if (msg.payload?.task_id !== taskId) return;
      clearTimeout(timeout);
      requester.off('task_bid', onBid);
      resolve(msg);
    }

    requester.on('task_bid', onBid);
  });

  // Step 3: Accept the bid
  const bidId = bid.payload.bid_id;
  const bidderAgentId = bid.from.agent_id;
  const bidPrice = bid.payload.price_usd ?? bid.payload.price ?? 0;
  requester.acceptBid(bidderAgentId, taskId, bidId);

  // Step 4: Wait for result
  const resultMsg = await new Promise((resolve, reject) => {
    const remaining = TASK_TIMEOUT_MS - (Date.now() - startTime);
    const timeout = setTimeout(() => {
      requester.off('task_result', onResult);
      reject(new Error('Task execution timed out after 60 seconds'));
    }, Math.max(remaining, 5000));

    function onResult(msg) {
      if (msg.payload?.task_id !== taskId) return;
      clearTimeout(timeout);
      requester.off('task_result', onResult);
      resolve(msg);
    }

    requester.on('task_result', onResult);
  });

  const payload = resultMsg.payload;
  const elapsed = Date.now() - startTime;

  // Step 5: Verify the result (non-blocking — fire and forget)
  try {
    requester.verifyResult(bidderAgentId, taskId, true, 0.8, 'Portal submission');
  } catch {
    // Non-fatal
  }

  return {
    task_id: taskId,
    status: payload.status || 'completed',
    result: payload.output,
    cost: payload.actual_cost_usd ?? bidPrice,
    agent_used: bid.payload.agent_name || bidderAgentId,
    elapsed_ms: elapsed
  };
}

/**
 * Get list of available capabilities from the portal's relay proxy.
 * @param {string} relayApiUrl - relay API base URL
 * @returns {Promise<string[]>}
 */
export async function getCapabilities(relayApiUrl) {
  try {
    const res = await fetch(`${relayApiUrl}/api/agents`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const agents = await res.json();
    const caps = new Set();
    for (const agent of agents) {
      if (agent.status === 'online') {
        for (const c of (agent.capabilities || [])) caps.add(c);
      }
    }
    return [...caps].sort();
  } catch {
    return [];
  }
}
