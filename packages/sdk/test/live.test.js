/**
 * AXIP SDK — Live Relay Integration Tests
 *
 * Requires a running relay at ws://127.0.0.1:4200.
 * Skip gracefully if relay is unavailable.
 *
 * Covers SDK-4: connect, announce, discover, full task lifecycle.
 *
 * Run: node --test test/live.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AXIPAgent } from '../src/AXIPAgent.js';

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';
const RELAY_AVAILABLE_TIMEOUT = 5000;

// ─── Helpers ────────────────────────────────────────────────────

function waitForEvent(emitter, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeAllListeners(event);
      reject(new Error(`Timeout waiting for "${event}" (${timeoutMs}ms)`));
    }, timeoutMs);
    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Relay availability check ─────────────────────────────────

let relayAvailable = false;

before(async () => {
  // Quick ping to confirm relay is live
  try {
    const { WebSocket } = await import('ws');
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(RELAY_URL);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('connect timeout'));
      }, RELAY_AVAILABLE_TIMEOUT);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        relayAvailable = true;
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } catch {
    console.log(`[live-tests] Relay unavailable at ${RELAY_URL} — skipping live tests`);
  }
});

// ─── Test 1: Connect + Announce ──────────────────────────────────

describe('live: connect and announce', {}, () => {
  let agent;

  after(() => {
    if (agent) agent.stop();
  });

  test('agent connects to relay and receives announce_ack', async (t) => {
    if (!relayAvailable) {
      t.skip('relay not available');
      return;
    }

    agent = new AXIPAgent({
      name: 'sdk-test-connect',
      capabilities: ['test-cap'],
      relayUrl: RELAY_URL
    });

    const connectedPromise = waitForEvent(agent, 'connected', 8000);
    const ackPromise = waitForEvent(agent, 'announce_ack', 8000);

    await agent.start();
    await connectedPromise;

    const ack = await ackPromise;
    assert.strictEqual(ack.type, 'announce_ack', 'should receive announce_ack');
    assert.ok(ack.payload?.agent_id, 'ack should include agent_id');
  });
});

// ─── Test 2: Discover ────────────────────────────────────────────

describe('live: discover agents', {}, () => {
  let agent;

  after(() => {
    if (agent) agent.stop();
  });

  test('discovers agents with web_search capability', async (t) => {
    if (!relayAvailable) {
      t.skip('relay not available');
      return;
    }

    agent = new AXIPAgent({
      name: 'sdk-test-discover',
      capabilities: [],
      relayUrl: RELAY_URL
    });

    const connectedPromise = waitForEvent(agent, 'connected', 8000);
    await agent.start();
    await connectedPromise;
    await sleep(200); // Let announce settle

    const result = await agent.discover('web_search', {});

    assert.strictEqual(result.type, 'discover_result', 'should get discover_result');
    assert.ok(Array.isArray(result.payload?.agents), 'agents should be an array');
    // At least one agent should be available (agent-beta has web_search)
    assert.ok(result.payload.agents.length >= 1, `should find at least 1 web_search agent, found ${result.payload.agents.length}`);

    const firstAgent = result.payload.agents[0];
    assert.ok(firstAgent.agent_id, 'agent should have agent_id');
    assert.ok(Array.isArray(firstAgent.capabilities), 'agent should have capabilities array');
    assert.ok(firstAgent.capabilities.includes('web_search'), 'agent should have web_search capability');
  });

  test('discover with non-existent capability returns empty list', async (t) => {
    if (!relayAvailable) {
      t.skip('relay not available');
      return;
    }

    const result = await agent.discover('__nonexistent_cap_xyz__', {});

    assert.strictEqual(result.type, 'discover_result');
    assert.ok(Array.isArray(result.payload?.agents));
    assert.strictEqual(result.payload.agents.length, 0, 'should find no agents for fake capability');
  });
});

// ─── Test 3: Full Task Lifecycle ─────────────────────────────────
// Two agents: requester submits a task, provider bids and completes it.

describe('live: full task lifecycle', {}, () => {
  let requester;
  let provider;

  const TEST_CAPABILITY = 'sdk-live-test';

  after(() => {
    if (requester) requester.stop();
    if (provider) provider.stop();
  });

  test('completes full lifecycle: request → bid → accept → result → verify → settle', async (t) => {
    if (!relayAvailable) {
      t.skip('relay not available');
      return;
    }

    // ── Setup provider ──
    provider = new AXIPAgent({
      name: 'sdk-test-provider',
      capabilities: [TEST_CAPABILITY],
      relayUrl: RELAY_URL,
      pricing: { [TEST_CAPABILITY]: { base_usd: 0.00 } }  // Free for testing
    });

    const providerConnected = waitForEvent(provider, 'connected', 8000);
    await provider.start();
    await providerConnected;
    await sleep(300); // Let announce propagate

    // Provider: listen for task_request and auto-bid + complete
    provider.on('task_request', (msg) => {
      const { task_id: taskId } = msg.payload;
      const requesterId = msg.from.agent_id;

      // Send bid immediately
      provider.sendBid(requesterId, taskId, {
        price: 0.00,
        etaSeconds: 1,
        confidence: 1.0,
        model: 'test'
      });
    });

    provider.on('task_accept', async (msg) => {
      const { task_id: taskId } = msg.payload;
      const requesterId = msg.from.agent_id;

      // Simulate task execution
      await sleep(100);

      // Send result
      provider.sendResult(requesterId, taskId, { answer: 'test result' }, {
        status: 'completed',
        actualCost: 0.00,
        actualTime: 0.1,
        modelUsed: 'test'
      });
    });

    // ── Setup requester ──
    requester = new AXIPAgent({
      name: 'sdk-test-requester',
      capabilities: [],
      relayUrl: RELAY_URL
    });

    const requesterConnected = waitForEvent(requester, 'connected', 8000);
    await requester.start();
    await requesterConnected;
    await sleep(200);

    // Requester: listen for bid and auto-accept
    requester.on('task_bid', (msg) => {
      const { task_id: taskId, bid_id: bidId } = msg.payload;
      const bidderId = msg.from.agent_id;

      // Accept the first bid
      requester.acceptBid(bidderId, taskId, bidId);
    });

    // Requester: listen for result and verify
    const settlePromise = waitForEvent(requester, 'task_settle', 20000);

    requester.on('task_result', (msg) => {
      const { task_id: taskId, output } = msg.payload;

      // Verify the result
      assert.ok(output, 'result should have output');
      requester.verifyResult('relay', taskId, true, 1.0, 'Perfect test result');
    });

    // ── Submit task ──
    const discoverResult = await requester.discover(TEST_CAPABILITY, {});
    assert.ok(discoverResult.payload.agents.length >= 1, `provider should be discoverable, found: ${discoverResult.payload.agents.length}`);

    // Send task request to network
    const taskMsg = requester.send('task_request', 'network', {
      task_id: undefined,  // auto-generated by relay
      description: 'SDK live integration test task',
      capability_required: TEST_CAPABILITY,
      constraints: {},
      reward: 0.00
    });

    assert.ok(taskMsg.type === 'task_request', 'task_request should be sent');

    // ── Wait for full lifecycle to complete ──
    const settle = await settlePromise;
    assert.strictEqual(settle.type, 'task_settle', 'should receive task_settle');
    assert.ok(settle.payload?.task_id, 'settle should include task_id');
  });
});
