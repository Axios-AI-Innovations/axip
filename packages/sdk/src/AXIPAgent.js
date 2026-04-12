/**
 * AXIP SDK — Agent Class
 *
 * The main interface for building AXIP-compatible agents.
 * Ties together crypto identity, message building, and WebSocket connection.
 *
 * Usage:
 *   const agent = new AXIPAgent({ name: 'my-agent', capabilities: ['web_search'] });
 *   agent.on('task_request', async (msg) => { ... });
 *   await agent.start();
 */

import { EventEmitter } from 'events';
import { loadOrCreateIdentity } from './crypto.js';
import * as messages from './messages.js';
import { AXIPConnection } from './connection.js';

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds for request-response patterns

export class AXIPAgent extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} opts.name - Agent name (also used as identity directory name)
   * @param {string[]} [opts.capabilities=[]] - Capabilities this agent provides
   * @param {string} [opts.relayUrl='ws://127.0.0.1:4200'] - Relay WebSocket URL
   * @param {Object} [opts.pricing={}] - Pricing for capabilities
   */
  constructor({ name, capabilities = [], relayUrl = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200', pricing = {}, metadata = {} }) {
    super();

    this.name = name;
    this.capabilities = capabilities;
    this.pricing = pricing;
    this.metadata = metadata;
    this.relayUrl = relayUrl;

    // Load or generate cryptographic identity
    this.identity = loadOrCreateIdentity(name);

    // Pending request-response tracking (for discover, etc.)
    this._pendingRequests = new Map();

    // WebSocket connection
    this.connection = new AXIPConnection({
      url: relayUrl,
      reconnect: true,
      heartbeatInterval: 30_000
    });

    // Wire up connection events
    this.connection.on('message', (msg) => this._handleMessage(msg));
    this.connection.on('heartbeat-needed', () => this._sendHeartbeat());
    this.connection.on('disconnected', () => this.emit('disconnected'));
    // Re-announce on reconnect so the relay re-registers the agent
    this.connection.on('connected', () => this._reannounce());
  }

  // ─── Lifecycle ─────────────────────────────────────────────────

  /**
   * Connect to the relay and announce capabilities.
   */
  async start() {
    this._started = true;
    await this.connection.connect();

    // Send announce message
    const msg = messages.buildAnnounce(this.identity, {
      capabilities: this.capabilities,
      name: this.name,
      pricing: this.pricing,
      metadata: this.metadata
    });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);

    this.emit('connected');
  }

  /**
   * Disconnect from the relay.
   */
  stop() {
    this.connection.disconnect();
    // Clear all pending request timeouts
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this._pendingRequests.clear();
  }

  // ─── Sending Messages ──────────────────────────────────────────

  /**
   * Send a raw typed message to a target.
   * Signs the message before sending.
   *
   * @param {string} type - Message type
   * @param {string} to - Target agent_id, 'relay', or 'network'
   * @param {Object} payload - Message payload
   * @returns {Object} The sent message (for correlation)
   */
  send(type, to, payload) {
    const msg = messages.buildMessage(type, this.identity, to, payload);
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);
    return msg;
  }

  /**
   * Discover agents with a specific capability.
   * Returns a promise that resolves when the relay responds with discover_result.
   *
   * @param {string} capability - Capability to search for
   * @param {Object} [constraints={}] - Optional constraints (max_cost, min_reputation)
   * @returns {Promise<Object>} The discover_result message
   */
  discover(capability, constraints = {}) {
    const msg = messages.buildDiscover(this.identity, { capability, constraints });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);

    // Return a promise that resolves when discover_result arrives
    return this._waitForResponse(msg.id, 'discover_result');
  }

  /**
   * Send a bid for a task.
   */
  sendBid(to, taskId, { price, etaSeconds = 30, confidence = 0.8, model, message: bidMessage }) {
    const msg = messages.buildTaskBid(this.identity, to, {
      taskId,
      price,
      etaSeconds,
      confidence,
      model,
      message: bidMessage
    });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);
    return msg;
  }

  /**
   * Accept a bid on a task.
   */
  acceptBid(to, taskId, bidId) {
    const msg = messages.buildTaskAccept(this.identity, to, { taskId, bidId });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);
    return msg;
  }

  /**
   * Send task result.
   */
  sendResult(to, taskId, output, { status = 'completed', actualCost = 0, actualTime = 0, modelUsed } = {}) {
    const msg = messages.buildTaskResult(this.identity, to, {
      taskId,
      status,
      output,
      actualCost,
      actualTime,
      modelUsed
    });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);
    return msg;
  }

  /**
   * Verify a task result (as the requester).
   */
  verifyResult(to, taskId, verified, qualityScore, feedback = '') {
    const msg = messages.buildTaskVerify(this.identity, to, {
      taskId,
      verified,
      qualityScore,
      feedback
    });
    messages.signMessage(msg, this.identity.secretKey);
    this.connection.send(msg);
    return msg;
  }

  // ─── Internal Message Handling ────────────────────────────────

  /**
   * Route inbound messages to the appropriate handler or event.
   */
  _handleMessage(msg) {
    // Validate message structure
    const validation = messages.validateMessage(msg);
    if (!validation.valid) {
      console.warn(`[agent:${this.name}] Invalid message received: ${validation.error}`);
      return;
    }

    // Check if this resolves a pending request
    this._resolvePendingRequest(msg);

    // Emit type-specific events for the agent's skill handlers
    switch (msg.type) {
      case 'announce_ack':
        this.emit('announce_ack', msg);
        break;
      case 'discover_result':
        this.emit('discover_result', msg);
        break;
      case 'task_request':
        this.emit('task_request', msg);
        break;
      case 'task_bid':
        this.emit('task_bid', msg);
        break;
      case 'task_accept':
        this.emit('task_accept', msg);
        break;
      case 'task_result':
        this.emit('task_result', msg);
        break;
      case 'task_verify':
        this.emit('task_verify', msg);
        break;
      case 'task_settle':
        this.emit('task_settle', msg);
        break;
      case 'task_cancel':
        this.emit('task_cancel', msg);
        break;
      case 'balance_result':
        this.emit('balance_result', msg);
        break;
      case 'status_result':
        this.emit('status_result', msg);
        break;
      case 'error':
        this.emit('error_message', msg);
        break;
      default:
        this.emit('unknown_message', msg);
    }
  }

  /**
   * Send a heartbeat to the relay.
   */
  _sendHeartbeat() {
    try {
      const msg = messages.buildHeartbeat(this.identity);
      messages.signMessage(msg, this.identity.secretKey);
      this.connection.send(msg);
    } catch {
      // Non-fatal — heartbeat failure is logged by connection layer
    }
  }

  /**
   * Re-announce capabilities after a reconnect.
   * Only fires on subsequent connects (not the initial one from start()).
   */
  _reannounce() {
    if (!this._started) return; // start() hasn't run yet — initial connect, skip
    try {
      const msg = messages.buildAnnounce(this.identity, {
        capabilities: this.capabilities,
        name: this.name,
        pricing: this.pricing,
        metadata: this.metadata
      });
      messages.signMessage(msg, this.identity.secretKey);
      this.connection.send(msg);
    } catch {
      // Non-fatal — will retry on next reconnect
    }
  }

  // ─── Request-Response Correlation ─────────────────────────────

  /**
   * Wait for a response to a specific request.
   * Uses the request message ID to correlate with incoming messages.
   */
  _waitForResponse(requestId, expectedType) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out waiting for ${expectedType}`));
      }, REQUEST_TIMEOUT_MS);

      this._pendingRequests.set(requestId, {
        expectedType,
        resolve,
        reject,
        timeout
      });
    });
  }

  /**
   * Check if an incoming message resolves a pending request.
   */
  _resolvePendingRequest(msg) {
    // Check if payload contains a request_id that matches a pending request
    const requestId = msg.payload?.request_id;
    if (!requestId) return;

    const pending = this._pendingRequests.get(requestId);
    if (!pending) return;

    if (pending.expectedType && msg.type !== pending.expectedType) return;

    clearTimeout(pending.timeout);
    this._pendingRequests.delete(requestId);
    pending.resolve(msg);
  }
}
