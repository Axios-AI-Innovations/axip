/**
 * AXIP Relay — Credit Ledger
 *
 * Manages agent credit balances and task settlement.
 * Primary: PostgreSQL (axip_marketplace schema) with 5% platform fee.
 * Fallback: SQLite (existing schema, no platform fee).
 *
 * Balance cannot go negative — enforced at the database level.
 * All settlements are atomic.
 */

import { getDb } from './db.js';
import * as pgLedger from './pg-ledger.js';
import * as logger from './logger.js';

// pg-ledger is initialized lazily (called from index.js or on first use)
let pgInitialized = false;

/**
 * Ensure pg-ledger has been initialized.
 */
async function ensurePg() {
  if (!pgInitialized) {
    pgInitialized = true;
    await pgLedger.initPgLedger();
  }
}

/**
 * Settle a completed task — transfer credits from requester to provider.
 *
 * Uses PostgreSQL if available (with 5% platform fee), falls back to SQLite.
 *
 * @param {string} taskId - The completed task
 * @param {string} fromAgentId - Requester (debited)
 * @param {string} toAgentId - Provider (credited)
 * @param {number} amount - Amount in USD credits
 * @returns {Promise<{ success: boolean, fromBalance?: number, toBalance?: number, platformFee?: number, error?: string }>}
 */
export async function settle(taskId, fromAgentId, toAgentId, amount) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    // Ensure accounts exist in PostgreSQL
    await pgLedger.initAccount(fromAgentId);
    await pgLedger.initAccount(toAgentId);

    const result = await pgLedger.settle(taskId, fromAgentId, toAgentId, amount);
    if (!result.success) {
      logger.error('ledger', 'PostgreSQL settlement failed', { taskId, error: result.error });
    }
    return result;
  }

  // SQLite fallback
  return settleSQLite(taskId, fromAgentId, toAgentId, amount);
}

/**
 * SQLite fallback settlement (no platform fee, original behavior).
 */
function settleSQLite(taskId, fromAgentId, toAgentId, amount) {
  const db = getDb();

  const settleTransaction = db.transaction(() => {
    const debit = db.prepare(
      'UPDATE agents SET balance = balance - ? WHERE agent_id = ? AND balance >= ?'
    ).run(amount, fromAgentId, amount);

    if (debit.changes === 0) {
      throw new Error('insufficient_balance');
    }

    db.prepare('UPDATE agents SET balance = balance + ? WHERE agent_id = ?')
      .run(amount, toAgentId);

    db.prepare(`
      INSERT INTO ledger (task_id, from_agent, to_agent, amount, type)
      VALUES (?, ?, ?, ?, 'settlement')
    `).run(taskId, fromAgentId, toAgentId, amount);
  });

  try {
    settleTransaction();

    const fromAgent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(fromAgentId);
    const toAgent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(toAgentId);

    return {
      success: true,
      fromBalance: fromAgent?.balance ?? 0,
      toBalance: toAgent?.balance ?? 0
    };
  } catch (err) {
    if (err.message === 'insufficient_balance') {
      return { success: false, error: 'Insufficient balance' };
    }
    logger.error('ledger', 'SQLite settlement failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Get an agent's current balance.
 * Returns PostgreSQL balance if available, else SQLite.
 */
export async function getBalance(agentId) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    const account = await pgLedger.getBalance(agentId);
    return account?.balance_usd ?? 0;
  }

  const db = getDb();
  const agent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(agentId);
  return agent?.balance ?? 0;
}

/**
 * Escrow credits from requester at task accept time.
 * Debits balance immediately; records as 'escrow' in the ledger.
 * Returns { success: false, error: 'insufficient_balance' } if funds are short.
 *
 * @param {string} taskId
 * @param {string} fromAgentId - Requester (debited)
 * @param {number} amount
 */
export async function escrowTask(taskId, fromAgentId, amount) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    await pgLedger.initAccount(fromAgentId);
    return pgLedger.escrowForTask(taskId, fromAgentId, amount);
  }

  return escrowSQLite(taskId, fromAgentId, amount);
}

