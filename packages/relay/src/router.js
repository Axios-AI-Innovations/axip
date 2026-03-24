/**
 * AXIP Relay — Task Router
 *
 * Matches discover requests to capable agents.
 * Pure deterministic matching — no AI involved.
 */

import * as registry from './registry.js';

/**
 * Handle a discover request from an agent.
 * Finds online agents with the requested capability.
 *
 * @param {Object} msg - The discover message
 * @returns {Array} Matching agents (formatted for discover_result)
 */
export function handleDiscover(msg) {
  const { capability, constraints = {} } = msg.payload;

  let agents = registry.getAgentsByCapability(capability);

  // Exclude the requesting agent from results
  agents = agents.filter(a => a.agent_id !== msg.from.agent_id);

  // Apply constraints
  if (constraints.max_cost_usd !== undefined) {
    agents = agents.filter(a => {
      const pricing = JSON.parse(a.pricing || '{}');
      const capPrice = pricing[capability]?.base_usd;
      return capPrice === undefined || capPrice <= constraints.max_cost_usd;
    });
  }

  if (constraints.min_reputation !== undefined) {
    agents = agents.filter(a => a.reputation >= constraints.min_reputation);
  }

  // Format for the discover_result payload
  return agents.map(a => ({
    agent_id: a.agent_id,
    name: a.name,
    capabilities: JSON.parse(a.capabilities || '[]'),
    pricing: JSON.parse(a.pricing || '{}'),
    reputation: a.reputation,
    balance: a.balance,
    online: a.status === 'online'
  }));
}

/**
 * Find the best agent for a specific capability.
 * Used internally by taskManager for routing task_requests.
 *
 * @param {string} capability - Required capability
 * @param {string} [excludeAgentId] - Agent to exclude (usually the requester)
 * @returns {Array} Matching agents sorted by reputation
 */
export function findCapableAgents(capability, excludeAgentId = null) {
  let agents = registry.getAgentsByCapability(capability);

  if (excludeAgentId) {
    agents = agents.filter(a => a.agent_id !== excludeAgentId);
  }

  return agents;
}
