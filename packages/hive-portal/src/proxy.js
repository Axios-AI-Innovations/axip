/**
 * AXIP Hive Portal — Relay API Proxy
 *
 * Thin fetch wrapper around the relay dashboard API.
 * Handles errors gracefully — portal stays up even if relay is temporarily down.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const RELAY_API = config.relay.api_url;

/**
 * Fetch a path from the relay API.
 * Returns parsed JSON on success, null on failure.
 *
 * @param {string} path - API path (e.g., '/api/stats')
 * @returns {Promise<Object|null>}
 */
export async function relayFetch(path) {
  try {
    const res = await fetch(`${RELAY_API}${path}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      console.warn(`[hive-portal] Relay returned ${res.status} for ${path}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn(`[hive-portal] Relay fetch failed for ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch a path from the relay API — raw pass-through (no sanitization).
 * Used for admin proxy routes where the full relay response is needed.
 *
 * @param {string} path - API path (e.g., '/api/agents')
 * @returns {Promise<Object|null>}
 */
export async function relayFetchRaw(path) {
  try {
    const res = await fetch(`${RELAY_API}${path}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      console.warn(`[hive-portal] Relay returned ${res.status} for ${path} (raw)`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn(`[hive-portal] Relay raw fetch failed for ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Sanitize agent data for public consumption.
 * Strips: agent_id hashes, public keys, balances, internal metadata.
 *
 * @param {Object} agent - Raw agent object from relay
 * @returns {Object} Sanitized agent
 */
export function sanitizeAgent(agent) {
  return {
    name: agent.name || 'unknown',
    capabilities: agent.capabilities || [],
    status: agent.status || 'unknown',
    reputation: agent.reputation ?? null,
    operator: agent.metadata?.operator || null,
    node_type: agent.metadata?.node_type || null,
    runtime: agent.metadata?.runtime || null,
    mission_aligned: agent.metadata?.mission_aligned || false,
    connected_at: agent.connected_at || null,
    pricing: agent.pricing || null
  };
}

/**
 * Sanitize task data for public consumption.
 * Strips: descriptions, payloads, agent IDs.
 *
 * @param {Object} task - Raw task object from relay
 * @returns {Object} Sanitized task
 */
export function sanitizeTask(task) {
  return {
    capability: task.capability_required || task.capability || task.type || 'unknown',
    status: task.state || task.status || 'unknown',
    created_at: task.created_at || task.timestamp || null,
    settled_at: task.settled_at || null,
    cost: task.actual_cost ?? task.cost ?? null
  };
}
