/**
 * AXIP SDK — Integration Tests
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Run: node --test test/integration.test.js
 *
 * Tests:
 *   1. Crypto: generate identity, sign, verify
 *   2. Messages: build and validate all message types
 *   3. AXIPAgent: connect/disconnect with mock WebSocket
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';

// ─── Import SDK modules once at top level ───────────────────────
// (ESM dynamic imports must be awaited; use before() to load them)

let crypto;
let messages;
let AXIPAgent;

before(async () => {
  crypto = await import('../src/crypto.js');
  messages = await import('../src/messages.js');
  ({ AXIPAgent } = await import('../src/AXIPAgent.js'));
});

// ─── Helpers ────────────────────────────────────────────────────

function makeFakeIdentity(name = '__test_sdk_messages__') {
  return crypto.loadOrCreateIdentity(name);
}

// ─── Crypto Tests ───────────────────────────────────────────────

describe('crypto', () => {
  test('generateKeypair returns valid Ed25519 keypair', () => {
    const kp = crypto.generateKeypair();

    assert.ok(kp.publicKey instanceof Uint8Array, 'publicKey should be Uint8Array');
    assert.ok(kp.secretKey instanceof Uint8Array, 'secretKey should be Uint8Array');
    assert.strictEqual(kp.publicKey.length, 32, 'Ed25519 public key is 32 bytes');
    assert.strictEqual(kp.secretKey.length, 64, 'Ed25519 secret key is 64 bytes');
  });

  test('formatPubkey and parsePubkey are inverse operations', () => {
    const kp = crypto.generateKeypair();
    const formatted = crypto.formatPubkey(kp.publicKey);

    assert.ok(formatted.startsWith('ed25519:'), 'formatted pubkey should start with ed25519:');

    const parsed = crypto.parsePubkey(formatted);
    assert.deepStrictEqual(parsed, kp.publicKey, 'parsed pubkey should match original');
  });

  test('sign produces a valid signature string', () => {
    const kp = crypto.generateKeypair();
    const sig = crypto.sign('hello world', kp.secretKey);

    assert.ok(typeof sig === 'string', 'signature should be a string');
    assert.ok(sig.startsWith('ed25519:'), 'signature should start with ed25519:');
  });

  test('verify returns true for valid signature', () => {
    const kp = crypto.generateKeypair();
    const message = 'test message for verification';
    const sig = crypto.sign(message, kp.secretKey);

    const valid = crypto.verify(message, sig, kp.publicKey);
    assert.strictEqual(valid, true, 'signature should verify correctly');
  });

  test('verify returns false for tampered message', () => {
    const kp = crypto.generateKeypair();
    const sig = crypto.sign('original message', kp.secretKey);

    const valid = crypto.verify('tampered message', sig, kp.publicKey);
    assert.strictEqual(valid, false, 'tampered message should fail verification');
  });

  test('verify returns false for wrong public key', () => {
    const kp1 = crypto.generateKeypair();
    const kp2 = crypto.generateKeypair();
    const sig = crypto.sign('hello', kp1.secretKey);

    const valid = crypto.verify('hello', sig, kp2.publicKey);
    assert.strictEqual(valid, false, 'wrong public key should fail verification');
  });

  test('loadOrCreateIdentity creates a new identity', () => {
    const identity = crypto.loadOrCreateIdentity('__test_sdk_integration__');

    assert.ok(typeof identity.agentId === 'string', 'agentId should be a string');
    assert.ok(identity.agentId.startsWith('__test_sdk_integration__'), 'agentId should start with agent name');
    assert.ok(identity.publicKey instanceof Uint8Array, 'publicKey should be Uint8Array');
    assert.ok(identity.secretKey instanceof Uint8Array, 'secretKey should be Uint8Array');
    assert.ok(identity.pubkeyFormatted.startsWith('ed25519:'), 'pubkeyFormatted should start with ed25519:');
  });

  test('loadOrCreateIdentity is idempotent (loads existing identity)', () => {
    const identity1 = crypto.loadOrCreateIdentity('__test_sdk_integration__');
    const identity2 = crypto.loadOrCreateIdentity('__test_sdk_integration__');

    assert.strictEqual(identity1.agentId, identity2.agentId, 'agentId should be stable across loads');
    assert.deepStrictEqual(identity1.publicKey, identity2.publicKey, 'publicKey should be stable');
  });

  test('toBase64 and fromBase64 are inverse operations', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 255, 0, 128]);
    const b64 = crypto.toBase64(bytes);
    const decoded = crypto.fromBase64(b64);

    assert.deepStrictEqual(decoded, bytes, 'round-trip base64 should match original');
  });
});

// ─── Messages Tests ─────────────────────────────────────────────

describe('messages', () => {
  test('buildMessage creates a valid envelope', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('heartbeat', identity, 'relay', { status: 'online' });

    assert.strictEqual(msg.axip, '0.1.0', 'should set protocol version');
    assert.ok(msg.id.startsWith('msg_'), 'id should start with msg_');
    assert.strictEqual(msg.type, 'heartbeat', 'type should be set');
    assert.strictEqual(msg.from.agent_id, identity.agentId, 'from.agent_id should match identity');
    assert.strictEqual(msg.from.pubkey, identity.pubkeyFormatted, 'from.pubkey should match identity');
    assert.strictEqual(msg.to, 'relay', 'to should be set');
    assert.ok(typeof msg.timestamp === 'string', 'timestamp should be a string');
    assert.ok(typeof msg.nonce === 'string', 'nonce should be a string');
    assert.deepStrictEqual(msg.payload, { status: 'online' }, 'payload should be set');
    assert.strictEqual(msg.signature, null, 'signature should be null before signing');
  });

  test('signMessage adds a valid signature', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('heartbeat', identity, 'relay', { status: 'online' });
    messages.signMessage(msg, identity.secretKey);

    assert.ok(typeof msg.signature === 'string', 'signature should be a string after signing');
    assert.ok(msg.signature.startsWith('ed25519:'), 'signature should start with ed25519:');
  });

  test('verifyMessage returns true for signed message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('heartbeat', identity, 'relay', { status: 'online' });
    messages.signMessage(msg, identity.secretKey);

    assert.strictEqual(messages.verifyMessage(msg), true, 'signed message should verify');
  });

  test('verifyMessage returns false for unsigned message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('heartbeat', identity, 'relay', { status: 'online' });
    // Don't sign it

    assert.strictEqual(messages.verifyMessage(msg), false, 'unsigned message should not verify');
  });

  test('verifyMessage returns false for tampered payload', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('heartbeat', identity, 'relay', { status: 'online' });
    messages.signMessage(msg, identity.secretKey);

    // Tamper with payload after signing
    msg.payload.status = 'tampered';

    assert.strictEqual(messages.verifyMessage(msg), false, 'tampered message should not verify');
  });

  test('buildAnnounce creates correct announce message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildAnnounce(identity, {
      capabilities: ['web_search', 'summarize'],
      name: 'Test Agent',
      pricing: { web_search: { base_usd: 0.03 } }
    });

    assert.strictEqual(msg.type, 'announce');
    assert.strictEqual(msg.to, 'relay');
    assert.deepStrictEqual(msg.payload.capabilities, ['web_search', 'summarize']);
    assert.strictEqual(msg.payload.name, 'Test Agent');
  });

  test('buildDiscover creates correct discover message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildDiscover(identity, {
      capability: 'web_search',
      constraints: { max_cost_usd: 0.05, min_reputation: 0.7 }
    });

    assert.strictEqual(msg.type, 'discover');
    assert.strictEqual(msg.to, 'relay');
    assert.strictEqual(msg.payload.capability, 'web_search');
    assert.strictEqual(msg.payload.constraints.max_cost_usd, 0.05);
  });

  test('buildTaskRequest creates correct task_request message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildTaskRequest(identity, 'network', {
      description: 'Search for AI news',
      capability: 'web_search',
      reward: 0.05
    });

    assert.strictEqual(msg.type, 'task_request');
    assert.strictEqual(msg.to, 'network');
    assert.ok(msg.payload.task_id.startsWith('task_'), 'task_id should be auto-generated');
    assert.strictEqual(msg.payload.description, 'Search for AI news');
    assert.strictEqual(msg.payload.capability_required, 'web_search');
    assert.strictEqual(msg.payload.reward, 0.05);
  });

  test('buildTaskBid creates correct task_bid message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildTaskBid(identity, 'requester-123', {
      taskId: 'task_abc',
      price: 0.03,
      etaSeconds: 15,
      confidence: 0.9
    });

    assert.strictEqual(msg.type, 'task_bid');
    assert.strictEqual(msg.payload.task_id, 'task_abc');
    assert.strictEqual(msg.payload.price_usd, 0.03);
    assert.ok(msg.payload.bid_id.startsWith('bid_'), 'bid_id should be auto-generated');
  });

  test('buildTaskAccept creates correct task_accept message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildTaskAccept(identity, 'assignee-456', {
      taskId: 'task_abc',
      bidId: 'bid_xyz'
    });

    assert.strictEqual(msg.type, 'task_accept');
    assert.strictEqual(msg.payload.task_id, 'task_abc');
    assert.strictEqual(msg.payload.bid_id, 'bid_xyz');
  });

  test('buildTaskResult creates correct task_result message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildTaskResult(identity, 'requester-123', {
      taskId: 'task_abc',
      status: 'completed',
      output: { answer: 42 },
      actualCost: 0.03,
      actualTime: 12
    });

    assert.strictEqual(msg.type, 'task_result');
    assert.strictEqual(msg.payload.task_id, 'task_abc');
    assert.strictEqual(msg.payload.status, 'completed');
    assert.deepStrictEqual(msg.payload.output, { answer: 42 });
    assert.strictEqual(msg.payload.actual_cost_usd, 0.03);
  });

  test('buildTaskVerify creates correct task_verify message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildTaskVerify(identity, 'relay', {
      taskId: 'task_abc',
      verified: true,
      qualityScore: 0.85,
      feedback: 'Good work'
    });

    assert.strictEqual(msg.type, 'task_verify');
    assert.strictEqual(msg.payload.task_id, 'task_abc');
    assert.strictEqual(msg.payload.verified, true);
    assert.strictEqual(msg.payload.quality_score, 0.85);
    assert.strictEqual(msg.payload.feedback, 'Good work');
  });

  test('buildHeartbeat creates correct heartbeat message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildHeartbeat(identity, { status: 'online', activeTasks: 2, load: 0.4 });

    assert.strictEqual(msg.type, 'heartbeat');
    assert.strictEqual(msg.to, 'relay');
    assert.strictEqual(msg.payload.status, 'online');
    assert.strictEqual(msg.payload.active_tasks, 2);
    assert.strictEqual(msg.payload.load, 0.4);
  });

  test('buildError creates correct error message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildError(identity, 'requester-999', {
      code: 'TASK_NOT_FOUND',
      message: 'Task does not exist',
      relatedMessageId: 'msg_orig'
    });

    assert.strictEqual(msg.type, 'error');
    assert.strictEqual(msg.payload.code, 'TASK_NOT_FOUND');
    assert.strictEqual(msg.payload.related_message_id, 'msg_orig');
  });

  test('validateMessage accepts a well-formed message', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildHeartbeat(identity);
    messages.signMessage(msg, identity.secretKey);

    const result = messages.validateMessage(msg);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.error, null);
  });

  test('validateMessage rejects message with missing fields', () => {
    const result = messages.validateMessage({ axip: '0.1.0', type: 'heartbeat' });
    assert.strictEqual(result.valid, false);
    assert.ok(typeof result.error === 'string', 'error should describe the problem');
  });

  test('validateMessage rejects unknown message type', () => {
    const identity = makeFakeIdentity();
    const msg = messages.buildMessage('totally_fake_type', identity, 'relay', {});
    const result = messages.validateMessage(msg);

    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('totally_fake_type'), 'error should mention invalid type');
  });

  test('each message has a unique id and nonce', () => {
    const identity = makeFakeIdentity();
    const msgs = Array.from({ length: 5 }, () => messages.buildHeartbeat(identity));

    const ids = new Set(msgs.map(m => m.id));
    const nonces = new Set(msgs.map(m => m.nonce));

    assert.strictEqual(ids.size, 5, 'all message IDs should be unique');
    assert.strictEqual(nonces.size, 5, 'all nonces should be unique');
  });
});

// ─── AXIPAgent Tests ────────────────────────────────────────────

describe('AXIPAgent', () => {
  test('AXIPAgent can be constructed with default options', () => {
    const agent = new AXIPAgent({ name: '__test_agent_construct__', relayUrl: 'ws://127.0.0.1:9999' });

    assert.strictEqual(agent.name, '__test_agent_construct__');
    assert.ok(Array.isArray(agent.capabilities), 'capabilities should be an array');
    assert.ok(typeof agent.identity.agentId === 'string', 'identity should be set');
    assert.ok(agent.connection !== null, 'connection should be initialized');
  });

  test('AXIPAgent emits connected event and sends announce on start (mock WS)', async () => {
    const agent = new AXIPAgent({
      name: '__test_agent_start__',
      capabilities: ['test_cap'],
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];

    // Patch connection so no real WebSocket is created
    agent.connection.connect = () => {
      agent.connection.connected = true;
      agent.connection._startHeartbeat();
      agent.connection.emit('connected');
      return Promise.resolve();
    };
    agent.connection.send = (msg) => sent.push(msg);

    let connectedFired = false;
    agent.on('connected', () => { connectedFired = true; });

    await agent.start();

    assert.strictEqual(connectedFired, true, 'connected event should fire');
    assert.ok(sent.length >= 1, 'at least one message should be sent (announce)');

    const announce = sent.find(m => m.type === 'announce');
    assert.ok(announce, 'announce message should be sent');
    assert.deepStrictEqual(announce.payload.capabilities, ['test_cap']);
    assert.ok(announce.signature !== null, 'announce should be signed');

    const valid = messages.verifyMessage(announce);
    assert.strictEqual(valid, true, 'announce signature should be valid');

    agent.stop();
  });

  test('AXIPAgent stop() clears pending requests', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_stop__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    // Inject a fake pending request
    agent._pendingRequests.set('fake_req', {
      expectedType: 'discover_result',
      resolve: () => {},
      reject: () => {},
      timeout: setTimeout(() => {}, 60000)
    });

    assert.strictEqual(agent._pendingRequests.size, 1, 'should have one pending request');

    agent.connection.disconnect = () => {}; // no-op for test
    agent.stop();

    assert.strictEqual(agent._pendingRequests.size, 0, 'stop() should clear pending requests');
  });

  test('AXIPAgent send() builds and signs messages', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_send__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];
    agent.connection.connected = true;
    agent.connection.send = (msg) => sent.push(msg);

    const msg = agent.send('heartbeat', 'relay', { status: 'online', active_tasks: 0, load: 0 });

    assert.strictEqual(sent.length, 1, 'one message should be sent');
    assert.strictEqual(msg.type, 'heartbeat');
    assert.ok(msg.signature !== null, 'message should be signed');
    assert.strictEqual(messages.verifyMessage(msg), true, 'signature should verify');
  });

  test('AXIPAgent sendBid() builds a valid bid', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_bid__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];
    agent.connection.connected = true;
    agent.connection.send = (msg) => sent.push(msg);

    const msg = agent.sendBid('requester-abc', 'task_xyz', {
      price: 0.04,
      etaSeconds: 20,
      confidence: 0.85,
      model: 'gpt-4o'
    });

    assert.strictEqual(msg.type, 'task_bid');
    assert.strictEqual(msg.payload.task_id, 'task_xyz');
    assert.strictEqual(msg.payload.price_usd, 0.04);
    assert.strictEqual(msg.payload.model, 'gpt-4o');
    assert.ok(msg.signature !== null, 'bid should be signed');
  });

  test('AXIPAgent acceptBid() builds a valid accept', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_accept__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];
    agent.connection.connected = true;
    agent.connection.send = (msg) => sent.push(msg);

    const msg = agent.acceptBid('assignee-xyz', 'task_abc', 'bid_123');

    assert.strictEqual(msg.type, 'task_accept');
    assert.strictEqual(msg.payload.task_id, 'task_abc');
    assert.strictEqual(msg.payload.bid_id, 'bid_123');
  });

  test('AXIPAgent sendResult() builds a valid result', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_result__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];
    agent.connection.connected = true;
    agent.connection.send = (msg) => sent.push(msg);

    const msg = agent.sendResult('requester-abc', 'task_xyz', { data: 'result' }, {
      status: 'completed',
      actualCost: 0.03,
      actualTime: 10,
      modelUsed: 'llama3'
    });

    assert.strictEqual(msg.type, 'task_result');
    assert.strictEqual(msg.payload.task_id, 'task_xyz');
    assert.strictEqual(msg.payload.status, 'completed');
    assert.deepStrictEqual(msg.payload.output, { data: 'result' });
    assert.strictEqual(msg.payload.actual_cost_usd, 0.03);
  });

  test('AXIPAgent verifyResult() builds a valid verify', () => {
    const agent = new AXIPAgent({
      name: '__test_agent_verify__',
      relayUrl: 'ws://127.0.0.1:9999'
    });

    const sent = [];
    agent.connection.connected = true;
    agent.connection.send = (msg) => sent.push(msg);

    const msg = agent.verifyResult('relay', 'task_xyz', true, 0.9, 'Excellent work');

    assert.strictEqual(msg.type, 'task_verify');
    assert.strictEqual(msg.payload.task_id, 'task_xyz');
    assert.strictEqual(msg.payload.verified, true);
    assert.strictEqual(msg.payload.quality_score, 0.9);
    assert.strictEqual(msg.payload.feedback, 'Excellent work');
  });
});
