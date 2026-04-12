/**
 * AXIP Relay — Task Lifecycle Manager
 *
 * Manages the full task state machine:
 *   REQUESTED → BIDDING → ACCEPTED → IN_PROGRESS → COMPLETED → VERIFIED → SETTLED
 *                                          ↓                         ↓
 *                                       FAILED                   DISPUTED
 *
 * Each handler validates the current state before transitioning.
 * No retry loops — if something fails, log it and move on.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getDb } from './db.js';
import * as reputation from './reputation.js';
import * as ledger from './ledger.js';
import * as logger from './logger.js';

// Event emitter for task lifecycle events (consumed by SSE endpoint)
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50); // Allow many SSE clients

// Server reference — set after server construction to avoid circular deps
let server = null;

// Timeout tracking for in-progress tasks
const taskTimeouts = new Map();

/**
 * Set the server reference for sending messages.
 * Called once from index.js after the server is created.
 */
export function setServer(serverRef) {
  server = serverRef;
}

// ─── State Transition ───────────────────────────────────────────

/**
 * Transition a task from one state to another.
 * Returns true if the transition succeeded, false if the task was not in the expected state.
 */
function transition(taskId, fromState, toState) {
  const db = getDb();
  const result = db.prepare(
    "UPDATE tasks SET state = ?, updated_at = datetime('now') WHERE task_id = ? AND state = ?"
  ).run(toState, taskId, fromState);

  if (result.changes === 0) {
    logger.warn('task', 'Failed state transition', { taskId, fromState, toState });
    return false;
  }

  logger.info('task', 'State transition', { taskId, fromState, toState });
  return true;
}

// ─── Message Handlers ───────────────────────────────────────────

/**
 * Handle a task_request: create the task and route it to capable agents.
 */
export function handleTaskRequest(msg, capableAgentIds) {
  const db = getDb();
  const taskId = msg.payload.task_id || `task_${randomUUID()}`;
  const requesterId = msg.from.agent_id;

  // Insert the task
  db.prepare(`
    INSERT INTO tasks (task_id, requester_id, description, capability_required, constraints, reward, state)
    VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED')
  `).run(
    taskId,
    requesterId,
    msg.payload.description || '',
    msg.payload.capability_required,
    JSON.stringify(msg.payload.constraints || {}),
    msg.payload.reward || 0
  );

  // Set a timeout for REQUESTED state (60 seconds to receive bids)
  const timeoutId = setTimeout(() => {
    const task = db.prepare('SELECT state FROM tasks WHERE task_id = ?').get(taskId);
    if (task && (task.state === 'REQUESTED' || task.state === 'BIDDING')) {
      transition(taskId, task.state, 'FAILED');
      logger.warn('task', 'Task timed out waiting for bids/acceptance', { taskId });
    }
    taskTimeouts.delete(taskId);
  }, 60_000);

  taskTimeouts.set(taskId, timeoutId);

  taskEvents.emit('activity', {
    event: 'task:requested',
    taskId,
    capability: msg.payload.capability_required,
    agentName: requesterId.replace(/-[a-zA-Z0-9]{8}$/, ''),
    reward: msg.payload.reward || 0,
    timestamp: new Date().toISOString()
  });

  return { taskId, requesterId };
}

/**
 * Handle a task_bid: record the bid, transition to BIDDING, forward to requester.
 */
