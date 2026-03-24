/**
 * AXIP Relay — Reputation System
 *
 * Calculates and updates agent reputation scores using an
 * exponential moving average (EMA) with alpha = 0.1.
 *
 * Formula:
 *   composite = (0.3 * time) + (0.3 * quality) + (0.2 * format) + (0.2 * reliability)
 *   new_reputation = (alpha * composite) + ((1 - alpha) * old_reputation)
 *
 * New agents start at 0.5. Good performance lifts slowly; long track records
 * are hard to nuke with a single bad result.
 */

import { getDb } from './db.js';
import * as logger from './logger.js';

const ALPHA = 0.1; // EMA smoothing factor

/**
 * Record a reputation event and update the agent's reputation.
 *
 * @param {string} agentId - The agent being evaluated
 * @param {string} taskId - The task that was completed
 * @param {Object} scores
 * @param {number} scores.timeScore - 0-1: did they deliver on time?
 * @param {number} scores.qualityScore - 0-1: quality rating from the requester
 * @param {number} scores.formatScore - 0-1: was the output well-structured?
 * @param {number} scores.reliabilityScore - 0-1: did they complete (vs fail/timeout)?
 * @returns {{ composite: number, newReputation: number }}
 */
export function recordEvent(agentId, taskId, { timeScore = 1.0, qualityScore = 0.5, formatScore = 1.0, reliabilityScore = 1.0 }) {
  const db = getDb();

  // Calculate composite score
  const composite = (0.3 * timeScore) + (0.3 * qualityScore) + (0.2 * formatScore) + (0.2 * reliabilityScore);

  // Get current reputation
  const agent = db.prepare('SELECT reputation FROM agents WHERE agent_id = ?').get(agentId);
  if (!agent) {
    logger.warn('reputation', 'Agent not found', { agentId });
    return { composite, newReputation: 0.5 };
  }

  // EMA update
  const newReputation = (ALPHA * composite) + ((1 - ALPHA) * agent.reputation);

  // Insert event record
  db.prepare(`
    INSERT INTO reputation_events (agent_id, task_id, time_score, quality_score, format_score, reliability_score, composite_score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(agentId, taskId, timeScore, qualityScore, formatScore, reliabilityScore, composite);

  // Update agent's reputation
  db.prepare('UPDATE agents SET reputation = ? WHERE agent_id = ?')
    .run(Math.round(newReputation * 1000) / 1000, agentId); // Round to 3 decimal places

  return {
    composite: Math.round(composite * 1000) / 1000,
    newReputation: Math.round(newReputation * 1000) / 1000
  };
}

/**
 * Get an agent's current reputation.
 */
export function getReputation(agentId) {
  const db = getDb();
  const agent = db.prepare('SELECT reputation FROM agents WHERE agent_id = ?').get(agentId);
  return agent?.reputation ?? 0.5;
}

/**
 * Get reputation history for an agent.
 */
export function getHistory(agentId) {
  const db = getDb();
  return db.prepare('SELECT * FROM reputation_events WHERE agent_id = ? ORDER BY timestamp DESC').all(agentId);
}