function escrowSQLite(taskId, fromAgentId, amount) {
  const db = getDb();
  try {
    const result = db.prepare(
      'UPDATE agents SET balance = balance - ? WHERE agent_id = ? AND balance >= ?'
    ).run(amount, fromAgentId, amount);

    if (result.changes === 0) {
      return { success: false, error: 'insufficient_balance' };
    }

    db.prepare(`
      INSERT INTO ledger (task_id, from_agent, to_agent, amount, type)
      VALUES (?, ?, 'axip-escrow', ?, 'escrow')
    `).run(taskId, fromAgentId, amount);

    const agent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(fromAgentId);
    return { success: true, balance: agent?.balance ?? 0 };
  } catch (err) {
    logger.error('ledger', 'SQLite escrow failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Release escrowed funds to provider on successful task verification.
 * Credits provider (and platform fee in PostgreSQL path).
 * Requester was already debited at escrow time.
 *
 * @param {string} taskId
 * @param {string} fromAgentId - Requester (already debited)
 * @param {string} toAgentId - Provider (credited)
 * @param {number} amount
 */
export async function releaseEscrow(taskId, fromAgentId, toAgentId, amount) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    return pgLedger.releaseEscrow(taskId, fromAgentId, toAgentId, amount);
  }

  return releaseEscrowSQLite(taskId, fromAgentId, toAgentId, amount);
}

function releaseEscrowSQLite(taskId, fromAgentId, toAgentId, amount) {
  const db = getDb();
  try {
    // Credit provider (requester was already debited at escrow time)
    db.prepare('UPDATE agents SET balance = balance + ? WHERE agent_id = ?')
      .run(amount, toAgentId);

    // Update escrow record → settlement
    db.prepare(`
      UPDATE ledger SET type = 'settlement', to_agent = ?
      WHERE task_id = ? AND type = 'escrow'
    `).run(toAgentId, taskId);

    const fromAgent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(fromAgentId);
    const toAgent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(toAgentId);
    return {
      success: true,
      fromBalance: fromAgent?.balance ?? 0,
      toBalance: toAgent?.balance ?? 0
    };
  } catch (err) {
    logger.error('ledger', 'SQLite release escrow failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Refund escrowed credits to requester on task failure or dispute.
 * No-ops gracefully if no escrow record exists (task failed before accept).
 *
 * @param {string} taskId
 * @param {string} agentId - Requester to refund
 * @param {number} amount
 */
export async function refundTask(taskId, agentId, amount) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    return pgLedger.refundEscrow(taskId, agentId, amount);
  }

  return refundSQLite(taskId, agentId, amount);
}

function refundSQLite(taskId, agentId, amount) {
  const db = getDb();
  try {
    const escrow = db.prepare("SELECT id FROM ledger WHERE task_id = ? AND type = 'escrow'").get(taskId);
    if (!escrow) {
      return { success: true, refunded: false, reason: 'no_escrow' };
    }

    db.prepare('UPDATE agents SET balance = balance + ? WHERE agent_id = ?')
      .run(amount, agentId);

    db.prepare("UPDATE ledger SET type = 'refund' WHERE task_id = ? AND type = 'escrow'")
      .run(taskId);

    const agent = db.prepare('SELECT balance FROM agents WHERE agent_id = ?').get(agentId);
    return { success: true, refunded: true, balance: agent?.balance ?? 0 };
  } catch (err) {
    logger.error('ledger', 'SQLite refund failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Get ledger history for an agent.
 * Returns PostgreSQL transactions if available, else SQLite ledger.
 */
export async function getLedgerHistory(agentId = null) {
  await ensurePg();

  if (pgLedger.isPgAvailable()) {
    return pgLedger.getTransactionHistory(agentId || 'axip-platform', 100);
  }

  const db = getDb();
  if (agentId) {
    return db.prepare(
      'SELECT * FROM ledger WHERE from_agent = ? OR to_agent = ? ORDER BY timestamp DESC'
    ).all(agentId, agentId);
  }
  return db.prepare('SELECT * FROM ledger ORDER BY timestamp DESC').all();
}
