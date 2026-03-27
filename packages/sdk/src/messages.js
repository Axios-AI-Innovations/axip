/**
 * AXIP SDK — Message Builders and Validation
 *
 * Builds AXIP protocol message envelopes for all message types.
 * Handles canonical JSON serialization for signing.
 * Validates inbound messages against the protocol spec.
 */

import { randomUUID } from 'crypto';
import { sign as signData, verify as verifyData, parsePubkey } from './crypto.js';

// ─── Known Message Types ───────────────────────────────────────

const VALID_TYPES = new Set([
  'announce', 'announce_ack',
  'discover', 'discover_result',
  'task_request', 'task_bid', 'task_accept',
  'task_result', 'task_verify', 'task_settle',
  'heartbeat', 'capability_update',
  'balance_request', 'balance_result',
  'status_request', 'status_result',
  'error'
]);

// ─── Canonical JSON for Signing ────────────────────────────────

/**
 * Produce a deterministic JSON string for signing.
 * Nulls the signature field and sorts keys at the top level.
 *
 * @param {Object} msg - AXIP message envelope
 * @returns {string} Canonical JSON string
 */
export function canonicalize(msg) {
  const signable = {
    axip: msg.axip,
    id: msg.id,
    type: msg.type,
    from: msg.from,
    to: msg.to,
    timestamp: msg.timestamp,
    nonce: msg.nonce,
    payload: msg.payload
  };
  return JSON.stringify(signable);
}

// ─── Sign and Verify ───────────────────────────────────────────

/**
 * Sign a message in place. Mutates the message to add the signature field.
 *
 * @param {Object} msg - AXIP message (signature will be set)
 * @param {Uint8Array} secretKey - Agent's ed25519 secret key
 */
export function signMessage(msg, secretKey) {
  const canonical = canonicalize(msg);
  msg.signature = signData(canonical, secretKey);
}

/**
 * Verify a message's signature against the embedded public key.
 *
 * @param {Object} msg - AXIP message with signature
 * @returns {boolean} True if signature is valid
 */
export function verifyMessage(msg) {
  if (!msg.signature || !msg.from?.pubkey) return false;
  try {
    const canonical = canonicalize(msg);
    const publicKey = parsePubkey(msg.from.pubkey);
    return verifyData(canonical, msg.signature, publicKey);
  } catch {
    return false;
  }
}

// ─── Core Message Builder ──────────────────────────────────────

/**
 * Build an unsigned AXIP message envelope.
 *
 * @param {string} type - Message type
 * @param {{ agentId: string, pubkeyFormatted: string }} from - Sender identity
 * @param {string} to - Target: agent_id, 'network', or 'relay'
 * @param {Object} payload - Type-specific data
 * @returns {Object} AXIP message envelope (unsigned)
 */
export function buildMessage(type, from, to, payload) {
  return {
    axip: '0.1.0',
    id: `msg_${randomUUID()}`,
    type,
    from: {
      agent_id: from.agentId,
      pubkey: from.pubkeyFormatted
    },
    to,
    timestamp: new Date().toISOString(),
    nonce: randomUUID(),
    payload,
    signature: null
  };
}

// ─── Type-Specific Builders ────────────────────────────────────

export function buildAnnounce(from, { capabilities, name, pricing = {}, constraints = {}, metadata = {} }) {
  return buildMessage('announce', from, 'relay', {
    capabilities,
    name,
    pricing,
    constraints,
    metadata,
    version: '0.1.0'
  });
}

export function buildDiscover(from, { capability, constraints = {} }) {
  return buildMessage('discover', from, 'relay', {
    capability,
    constraints
  });
}

export function buildDiscoverResult(from, to, { agents, requestId }) {
  return buildMessage('discover_result', from, to, {
    agents,
    request_id: requestId
  });
}

export function buildTaskRequest(from, to, { taskId, description, capability, constraints = {}, reward = 0 }) {
  return buildMessage('task_request', from, to, {
    task_id: taskId || `task_${randomUUID()}`,
    description,
    capability_required: capability,
    constraints,
    reward
  });
}

export function buildTaskBid(from, to, { taskId, bidId, price, etaSeconds, confidence, model, message }) {
  return buildMessage('task_bid', from, to, {
    task_id: taskId,
    bid_id: bidId || `bid_${randomUUID()}`,
    price_usd: price,
    estimated_time_seconds: etaSeconds,
    confidence,
    model: model || 'local',
    message: message || ''
  });
}

export function buildTaskAccept(from, to, { taskId, bidId }) {
  return buildMessage('task_accept', from, to, {
    task_id: taskId,
    bid_id: bidId
  });
}

export function buildTaskResult(from, to, { taskId, status, output, actualCost, actualTime, modelUsed }) {
  return buildMessage('task_result', from, to, {
    task_id: taskId,
    status: status || 'completed',
    output,
    actual_cost_usd: actualCost || 0,
    actual_time_seconds: actualTime || 0,
    model_used: modelUsed || 'local'
  });
}

export function buildTaskVerify(from, to, { taskId, verified, qualityScore, feedback }) {
  return buildMessage('task_verify', from, to, {
    task_id: taskId,
    verified,
    quality_score: qualityScore,
    feedback: feedback || ''
  });
}

export function buildTaskSettle(from, to, { taskId, amount, fromBalance, toBalance }) {
  return buildMessage('task_settle', from, to, {
    task_id: taskId,
    amount_usd: amount,
    settlement_method: 'credit_ledger',
    from_balance: fromBalance,
    to_balance: toBalance
  });
}

export function buildHeartbeat(from, { status = 'online', activeTasks = 0, load = 0 } = {}) {
  return buildMessage('heartbeat', from, 'relay', {
    status,
    active_tasks: activeTasks,
    load
  });
}

export function buildError(from, to, { code, message, relatedMessageId }) {
  return buildMessage('error', from, to, {
    code,
    message,
    related_message_id: relatedMessageId
  });
}

// ─── Validation ────────────────────────────────────────────────

/**
 * Validate an AXIP message envelope has required fields.
 *
 * @param {Object} msg - Message to validate
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }
  if (msg.axip !== '0.1.0') {
    return { valid: false, error: `Unknown protocol version: ${msg.axip}` };
  }
  if (!msg.id) {
    return { valid: false, error: 'Missing message id' };
  }
  if (!msg.type || !VALID_TYPES.has(msg.type)) {
    return { valid: false, error: `Invalid message type: ${msg.type}` };
  }
  if (!msg.from?.agent_id || !msg.from?.pubkey) {
    return { valid: false, error: 'Missing or incomplete from field' };
  }
  if (!msg.to) {
    return { valid: false, error: 'Missing to field' };
  }
  if (!msg.timestamp) {
    return { valid: false, error: 'Missing timestamp' };
  }
  if (!msg.nonce) {
    return { valid: false, error: 'Missing nonce' };
  }
  if (!msg.payload || typeof msg.payload !== 'object') {
    return { valid: false, error: 'Missing or invalid payload' };
  }
  return { valid: true, error: null };
}
