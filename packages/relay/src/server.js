/**
 * AXIP Relay — WebSocket Server
 *
 * Central message hub. Accepts agent connections, dispatches messages
 * to the appropriate handler modules, and routes messages between agents.
 *
 * The server itself contains no business logic — it's pure plumbing.
 */

import { WebSocketServer } from 'ws';
import { messages as msgLib, crypto as cryptoLib } from '@axip/sdk';
import * as registry from './registry.js';
import * as router from './router.js';
import * as taskManager from './taskManager.js';
import * as ledger from './ledger.js';
import * as logger from './logger.js';
import { getDb } from './db.js';

/**
 * Create and configure the WebSocket relay server.
 *
 * @param {Object} opts
 * @param {number} opts.port - WebSocket port (default 4200)
 * @param {string} opts.host - Bind address (default '127.0.0.1')
 * @param {Function} [opts.logger] - Ignored; kept for API compatibility
 */
export function createRelayServer({ port = 4200, host = '127.0.0.1' } = {}) {

  // Connected agents: Map<agentId, WebSocket>
  const clients = new Map();

  // SEC-6: verifyClient — log origin on all incoming connections (restrict later when public origins are known)
  function verifyClient({ origin, req }, cb) {
    logger.info('relay', 'Incoming WebSocket connection', { origin: origin || 'none', ip: req.socket.remoteAddress });
    cb(true); // Accept all origins for now
  }

  const wss = new WebSocketServer({ port, host, maxPayload: 1048576, verifyClient });

  // Per-agent rate limiting: Map<agentId, number[]> of message timestamps
  const rateLimitWindows = new Map();

  // Nonce tracking for replay protection: Map<nonce, seenAt (ms timestamp)>
  const seenNonces = new Map();
  const NONCE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  // Clean up expired nonces every 10 minutes
  setInterval(() => {
    const cutoff = Date.now() - NONCE_WINDOW_MS;
    for (const [nonce, seenAt] of seenNonces) {
      if (seenAt < cutoff) seenNonces.delete(nonce);
    }
  }, 10 * 60 * 1000);

  wss.on('connection', (ws) => {
    // Track the agent ID once they announce
    ws.agentId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        logger.warn('relay', 'Malformed JSON received');
        return;
      }

      // Heartbeats are keep-alive only — accept with minimal validation to support
      // agents that may be running older SDK versions without nonce/signature support.
      const isHeartbeat = msg.type === 'heartbeat';

      // Validate message structure (heartbeats get a relaxed check)
      const validation = msgLib.validateMessage(msg);
      if (!validation.valid) {
        if (isHeartbeat && validation.error === 'Missing nonce') {
          // Tolerate non-nonce heartbeats — just update registry and skip further checks
          if (ws.agentId) registry.handleHeartbeat(ws.agentId);
          return;
        }
        logger.warn('relay', 'Invalid message', { error: validation.error });
        return;
      }

      // Verify signatures on ALL message types (SEC-3) — heartbeats exempt
      if (!isHeartbeat && !msgLib.verifyMessage(msg)) {
        logger.warn('relay', 'Signature verification failed', { type: msg.type, from: msg.from.agent_id });
        ws.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed', ref_id: msg.id } }));
        return;
      }

      // Replay protection: check timestamp freshness (SEC-2) — heartbeats exempt
      if (!isHeartbeat) {
        const msgTime = new Date(msg.timestamp).getTime();
        if (isNaN(msgTime) || Date.now() - msgTime > TIMESTAMP_WINDOW_MS) {
          logger.warn('relay', 'Expired message', { from: msg.from.agent_id, timestamp: msg.timestamp });
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'EXPIRED_MESSAGE', message: 'Message timestamp is older than 5 minutes', ref_id: msg.id } }));
          return;
        }

        // Replay protection: check nonce uniqueness (SEC-2)
        if (seenNonces.has(msg.nonce)) {
          logger.warn('relay', 'Replay detected', { from: msg.from.agent_id, nonce: msg.nonce });
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'REPLAY_DETECTED', message: 'Duplicate nonce detected', ref_id: msg.id } }));
          return;
        }
        seenNonces.set(msg.nonce, Date.now());
      }

      // Per-agent rate limiting (skip heartbeats)
      if (msg.type !== 'heartbeat' && ws.agentId) {
        const now = Date.now();
        const window = 60_000; // 1 minute
        const limit = 100;
        let timestamps = rateLimitWindows.get(ws.agentId) || [];
        // Prune timestamps outside the sliding window
        timestamps = timestamps.filter(t => now - t < window);
        if (timestamps.length >= limit) {
          logger.warn('relay', 'Rate limit exceeded', { agentId: ws.agentId, count: timestamps.length });
          ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Rate limit exceeded: 100 messages/minute' }));
          return;
        }
        timestamps.push(now);
        rateLimitWindows.set(ws.agentId, timestamps);
      }

      // Input validation
      const validationError = _validatePayload(msg);
      if (validationError) {
        logger.warn('relay', 'Input validation failed', { error: validationError });
        ws.send(JSON.stringify({ type: 'error', code: 'INVALID_INPUT', message: validationError }));
        return;
      }

      // Dispatch by message type
      _handleMessage(ws, msg, clients);
    });

    ws.on('close', () => {
      if (ws.agentId) {
        registry.markOffline(ws.agentId);
        clients.delete(ws.agentId);
        rateLimitWindows.delete(ws.agentId);
        logger.info('relay', 'Agent disconnected', { agentId: ws.agentId });
      }
    });

    ws.on('error', (err) => {
      logger.error('relay', 'WebSocket error', { error: err.message });
    });
  });

  // ─── Public API for other modules ─────────────────────────────

  /**
   * Send a message to a specific agent by ID.
   */
  function sendTo(agentId, msg) {
    const ws = clients.get(agentId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(msg));
    } else {
      logger.warn('relay', 'Cannot send to agent — not connected', { agentId });
    }
  }

  /**
   * Broadcast a message to all connected agents except one.
   */
  function broadcast(msg, excludeAgentId = null) {
    for (const [agentId, ws] of clients) {
      if (agentId !== excludeAgentId && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    }
  }

  return { wss, clients, sendTo, broadcast };
}

