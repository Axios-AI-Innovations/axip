/**
 * AXIP Relay — PostgreSQL Credit Ledger
 *
 * Manages agent credit accounts in the axip_marketplace PostgreSQL schema.
 * All settlements are atomic (BEGIN/COMMIT) with a 5% platform fee.
 *
 * Platform account: "axip-platform"
 * Fee: 5% of gross amount
 */

import pg from 'pg';
import * as logger from './logger.js';

const PLATFORM_AGENT_ID = 'axip-platform';
const PLATFORM_FEE_RATE = 0.05;
const PG_CONNECTION_STRING = process.env.BRAIN_DATABASE_URL || 'postgresql://localhost:5432/hive_brain';

// PAY-7: Deposit bonus tiers
// $200+ → 10% bonus, $50+ → 5% bonus, under $50 → no bonus
const DEPOSIT_BONUS_TIERS = [
  { threshold: 200, rate: 0.10 },
  { threshold: 50,  rate: 0.05 },
];

let pool = null;
let pgAvailable = false;

/**
 * Initialize the PostgreSQL connection pool and ensure platform account exists.
 * @returns {Promise<boolean>} true if PostgreSQL is available
 */
export async function initPgLedger() {
  try {
    pool = new pg.Pool({
      connectionString: PG_CONNECTION_STRING,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    // Test connection
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      pgAvailable = true;
      logger.info('pg-ledger', 'PostgreSQL credit ledger connected');
    } finally {
      client.release();
    }

    pool.on('error', (err) => {
      logger.error('pg-ledger', 'Pool error', { error: err.message });
      pgAvailable = false;
    });

    // Ensure platform account exists
    await initAccount(PLATFORM_AGENT_ID, 0);
    return true;
  } catch (err) {
    logger.warn('pg-ledger', 'PostgreSQL unavailable — credit system degraded', { error: err.message });
    pgAvailable = false;
    return false;
  }
}

/**
 * Check if PostgreSQL ledger is available.
 */
export function isPgAvailable() {
  return pgAvailable;
}

/**
 * Get the connection pool (throws if unavailable).
 */
function getPool() {
  if (!pool || !pgAvailable) {
    throw new Error('pg-ledger not available');
  }
  return pool;
}

/**
 * Initialize an agent account if it doesn't exist.
 * New agents get $1.00 in free credits.
 *
 * @param {string} agentId
 * @param {number} [initialBalance=1.0] - Override default starting balance
 */
export async function initAccount(agentId, initialBalance = 1.0) {
  const p = getPool();
  await p.query(`
    INSERT INTO axip_marketplace.accounts (agent_id, balance_usd, total_deposited)
    VALUES ($1, $2, $2)
    ON CONFLICT (agent_id) DO NOTHING
  `, [agentId, initialBalance]);
}

/**
 * Get an agent's current balance and totals.
 *
 * @param {string} agentId
 * @returns {Promise<{ balance_usd: number, total_deposited: number, total_earned: number, total_spent: number, spending_limit_usd: number|null } | null>}
 */
export async function getBalance(agentId) {
  const p = getPool();
  const result = await p.query(
    'SELECT balance_usd, total_deposited, total_earned, total_spent, spending_limit_usd FROM axip_marketplace.accounts WHERE agent_id = $1',
    [agentId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    balance_usd: parseFloat(row.balance_usd),
    total_deposited: parseFloat(row.total_deposited),
    total_earned: parseFloat(row.total_earned),
    total_spent: parseFloat(row.total_spent),
    spending_limit_usd: row.spending_limit_usd != null ? parseFloat(row.spending_limit_usd) : null
  };
}

/**
 * Check if agent has exceeded their spending limit in the last 24 hours.
 *
 * @param {string} agentId
 * @returns {Promise<{ exceeded: boolean, spent24h: number, limit: number|null }>}
 */
export async function checkSpendingLimit(agentId) {
  const p = getPool();

  const account = await p.query(
    'SELECT spending_limit_usd FROM axip_marketplace.accounts WHERE agent_id = $1',
    [agentId]
  );

  if (account.rows.length === 0 || account.rows[0].spending_limit_usd == null) {
    return { exceeded: false, spent24h: 0, limit: null };
  }

  const limit = parseFloat(account.rows[0].spending_limit_usd);

  const spent = await p.query(`
    SELECT COALESCE(SUM(gross_amount), 0) as total
    FROM axip_marketplace.transactions
    WHERE from_agent = $1
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND status = 'completed'
  `, [agentId]);

  const spent24h = parseFloat(spent.rows[0].total);

  return {
    exceeded: spent24h >= limit,
    spent24h,
    limit
  };
}

/**
 * Atomically settle a completed task.
 *
 * Flow:
 *   BEGIN
 *   1. Debit gross_amount from requester
 *   2. Credit net_amount (gross - 5% fee) to provider
 *   3. Credit platform_fee to axip-platform
 *   4. Update account totals
 *   5. Insert transaction record
 *   COMMIT
 *
 * @param {string} taskId
 * @param {string} fromAgentId - Requester (debited)
 * @param {string} toAgentId - Provider (credited)
 * @param {number} grossAmount - Amount in USD
 * @returns {Promise<{ success: boolean, fromBalance?: number, toBalance?: number, platformFee?: number, netAmount?: number, error?: string }>}
 */
export async function settle(taskId, fromAgentId, toAgentId, grossAmount) {
  const p = getPool();

  const platformFee = Math.round(grossAmount * PLATFORM_FEE_RATE * 1_000_000) / 1_000_000;
  const netAmount = Math.round((grossAmount - platformFee) * 1_000_000) / 1_000_000;

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Ensure accounts exist (auto-init any unregistered agents)
    await client.query(`
      INSERT INTO axip_marketplace.accounts (agent_id)
      VALUES ($1), ($2), ($3)
      ON CONFLICT (agent_id) DO NOTHING
    `, [fromAgentId, toAgentId, PLATFORM_AGENT_ID]);

    // Check spending limit before debiting
    const limitCheck = await client.query(`
      SELECT spending_limit_usd FROM axip_marketplace.accounts WHERE agent_id = $1
    `, [fromAgentId]);

    if (limitCheck.rows.length > 0 && limitCheck.rows[0].spending_limit_usd != null) {
      const limit = parseFloat(limitCheck.rows[0].spending_limit_usd);
      const spent24h = await client.query(`
        SELECT COALESCE(SUM(gross_amount), 0) as total
        FROM axip_marketplace.transactions
        WHERE from_agent = $1
          AND created_at >= NOW() - INTERVAL '24 hours'
          AND status = 'completed'
      `, [fromAgentId]);
      const alreadySpent = parseFloat(spent24h.rows[0].total);
      if (alreadySpent + grossAmount > limit) {
        await client.query('ROLLBACK');
        return { success: false, error: 'SPENDING_LIMIT_EXCEEDED' };
      }
    }

    // Debit requester (only if balance sufficient)
    const debit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd - $1,
          total_spent = total_spent + $1,
          updated_at = NOW()
      WHERE agent_id = $2 AND balance_usd >= $1
      RETURNING balance_usd
    `, [grossAmount, fromAgentId]);

    if (debit.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'insufficient_balance' };
    }

    const fromBalance = parseFloat(debit.rows[0].balance_usd);

    // Credit provider (net amount)
    const credit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd + $1,
          total_earned = total_earned + $1,
          updated_at = NOW()
      WHERE agent_id = $2
      RETURNING balance_usd
    `, [netAmount, toAgentId]);

    const toBalance = parseFloat(credit.rows[0].balance_usd);

    // Credit platform fee
    await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd + $1,
          total_earned = total_earned + $1,
          updated_at = NOW()
      WHERE agent_id = $2
    `, [platformFee, PLATFORM_AGENT_ID]);

    // Record transaction
    await client.query(`
      INSERT INTO axip_marketplace.transactions
        (task_id, from_agent, to_agent, gross_amount, platform_fee, net_amount, type, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'settlement', 'completed')
    `, [taskId, fromAgentId, toAgentId, grossAmount, platformFee, netAmount]);

    await client.query('COMMIT');

    logger.info('pg-ledger', 'Settlement completed', {
      taskId, fromAgentId, toAgentId, grossAmount, platformFee, netAmount
    });

    return { success: true, fromBalance, toBalance, platformFee, netAmount };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('pg-ledger', 'Settlement failed', { taskId, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Get transaction history for an agent.
 *
 * @param {string} agentId
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getTransactionHistory(agentId, limit = 50) {
  const p = getPool();
  const result = await p.query(`
    SELECT id, task_id, from_agent, to_agent, gross_amount, platform_fee, net_amount,
           type, status, metadata, created_at
    FROM axip_marketplace.transactions
    WHERE from_agent = $1 OR to_agent = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [agentId, limit]);

  return result.rows.map(row => ({
    ...row,
    gross_amount: parseFloat(row.gross_amount),
    platform_fee: parseFloat(row.platform_fee),
    net_amount: parseFloat(row.net_amount)
  }));
}