export function handleTaskBid(msg) {
  const db = getDb();
  const { task_id: taskId, bid_id: bidId, price_usd: price, estimated_time_seconds: eta, confidence, model, message: bidMessage } = msg.payload;
  const bidderId = msg.from.agent_id;

  // Validate task exists and is in a biddable state
  const task = db.prepare('SELECT state, requester_id FROM tasks WHERE task_id = ?').get(taskId);
  if (!task) {
    logger.warn('task', 'Bid on unknown task', { taskId });
    return null;
  }
  if (task.state !== 'REQUESTED' && task.state !== 'BIDDING') {
    logger.warn('task', 'Bid rejected — task in wrong state', { taskId, state: task.state });
    return null;
  }

  // Insert the bid
  const actualBidId = bidId || `bid_${randomUUID()}`;
  db.prepare(`
    INSERT INTO bids (bid_id, task_id, bidder_id, price_usd, estimated_time_seconds, confidence, model, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(actualBidId, taskId, bidderId, price || 0, eta || 30, confidence || 0.5, model || 'local', bidMessage || '');

  // Transition to BIDDING if still in REQUESTED
  if (task.state === 'REQUESTED') {
    transition(taskId, 'REQUESTED', 'BIDDING');
  }

  taskEvents.emit('activity', {
    event: 'task:bid',
    taskId,
    capability: db.prepare('SELECT capability_required FROM tasks WHERE task_id = ?').get(taskId)?.capability_required,
    agentName: bidderId.replace(/-[a-zA-Z0-9]{8}$/, ''),
    price: price || 0,
    confidence: confidence || 0.5,
    timestamp: new Date().toISOString()
  });

  return { taskId, bidId: actualBidId, requesterId: task.requester_id };
}

/**
 * Handle a task_accept: assign the task, transition to IN_PROGRESS.
 */
export async function handleTaskAccept(msg) {
  const db = getDb();
  const { task_id: taskId, bid_id: bidId } = msg.payload;
  const accepterId = msg.from.agent_id;

  // Validate
  const task = db.prepare('SELECT state, requester_id FROM tasks WHERE task_id = ?').get(taskId);
  if (!task || task.requester_id !== accepterId) {
    logger.warn('task', 'Accept rejected — not the requester or task not found', { taskId });
    return null;
  }
  if (task.state !== 'BIDDING' && task.state !== 'REQUESTED') {
    logger.warn('task', 'Accept rejected — task in wrong state', { taskId, state: task.state });
    return null;
  }

  // Find the bid
  const bid = db.prepare('SELECT bidder_id, price_usd FROM bids WHERE bid_id = ?').get(bidId);
  if (!bid) {
    logger.warn('task', 'Accept rejected — bid not found', { bidId });
    return null;
  }

  // Check spending limit (PAY-8) — reject early before work starts
  try {
    const { isPgAvailable, checkSpendingLimit } = await import('./pg-ledger.js');
    if (isPgAvailable()) {
      const limitCheck = await checkSpendingLimit(accepterId);
      if (limitCheck.exceeded) {
        logger.warn('task', 'Accept rejected — spending limit exceeded', {
          taskId, agentId: accepterId, spent24h: limitCheck.spent24h, limit: limitCheck.limit
        });
        return { error: 'SPENDING_LIMIT_EXCEEDED', taskId };
      }
    }
  } catch (err) {
    logger.warn('task', 'Spending limit check failed (non-blocking)', { error: err.message });
  }

  // PAY-9: Escrow funds at accept time — ensures requester has balance before work begins
  if (bid.price_usd > 0) {
    const escrowResult = await ledger.escrowTask(taskId, accepterId, bid.price_usd);
    if (!escrowResult.success) {
      logger.warn('task', 'Accept rejected — escrow failed', {
        taskId, agentId: accepterId, error: escrowResult.error
      });
      return { error: escrowResult.error || 'ESCROW_FAILED', taskId };
    }
    logger.info('task', 'Escrow held', { taskId, agentId: accepterId, amount: bid.price_usd });
  }

  // Mark bid as accepted
  db.prepare('UPDATE bids SET accepted = 1 WHERE bid_id = ?').run(bidId);

  // Set assignee
  db.prepare('UPDATE tasks SET assignee_id = ?, reward = ? WHERE task_id = ?')
    .run(bid.bidder_id, bid.price_usd, taskId);

  // Transition: BIDDING → ACCEPTED → IN_PROGRESS
  transition(taskId, task.state, 'ACCEPTED');
  transition(taskId, 'ACCEPTED', 'IN_PROGRESS');

  // Clear the old timeout and set a new one for IN_PROGRESS (5 min)
  if (taskTimeouts.has(taskId)) {
    clearTimeout(taskTimeouts.get(taskId));
  }

  const timeoutId = setTimeout(async () => {
    const currentTask = db.prepare('SELECT state, requester_id, reward FROM tasks WHERE task_id = ?').get(taskId);
    if (currentTask && currentTask.state === 'IN_PROGRESS') {
      transition(taskId, 'IN_PROGRESS', 'FAILED');
      logger.warn('task', 'Task timed out during execution', { taskId });
      // PAY-9: Refund escrowed credits to requester
      if (currentTask.reward > 0) {
        const refund = await ledger.refundTask(taskId, currentTask.requester_id, currentTask.reward);
        if (refund.refunded) {
          logger.info('task', 'Timeout refund issued', { taskId, agentId: currentTask.requester_id, amount: currentTask.reward });
        }
      }
    }
    taskTimeouts.delete(taskId);
  }, 300_000); // 5 minutes

  taskTimeouts.set(taskId, timeoutId);

  taskEvents.emit('activity', {
    event: 'task:accepted',
    taskId,
    capability: db.prepare('SELECT capability_required FROM tasks WHERE task_id = ?').get(taskId)?.capability_required,
    agentName: bid.bidder_id.replace(/-[a-zA-Z0-9]{8}$/, ''),
    price: bid.price_usd,
    timestamp: new Date().toISOString()
  });

  return { taskId, assigneeId: bid.bidder_id, price: bid.price_usd };
}

/**
 * Handle a task_result: store the result, transition to COMPLETED.
 */
export function handleTaskResult(msg) {
  const db = getDb();
  const { task_id: taskId, output, status } = msg.payload;
  const senderId = msg.from.agent_id;

  // Validate
  const task = db.prepare('SELECT state, requester_id, assignee_id FROM tasks WHERE task_id = ?').get(taskId);
  if (!task) {
    logger.warn('task', 'Result for unknown task', { taskId });
    return null;
  }
  if (task.assignee_id !== senderId) {
    logger.warn('task', 'Result rejected — sender is not assignee', { taskId, sender: senderId, assignee: task.assignee_id });
    return null;
  }
  if (task.state !== 'IN_PROGRESS') {
    logger.warn('task', 'Result rejected — task in wrong state', { taskId, state: task.state });
    return null;
  }

  // Store result
  db.prepare('UPDATE tasks SET result = ? WHERE task_id = ?')
    .run(JSON.stringify(output), taskId);

  // Transition to COMPLETED
  transition(taskId, 'IN_PROGRESS', 'COMPLETED');

  // Clear timeout
  if (taskTimeouts.has(taskId)) {
    clearTimeout(taskTimeouts.get(taskId));
    taskTimeouts.delete(taskId);
  }

  taskEvents.emit('activity', {
    event: 'task:completed',
    taskId,
    capability: db.prepare('SELECT capability_required FROM tasks WHERE task_id = ?').get(taskId)?.capability_required,
    agentName: senderId.replace(/-[a-zA-Z0-9]{8}$/, ''),
    timestamp: new Date().toISOString()
  });

  return { taskId, requesterId: task.requester_id };
}

/**
 * Handle a task_verify: update reputation, settle payment, complete lifecycle.
 * Returns a Promise to support async PostgreSQL settlement.
 */
export async function handleTaskVerify(msg) {
  const db = getDb();
  const { task_id: taskId, verified, quality_score: qualityScore } = msg.payload;
  const verifierId = msg.from.agent_id;

  // Validate
  const task = db.prepare('SELECT state, requester_id, assignee_id, reward, capability_required FROM tasks WHERE task_id = ?').get(taskId);
  if (!task) {
    logger.warn('task', 'Verify for unknown task', { taskId });
    return null;
  }
  if (task.requester_id !== verifierId) {
    logger.warn('task', 'Verify rejected — not the requester', { taskId, verifier: verifierId });
    return null;
  }
  if (task.state !== 'COMPLETED') {
    logger.warn('task', 'Verify rejected — task in wrong state', { taskId, state: task.state });
    return null;
  }

  // Store quality score
  db.prepare('UPDATE tasks SET quality_score = ? WHERE task_id = ?')
    .run(qualityScore || 0.5, taskId);

  if (verified) {
    // Transition to VERIFIED
    transition(taskId, 'COMPLETED', 'VERIFIED');

    // Record reputation event
    const repResult = reputation.recordEvent(task.assignee_id, taskId, {
      timeScore: 1.0,       // On time (simplified for demo)
      qualityScore: qualityScore || 0.5,
      formatScore: 1.0,     // Valid JSON (simplified for demo)
      reliabilityScore: 1.0 // Completed successfully
    });

    // PAY-9: Release escrowed funds to provider (requester was debited at accept time)
    const amount = task.reward || 0;
    let settleResult = { success: true, fromBalance: 0, toBalance: 0 };

    if (amount > 0) {
      settleResult = await ledger.releaseEscrow(taskId, task.requester_id, task.assignee_id, amount);

      if (!settleResult.success) {
        logger.error('task', 'Settlement (release escrow) failed', { taskId, error: settleResult.error });
        // Fallback: try legacy settle() for tasks accepted before PAY-9 was deployed
        settleResult = await ledger.settle(taskId, task.requester_id, task.assignee_id, amount);
        if (!settleResult.success) {
          logger.error('task', 'Settlement fallback also failed', { taskId, error: settleResult.error });
        }
      }
    }

    // Transition to SETTLED
    transition(taskId, 'VERIFIED', 'SETTLED');
    db.prepare("UPDATE tasks SET settled_at = datetime('now') WHERE task_id = ?").run(taskId);

    taskEvents.emit('activity', {
      event: 'task:settled',
      taskId,
      capability: task.capability_required,
      agentName: task.assignee_id.replace(/-[a-zA-Z0-9]{8}$/, ''),
      amount,
      timestamp: new Date().toISOString()
    });

    return {
      taskId,
      assigneeId: task.assignee_id,
      requesterId: task.requester_id,
      amount,
      settleResult,
      repResult,
      verified: true
    };
  } else {
    // Disputed — PAY-9: refund escrowed credits to requester
    transition(taskId, 'COMPLETED', 'DISPUTED');
    const amount = task.reward || 0;
    if (amount > 0) {
      const refund = await ledger.refundTask(taskId, task.requester_id, amount);
      if (refund.refunded) {
        logger.info('task', 'Dispute refund issued', { taskId, agentId: task.requester_id, amount });
      }
    }
    return { taskId, verified: false };
  }
}

// ─── Queries ────────────────────────────────────────────────────

/**
 * Get a task by ID.
 */
export function getTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
}

/**
 * Get all tasks (for dashboard).
 */
export function getAllTasks() {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
}

/**
 * Handle agent disconnect: cancel any tasks this agent was requesting.
 *
 * When a requester disconnects while a task is in REQUESTED, BIDDING, or
 * IN_PROGRESS state, we mark the task FAILED and notify any assigned provider
 * (so the provider can clear it from their local activeTasks Map).
 *
 * @param {string} agentId - The agent that disconnected
 */
export function handleRequesterDisconnect(agentId) {
  if (!agentId) return;
  const db = getDb();

  // Find active tasks where this agent is the requester
  const activeTasks = db.prepare(`
    SELECT task_id, state, assignee_id
    FROM tasks
    WHERE requester_id = ? AND state IN ('REQUESTED', 'BIDDING', 'IN_PROGRESS')
  `).all(agentId);

  if (activeTasks.length === 0) return;

  logger.info('task', `Requester disconnected — cancelling ${activeTasks.length} active task(s)`, { agentId });

  for (const task of activeTasks) {
    // Transition to FAILED
    const success = transition(task.task_id, task.state, 'FAILED');
    if (!success) continue;

    // Cancel any pending bid-acceptance timeout
    const timeoutId = taskTimeouts.get(task.task_id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      taskTimeouts.delete(task.task_id);
    }

    // Notify the assigned provider (if any) so they can clear the task locally
    if (task.assignee_id && server) {
      const cancelMsg = {
        type: 'task_cancel',
        id: `cancel_${task.task_id}`,
        from: { agent_id: 'relay', name: 'AXIP Relay' },
        to: task.assignee_id,
        payload: {
          task_id: task.task_id,
          reason: 'requester_disconnected'
        },
        timestamp: new Date().toISOString()
      };
      try {
        server.sendTo(task.assignee_id, cancelMsg);
        logger.info('task', 'Sent task_cancel to provider on requester disconnect', {
          taskId: task.task_id,
          provider: task.assignee_id
        });
      } catch (err) {
        logger.warn('task', 'Could not notify provider of cancellation', {
          taskId: task.task_id,
          provider: task.assignee_id,
          error: err.message
        });
      }
    }
  }
}

/**
 * Clean up all timeouts. Call on shutdown.
 */
export function cleanup() {
  for (const [, timeoutId] of taskTimeouts) {
    clearTimeout(timeoutId);
  }
  taskTimeouts.clear();
}