// ─── Input Validation ───────────────────────────────────────────

const AGENT_ID_RE = /^[a-zA-Z0-9-]{3,64}$/;

/**
 * Validate message payload fields. Returns an error string or null if valid.
 */
function _validatePayload(msg) {
  const { type, from, payload } = msg;

  // Validate agent_id on all messages that have a from field
  if (from?.agent_id !== undefined) {
    if (typeof from.agent_id !== 'string' || !AGENT_ID_RE.test(from.agent_id)) {
      return 'agent_id must be 3-64 chars, alphanumeric and hyphens only';
    }
  }

  if (type === 'announce' && payload) {
    if (payload.description !== undefined && typeof payload.description === 'string' && payload.description.length > 10_000) {
      return 'description exceeds 10,000 character limit';
    }
    if (payload.capabilities !== undefined) {
      if (!Array.isArray(payload.capabilities)) return 'capabilities must be an array';
      if (payload.capabilities.length > 50) return 'capabilities array exceeds 50 items';
      for (const cap of payload.capabilities) {
        if (typeof cap !== 'string' || cap.length > 100) return 'each capability must be a string of max 100 chars';
      }
    }
    if (payload.pricing !== undefined && typeof payload.pricing === 'object') {
      for (const [key, val] of Object.entries(payload.pricing)) {
        if (typeof val === 'number') {
          if (val < 0) return `pricing.${key} must be a positive number`;
          if (val > 1000) return `pricing.${key} exceeds maximum of $1000`;
        }
      }
    }
  }

  if (type === 'task_request' && payload) {
    if (payload.reward !== undefined) {
      if (typeof payload.reward !== 'number' || payload.reward < 0) return 'reward must be a positive number';
      if (payload.reward > 1000) return 'reward exceeds maximum of $1000';
    }
  }

  if (type === 'task_verify' && payload) {
    if (payload.quality_score !== undefined) {
      if (typeof payload.quality_score !== 'number' || payload.quality_score < 0 || payload.quality_score > 1) {
        return 'quality_score must be a number between 0 and 1';
      }
    }
  }

  return null;
}

// ─── Message Dispatch ───────────────────────────────────────────

// Relay identity for building response messages
const RELAY_IDENTITY = {
  agentId: 'relay',
  pubkeyFormatted: 'ed25519:relay'
};