/**
 * Get platform earnings summary.
 * @returns {Promise<{ balance_usd: number, total_earned: number, recent_transactions: Array }>}
 */
export async function getPlatformEarnings() {
  const p = getPool();

  const account = await p.query(
    'SELECT balance_usd, total_earned FROM axip_marketplace.accounts WHERE agent_id = $1',
    [PLATFORM_AGENT_ID]
  );

  const recent = await p.query(`
    SELECT id, task_id, from_agent, to_agent, platform_fee, created_at
    FROM axip_marketplace.transactions
    WHERE status = 'completed'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const row = account.rows[0] || { balance_usd: 0, total_earned: 0 };
  return {
    balance_usd: parseFloat(row.balance_usd),
    total_earned: parseFloat(row.total_earned),
    recent_transactions: recent.rows.map(r => ({
      ...r,
      platform_fee: parseFloat(r.platform_fee)
    }))
  };
}

/**
 * Set a spending limit for an agent.
 *
 * @param {string} agentId
 * @param {number|null} limitUsd - null to remove limit
 */
export async function setSpendingLimit(agentId, limitUsd) {
  const p = getPool();
  await p.query(`
    UPDATE axip_marketplace.accounts
    SET spending_limit_usd = $1, updated_at = NOW()
    WHERE agent_id = $2
  `, [limitUsd, agentId]);
}

/**
 * Escrow funds from requester when they accept a bid.
 * Debits balance immediately; records an 'escrow' transaction (status = 'held').
 * Returns success: false with error 'insufficient_balance' if funds are short.
 *
 * @param {string} taskId
 * @param {string} fromAgentId - Requester (debited)
 * @param {number} amount - Amount in USD
 * @returns {Promise<{ success: boolean, balance?: number, error?: string }>}
 */
export async function escrowForTask(taskId, fromAgentId, amount) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Ensure account exists
    await client.query(`
      INSERT INTO axip_marketplace.accounts (agent_id) VALUES ($1) ON CONFLICT (agent_id) DO NOTHING
    `, [fromAgentId]);

    // Debit requester (only if balance sufficient)
    const debit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd - $1,
          total_spent = total_spent + $1,
          updated_at = NOW()
      WHERE agent_id = $2 AND balance_usd >= $1
      RETURNING balance_usd
    `, [amount, fromAgentId]);

    if (debit.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'insufficient_balance' };
    }

    // Record escrow transaction
    await client.query(`
      INSERT INTO axip_marketplace.transactions
        (task_id, from_agent, to_agent, gross_amount, platform_fee, net_amount, type, status)
      VALUES ($1, $2, 'axip-escrow', $3, 0, $3, 'escrow', 'held')
    `, [taskId, fromAgentId, amount]);

    await client.query('COMMIT');
    logger.info('pg-ledger', 'Escrow held', { taskId, fromAgentId, amount });
    return { success: true, balance: parseFloat(debit.rows[0].balance_usd) };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('pg-ledger', 'Escrow failed', { taskId, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Release escrow to provider on successful task verification.
 * Credits net_amount to provider and platform_fee to axip-platform.
 * Updates the escrow transaction record to completed settlement.
 * (Requester was already debited at escrow time — no debit here.)
 *
 * @param {string} taskId
 * @param {string} fromAgentId - Requester (already debited)
 * @param {string} toAgentId - Provider (credited)
 * @param {number} grossAmount
 * @returns {Promise<{ success: boolean, fromBalance?: number, toBalance?: number, platformFee?: number, netAmount?: number, error?: string }>}
 */
export async function releaseEscrow(taskId, fromAgentId, toAgentId, grossAmount) {
  const p = getPool();
  const platformFee = Math.round(grossAmount * PLATFORM_FEE_RATE * 1_000_000) / 1_000_000;
  const netAmount = Math.round((grossAmount - platformFee) * 1_000_000) / 1_000_000;

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Ensure provider + platform accounts exist
    await client.query(`
      INSERT INTO axip_marketplace.accounts (agent_id)
      VALUES ($1), ($2)
      ON CONFLICT (agent_id) DO NOTHING
    `, [toAgentId, PLATFORM_AGENT_ID]);

    // Credit provider (net amount)
    const credit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd + $1,
          total_earned = total_earned + $1,
          updated_at = NOW()
      WHERE agent_id = $2
      RETURNING balance_usd
    `, [netAmount, toAgentId]);

    const toBalance = credit.rows[0] ? parseFloat(credit.rows[0].balance_usd) : 0;

    // Credit platform fee
    await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd + $1,
          total_earned = total_earned + $1,
          updated_at = NOW()
      WHERE agent_id = $2
    `, [platformFee, PLATFORM_AGENT_ID]);

    // Promote escrow transaction → completed settlement
    await client.query(`
      UPDATE axip_marketplace.transactions
      SET status = 'completed',
          type = 'settlement',
          to_agent = $1,
          platform_fee = $2,
          net_amount = $3
      WHERE task_id = $4 AND type = 'escrow' AND status = 'held'
    `, [toAgentId, platformFee, netAmount, taskId]);

    const fromAccount = await client.query(
      'SELECT balance_usd FROM axip_marketplace.accounts WHERE agent_id = $1',
      [fromAgentId]
    );

    await client.query('COMMIT');

    logger.info('pg-ledger', 'Escrow released to provider', {
      taskId, toAgentId, grossAmount, platformFee, netAmount
    });

    return {
      success: true,
      fromBalance: fromAccount.rows[0] ? parseFloat(fromAccount.rows[0].balance_usd) : 0,
      toBalance,
      platformFee,
      netAmount
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('pg-ledger', 'Release escrow failed', { taskId, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Refund escrowed credits to requester on task failure or dispute.
 * If no escrow record exists (task failed before accept), returns { success: true, refunded: false }.
 *
 * @param {string} taskId
 * @param {string} agentId - Requester to refund
 * @param {number} amount
 * @returns {Promise<{ success: boolean, refunded: boolean, balance?: number, error?: string }>}
 */
export async function refundEscrow(taskId, agentId, amount) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Check for a held escrow record
    const escrow = await client.query(`
      SELECT id FROM axip_marketplace.transactions
      WHERE task_id = $1 AND type = 'escrow' AND status = 'held'
    `, [taskId]);

    if (escrow.rows.length === 0) {
      await client.query('ROLLBACK');
      // No funds were escrowed (task failed before accept) — nothing to refund
      return { success: true, refunded: false, reason: 'no_escrow' };
    }

    // Credit back to requester (reverse the total_spent increment too)
    const credit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd = balance_usd + $1,
          total_spent = GREATEST(total_spent - $1, 0),
          updated_at = NOW()
      WHERE agent_id = $2
      RETURNING balance_usd
    `, [amount, agentId]);

    // Mark escrow as refunded
    await client.query(`
      UPDATE axip_marketplace.transactions
      SET status = 'refunded', type = 'refund'
      WHERE task_id = $1 AND type = 'escrow' AND status = 'held'
    `, [taskId]);

    await client.query('COMMIT');

    logger.info('pg-ledger', 'Escrow refunded', { taskId, agentId, amount });
    return {
      success: true,
      refunded: true,
      balance: credit.rows[0] ? parseFloat(credit.rows[0].balance_usd) : 0
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('pg-ledger', 'Refund escrow failed', { taskId, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Calculate deposit bonus credits based on tier.
 *
 * Tiers: $200+ → 10%, $50+ → 5%, under $50 → 0%
 *
 * @param {number} amountUsd
 * @returns {{ bonusRate: number, bonusCredits: number, totalCredits: number }}
 */
export function calculateDepositBonus(amountUsd) {
  const tier = DEPOSIT_BONUS_TIERS.find(t => amountUsd >= t.threshold);
  const bonusRate = tier?.rate ?? 0;
  const bonusCredits = Math.round(amountUsd * bonusRate * 1_000_000) / 1_000_000;
  const totalCredits = Math.round((amountUsd + bonusCredits) * 1_000_000) / 1_000_000;
  return { bonusRate, bonusCredits, totalCredits };
}

/**
 * Credit an agent's account on deposit (called after Stripe payment confirmed).
 *
 * Flow:
 *   BEGIN
 *   1. Ensure agent account exists
 *   2. Calculate bonus credits based on deposit tier
 *   3. Credit (amount + bonus) to agent balance
 *   4. Record in axip_marketplace.deposits
 *   5. Record in axip_marketplace.transactions
 *   COMMIT
 *
 * @param {string} agentId
 * @param {number} amountUsd - Amount actually paid (pre-bonus)
 * @param {string} [stripePaymentId] - Stripe payment intent or checkout session ID
 * @returns {Promise<{ success: boolean, balance?: number, bonusCredits?: number, totalCredited?: number, depositId?: number, error?: string }>}
 */
export async function deposit(agentId, amountUsd, stripePaymentId = null) {
  const p = getPool();
  const { bonusCredits, totalCredits } = calculateDepositBonus(amountUsd);

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // Ensure agent account exists
    await client.query(`
      INSERT INTO axip_marketplace.accounts (agent_id)
      VALUES ($1) ON CONFLICT (agent_id) DO NOTHING
    `, [agentId]);

    // Credit balance + update total_deposited
    const credit = await client.query(`
      UPDATE axip_marketplace.accounts
      SET balance_usd      = balance_usd + $1,
          total_deposited  = total_deposited + $2,
          updated_at       = NOW()
      WHERE agent_id = $3
      RETURNING balance_usd
    `, [totalCredits, amountUsd, agentId]);

    const balance = parseFloat(credit.rows[0].balance_usd);

    // Record in deposits table
    const dep = await client.query(`
      INSERT INTO axip_marketplace.deposits
        (agent_id, amount_usd, stripe_payment_id, stripe_status, bonus_credits)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [agentId, amountUsd, stripePaymentId, stripePaymentId ? 'succeeded' : 'manual', bonusCredits]);

    const depositId = dep.rows[0].id;

    // Record in transactions
    await client.query(`
      INSERT INTO axip_marketplace.transactions
        (task_id, from_agent, to_agent, gross_amount, platform_fee, net_amount, type, status, metadata)
      VALUES ($1, 'external', $2, $3, 0, $3, 'deposit', 'completed', $4)
    `, [
      `deposit-${depositId}`,
      agentId,
      totalCredits,
      JSON.stringify({ stripe_payment_id: stripePaymentId, bonus_credits: bonusCredits, amount_paid: amountUsd })
    ]);

    await client.query('COMMIT');

    logger.info('pg-ledger', 'Deposit credited', {
      agentId, amountUsd, bonusCredits, totalCredits, depositId
    });

    return { success: true, balance, bonusCredits, totalCredited: totalCredits, depositId };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('pg-ledger', 'Deposit failed', { agentId, amountUsd, error: err.message });
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Get deposit history for an agent.
 *
 * @param {string} agentId
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
export async function getDepositHistory(agentId, limit = 20) {
  const p = getPool();
  const result = await p.query(`
    SELECT id, amount_usd, bonus_credits, stripe_payment_id, stripe_status, created_at
    FROM axip_marketplace.deposits
    WHERE agent_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [agentId, limit]);

  return result.rows.map(row => ({
    ...row,
    amount_usd: parseFloat(row.amount_usd),
    bonus_credits: parseFloat(row.bonus_credits)
  }));
}

/**
 * Close the pool (call on shutdown).
 */
export async function closePgLedger() {
  if (pool) {
    await pool.end();
    pool = null;
    pgAvailable = false;
  }
}
