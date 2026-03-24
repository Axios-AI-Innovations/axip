/**
 * AXIP Relay — Agent Registry
 *
 * Manages agent registration, capability indexing, and online status.
 * The registry is the relay's directory of who's on the network.
 */

import { getDb } from './db.js';

/**
 * Handle an agent's announce message.
 * Registers the agent or updates an existing registration.
 *
 * @param {Object} msg - The announce message
 * @returns {{ agentId: string, balance: number, reputation: number, isNew: boolean }}
 */
export function handleAnnounce(msg) {
  const db = getDb();
  const { agent_id, pubkey } = msg.from;
  const { capabilities, name, pricing, metadata } = msg.payload;

  // Check if agent already exists
  const existing = db.prepare('SELECT agent_id FROM agents WHERE agent_id = ?').get(agent_id);

  if (existing) {
    // Update existing agent
    db.prepare(`
      UPDATE agents
      SET status = 'online',
          capabilities = ?,
          pricing = ?,
          metadata = ?,
          name = ?,
          pubkey = ?,
          last_seen = datetime('now')
      WHERE agent_id = ?
    `).run(
      JSON.stringify(capabilities || []),
      JSON.stringify(pricing || {}),
      JSON.stringify(metadata || {}),
      name || agent_id,
      pubkey,
      agent_id
    );
  } else {
    // Register new agent with $1.00 starting balance
    db.prepare(`
      INSERT INTO agents (agent_id, pubkey, name, capabilities, pricing, metadata, reputation, balance, status, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, 0.5, 1.00, 'online', datetime('now'))
    `).run(
      agent_id,
      pubkey,
      name || agent_id,
      JSON.stringify(capabilities || []),
      JSON.stringify(pricing || {}),
      JSON.stringify(metadata || {})
    );
  }

  // Fetch final state to return
  const agent = db.prepare('SELECT reputation, balance FROM agents WHERE agent_id = ?').get(agent_id);

  return {
    agentId: agent_id,
    balance: agent.balance,
    reputation: agent.reputation,
    isNew: !existing
  };
}

/**
 * Update an agent's last_seen timestamp on heartbeat.
 */
export function handleHeartbeat(agentId) {
  const db = getDb();
  db.prepare("UPDATE agents SET last_seen = datetime('now'), status = 'online' WHERE agent_id = ?")
    .run(agentId);
}

/**
 * Mark an agent as offline (called when WebSocket disconnects).
 */
export function markOffline(agentId) {
  const db = getDb();
  db.prepare("UPDATE agents SET status = 'offline' WHERE agent_id = ?").run(agentId);
}

/**
 * Find all online agents with a specific capability.
 *
 * @param {string} capability - The capability to search for
 * @returns {Array} Matching agents
 */
export function getAgentsByCapability(capability) {
  const db = getDb();
  // Use LIKE for JSON array search — simple and sufficient for demo
  return db.prepare(`
    SELECT agent_id, name, capabilities, pricing, reputation, balance, status, last_seen
    FROM agents
    WHERE status = 'online'
      AND capabilities LIKE ?
    ORDER BY reputation DESC
  `).all(`%"${capability}"%`);
}

/**
 * Get a single agent by ID.
 */
export function getAgent(agentId) {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId);
}

/**
 * Get all agents (for dashboard).
 */
export function getAllAgents() {
  const db = getDb();
  return db.prepare('SELECT * FROM agents ORDER BY registered_at DESC').all();
}