function _handleMessage(ws, msg, clients) {
  const sendTo = (agentId, responseMsg) => {
    const targetWs = clients.get(agentId);
    if (targetWs && targetWs.readyState === 1) {
      targetWs.send(JSON.stringify(responseMsg));
    }
  };

  switch (msg.type) {

    // ─── Agent Registration ─────────────────────────────────────
    case 'announce': {
      const result = registry.handleAnnounce(msg);
      ws.agentId = msg.from.agent_id;
      clients.set(msg.from.agent_id, ws);

      // Send acknowledge
      const ack = msgLib.buildMessage('announce_ack', RELAY_IDENTITY, msg.from.agent_id, {
        agent_id: result.agentId,
        balance: result.balance,
        reputation: result.reputation,
        registered: result.isNew ? 'new' : 'existing'
      });
      ws.send(JSON.stringify(ack));

      logger.info('relay', result.isNew ? 'Agent registered' : 'Agent reconnected', { agentId: result.agentId, balance: result.balance, reputation: result.reputation });
      break;
    }

    // ─── Discovery ──────────────────────────────────────────────
    case 'discover': {
      const agents = router.handleDiscover(msg);
      const result = msgLib.buildMessage('discover_result', RELAY_IDENTITY, msg.from.agent_id, {
        agents,
        request_id: msg.id  // For correlation with the requester's pending promise
      });
      ws.send(JSON.stringify(result));

      logger.info('relay', 'Discover', { capability: msg.payload.capability, matches: agents.length });
      break;
    }

    // ─── Task Request ───────────────────────────────────────────
    case 'task_request': {
      // If sent to 'relay' or 'network', route to capable agents
      // If sent to a specific agent, forward directly
      const targetAgentId = msg.to;

      if (targetAgentId === 'relay' || targetAgentId === 'network') {
        const { taskId } = taskManager.handleTaskRequest(msg, []);
        // Find capable agents and forward the request
        const capableAgents = router.findCapableAgents(msg.payload.capability_required, msg.from.agent_id);

        logger.info('relay', 'Task routing', { taskId, capability: msg.payload.capability_required, agents: capableAgents.length });

        // Add task_id to the payload if it wasn't there
        const enrichedPayload = { ...msg.payload, task_id: taskId };
        for (const agent of capableAgents) {
          const forward = msgLib.buildMessage('task_request', { agentId: msg.from.agent_id, pubkeyFormatted: msg.from.pubkey }, agent.agent_id, enrichedPayload);
          sendTo(agent.agent_id, forward);
        }
      } else {
        // Direct task request to a specific agent
        const { taskId } = taskManager.handleTaskRequest(msg, [targetAgentId]);
        const enrichedPayload = { ...msg.payload, task_id: taskId };
        const forward = msgLib.buildMessage('task_request', { agentId: msg.from.agent_id, pubkeyFormatted: msg.from.pubkey }, targetAgentId, enrichedPayload);
        sendTo(targetAgentId, forward);

        logger.info('relay', 'Task direct route', { taskId, to: targetAgentId });
      }
      break;
    }

    // ─── Task Bid ───────────────────────────────────────────────
    case 'task_bid': {
      const result = taskManager.handleTaskBid(msg);
      if (result) {
        // Forward bid to the task requester
        sendTo(result.requesterId, msg);
        logger.info('relay', 'Task bid received', { taskId: result.taskId, price: msg.payload.price_usd, from: msg.from.agent_id });
      }
      break;
    }

    // ─── Task Accept ────────────────────────────────────────────
    case 'task_accept': {
      taskManager.handleTaskAccept(msg).then(result => {
        if (!result) return;
        if (result.error === 'SPENDING_LIMIT_EXCEEDED') {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'SPENDING_LIMIT_EXCEEDED', message: 'Daily spending limit exceeded', task_id: result.taskId } }));
          logger.warn('relay', 'Task accept blocked by spending limit', { taskId: result.taskId });
          return;
        }
        // Forward acceptance to the assignee
        sendTo(result.assigneeId, msg);
        logger.info('relay', 'Task assigned', { taskId: result.taskId, assignee: result.assigneeId, price: result.price });
      }).catch(err => {
        logger.error('relay', 'task_accept handler error', { error: err.message });
      });
      break;
    }

    // ─── Task Result ────────────────────────────────────────────
    case 'task_result': {
      const result = taskManager.handleTaskResult(msg);
      if (result) {
        // Forward result to the requester
        sendTo(result.requesterId, msg);
        logger.info('relay', 'Task result delivered', { taskId: result.taskId });
      }
      break;
    }

    // ─── Task Verify ────────────────────────────────────────────
    case 'task_verify': {
      taskManager.handleTaskVerify(msg).then(result => {
        if (result && result.verified) {
          // Forward verification to the assignee
          sendTo(result.assigneeId, msg);

          // Send settle notification to both parties
          const settleMsg = msgLib.buildTaskSettle(RELAY_IDENTITY, result.requesterId, {
            taskId: result.taskId,
            amount: result.amount,
            fromBalance: result.settleResult.fromBalance,
            toBalance: result.settleResult.toBalance
          });
          sendTo(result.requesterId, settleMsg);
          sendTo(result.assigneeId, settleMsg);

          logger.info('relay', 'Task settled', { taskId: result.taskId, amount: result.amount });
          logger.info('relay', 'Reputation updated', { agentId: result.assigneeId, newReputation: result.repResult.newReputation });
        }
      }).catch(err => {
        logger.error('relay', 'task_verify handler error', { error: err.message });
      });
      break;
    }

    // ─── Balance Request ────────────────────────────────────────
    case 'balance_request': {
      const requesterId = msg.from.agent_id;
      ledger.getBalance(requesterId).then(balanceUsd => {
        const response = msgLib.buildMessage('balance_result', RELAY_IDENTITY, requesterId, {
          agent_id: requesterId,
          balance_usd: balanceUsd
        });
        if (ws.readyState === 1) ws.send(JSON.stringify(response));
        logger.info('relay', 'Balance request served', { agentId: requesterId, balance: balanceUsd });
      }).catch(err => {
        logger.error('relay', 'balance_request handler error', { error: err.message });
      });
      break;
    }

    // ─── Status Request ─────────────────────────────────────────
    case 'status_request': {
      try {
        const db = getDb();
        const allAgents = registry.getAllAgents();
        const onlineAgents = allAgents.filter(a => a.status === 'online');

        // Collect unique capabilities from online agents
        const capabilitySet = new Set();
        for (const agent of onlineAgents) {
          try {
            const caps = JSON.parse(agent.capabilities || '[]');
            caps.forEach(c => capabilitySet.add(c));
          } catch (_) {}
        }

        // Task stats from SQLite (synchronous)
        const taskStats = db.prepare(`
          SELECT
            COUNT(*) AS total_tasks,
            SUM(CASE WHEN state = 'SETTLED' THEN 1 ELSE 0 END) AS tasks_settled,
            SUM(CASE WHEN state = 'SETTLED' AND settled_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS tasks_today
          FROM tasks
        `).get();

        const volumeRow = db.prepare(
          "SELECT COALESCE(SUM(amount), 0) AS total_volume FROM ledger WHERE type = 'settlement'"
        ).get();

        const response = msgLib.buildMessage('status_result', RELAY_IDENTITY, msg.from.agent_id, {
          agents_online: onlineAgents.length,
          total_agents: allAgents.length,
          capabilities: Array.from(capabilitySet).sort(),
          tasks_today: taskStats?.tasks_today ?? 0,
          tasks_total: taskStats?.total_tasks ?? 0,
          tasks_settled: taskStats?.tasks_settled ?? 0,
          total_volume_usd: parseFloat((volumeRow?.total_volume ?? 0).toFixed(4))
        });
        if (ws.readyState === 1) ws.send(JSON.stringify(response));
        logger.info('relay', 'Status request served', { agentsOnline: onlineAgents.length });
      } catch (err) {
        logger.error('relay', 'status_request handler error', { error: err.message });
      }
      break;
    }

    // ─── Heartbeat ──────────────────────────────────────────────
    case 'heartbeat': {
      if (ws.agentId) {
        registry.handleHeartbeat(ws.agentId);
      }
      break;
    }

    default:
      logger.warn('relay', 'Unhandled message type', { type: msg.type });
  }
}
