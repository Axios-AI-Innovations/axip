/**
 * Agent Delta (Sentinel) — Monitor Skill
 *
 * Fetches current network state from the AXIP relay dashboard APIs,
 * performs deterministic health checks, and only invokes LLM when
 * anomalies are detected.
 *
 * Architecture (mirrors Eli's gather/process pattern):
 *   gather()  — Deterministic. Fetch /api/agents and /api/stats from relay dashboard.
 *               No LLM. Returns raw network state.
 *   analyze() — Deterministic. Pure threshold checks against config.
 *               Returns { anomalies, healthy }.
 *   assess()  — LLM-only. If anomalies found, asks qwen3:1.7b to analyze.
 *               Returns structured health report JSON.
 *   monitor() — Orchestrates: gather → analyze → (optional) assess → return.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { complete } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const healthCheckConfig = config.health_check || {};
const monitorConfig = config.monitor || {};
const thresholds = healthCheckConfig.alert_thresholds || {};

const DASHBOARD_URL = healthCheckConfig.relay_dashboard_url || 'http://127.0.0.1:4201';
const FETCH_TIMEOUT_MS = 5000;

// ─── Main Orchestrator ───────────────────────────────────────────

/**
 * Perform a network health check with optional LLM anomaly analysis.
 * Deterministic checks first — LLM only if anomalies detected.
 *
 * @param {string} [description] - Optional task description for context
 * @returns {Promise<{ status: string, issues: Array<{ severity: string, description: string, recommendation: string }>, summary: string, agents_online: number, timestamp: string }>}
 */
export async function monitor(description = '') {
  const timestamp = new Date().toISOString();

  // ── Step 1: Gather (fetch relay dashboard data, no LLM) ────────
  const networkState = await gather();

  if (networkState.error) {
    return {
      status: 'critical',
      issues: [{
        severity: 'critical',
        description: `Cannot reach relay dashboard: ${networkState.error}`,
        recommendation: 'Check if the AXIP relay is running and the dashboard is accessible.'
      }],
      summary: `Relay dashboard unreachable: ${networkState.error}`,
      agents_online: 0,
      timestamp
    };
  }

  // ── Step 2: Analyze (deterministic threshold checks, no LLM) ───
  const analysis = analyze(networkState);

  // ── Step 3: If anomalies, invoke LLM for deeper assessment ─────
  if (analysis.anomalies.length > 0) {
    try {
      const llmReport = await assess(networkState, analysis.anomalies, description);
      return { ...llmReport, agents_online: networkState.agentsOnline, timestamp };
    } catch (err) {
      console.error(`[sentinel] LLM assessment failed, returning deterministic report: ${err.message}`);
      // Fall through to deterministic report
    }
  }

  // ── No anomalies or LLM failed — return deterministic result ───
  return {
    status: analysis.anomalies.length > 0 ? 'warning' : 'healthy',
    issues: analysis.anomalies.map(a => ({
      severity: a.severity,
      description: a.message,
      recommendation: a.recommendation
    })),
    summary: analysis.anomalies.length > 0
      ? `${analysis.anomalies.length} issue(s) detected in network.`
      : `Network healthy. ${networkState.agentsOnline} agent(s) online.`,
    agents_online: networkState.agentsOnline,
    timestamp
  };
}

// ─── Gather: Fetch Relay Dashboard Data (Deterministic, No LLM) ──

/**
 * Fetch network state from the relay dashboard APIs.
 * No LLM calls. On failure, returns error state.
 *
 * @returns {Promise<{ agents: Array, stats: Object, agentsOnline: number, error: string|null }>}
 */
async function gather() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const [agentsRes, statsRes] = await Promise.allSettled([
      fetch(`${DASHBOARD_URL}/api/agents`, { signal: controller.signal }),
      fetch(`${DASHBOARD_URL}/api/stats`, { signal: controller.signal })
    ]);

    clearTimeout(timeoutId);

    let agents = [];
    let stats = {};

    if (agentsRes.status === 'fulfilled' && agentsRes.value.ok) {
      agents = await agentsRes.value.json();
    }

    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      stats = await statsRes.value.json();
    }

    const agentsOnline = Array.isArray(agents)
      ? agents.filter(a => a.status === 'online' || a.connected === true).length
      : 0;

    return { agents, stats, agentsOnline, error: null };
  } catch (err) {
    return { agents: [], stats: {}, agentsOnline: 0, error: err.message };
  }
}

// ─── Analyze: Deterministic Threshold Checks (No LLM) ────────────

/**
 * Run pure deterministic checks against thresholds.
 * No LLM. Returns anomalies list.
 *
 * @param {{ agents: Array, stats: Object, agentsOnline: number }} networkState
 * @returns {{ anomalies: Array<{ severity: string, message: string, recommendation: string }>, healthy: boolean }}
 */
function analyze(networkState) {
  const anomalies = [];

  // Check 1: Minimum online agents
  const minOnline = thresholds.min_online_agents || 2;
  if (networkState.agentsOnline < minOnline) {
    anomalies.push({
      severity: networkState.agentsOnline === 0 ? 'critical' : 'warning',
      message: `Only ${networkState.agentsOnline} agent(s) online (minimum: ${minOnline}).`,
      recommendation: 'Check if agents are running. Restart any offline agents.'
    });
  }

  // Check 2: Agent offline too long
  const maxOfflineMinutes = thresholds.max_agent_offline_minutes || 10;
  if (Array.isArray(networkState.agents)) {
    const now = Date.now();
    for (const agent of networkState.agents) {
      if (agent.status === 'offline' || agent.connected === false) {
        const lastSeen = agent.last_seen || agent.lastSeen || agent.disconnected_at;
        if (lastSeen) {
          const offlineMinutes = (now - new Date(lastSeen).getTime()) / 60000;
          if (offlineMinutes > maxOfflineMinutes) {
            anomalies.push({
              severity: 'warning',
              message: `Agent "${agent.name || agent.agent_id || 'unknown'}" offline for ${Math.round(offlineMinutes)} minutes (threshold: ${maxOfflineMinutes}min).`,
              recommendation: `Check agent "${agent.name || agent.agent_id || 'unknown'}" and restart if needed.`
            });
          }
        }
      }
    }
  }

  // Check 3: Task failure rate
  const maxFailureRate = thresholds.max_task_failure_rate || 0.3;
  const stats = networkState.stats || {};
  const totalTasks = (stats.tasks_completed || 0) + (stats.tasks_failed || 0);
  if (totalTasks > 0) {
    const failureRate = (stats.tasks_failed || 0) / totalTasks;
    if (failureRate > maxFailureRate) {
      anomalies.push({
        severity: failureRate > 0.5 ? 'critical' : 'warning',
        message: `Task failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(maxFailureRate * 100).toFixed(1)}%.`,
        recommendation: 'Investigate recent task failures. Check agent logs for errors.'
      });
    }
  }

  return {
    anomalies,
    healthy: anomalies.length === 0
  };
}

// ─── Assess: LLM Anomaly Analysis ────────────────────────────────

/**
 * Feed anomalies and network state to LLM for deeper analysis.
 * Only called when deterministic checks find issues.
 *
 * @param {Object} networkState - Raw network state from gather()
 * @param {Array} anomalies - Detected anomalies from analyze()
 * @param {string} description - Optional task context
 * @returns {Promise<{ status: string, issues: Array, summary: string }>}
 */
async function assess(networkState, anomalies, description) {
  const stateBlock = JSON.stringify({
    agents_online: networkState.agentsOnline,
    total_agents: Array.isArray(networkState.agents) ? networkState.agents.length : 0,
    agents: Array.isArray(networkState.agents) ? networkState.agents.map(a => ({
      name: a.name || a.agent_id,
      status: a.status || (a.connected ? 'online' : 'offline'),
      capabilities: a.capabilities || [],
      last_seen: a.last_seen || a.lastSeen
    })) : [],
    stats: networkState.stats,
    detected_anomalies: anomalies
  }, null, 2);

  const prompt = `Current network state:\n${stateBlock}${description ? `\n\nAdditional context: ${description}` : ''}`;

  const system = 'You are a network sentinel monitoring an AI agent network. Analyze this network state and report any anomalies, risks, or concerning patterns. Output a JSON object with: status (healthy/warning/critical), issues (array of {severity, description, recommendation}), summary (string). No other text.';

  const result = await complete({
    prompt,
    system,
    taskName: 'monitor-assess',
    maxTokens: monitorConfig.max_output_tokens || 512,
    temperature: monitorConfig.temperature || 0.2
  });

  console.log(`[sentinel] LLM assessment: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

  // Parse LLM JSON response
  return parseLLMReport(result.text);
}

// ─── LLM Response Parser ─────────────────────────────────────────

/**
 * Parse the LLM's JSON response for the health report.
 * Handles markdown code fences and extra text.
 *
 * @param {string} text - Raw LLM output
 * @returns {{ status: string, issues: Array, summary: string }}
 */
function parseLLMReport(text) {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find a JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    console.warn('[sentinel] Could not find JSON object in LLM response');
    return {
      status: 'warning',
      issues: [{ severity: 'warning', description: 'LLM response was not valid JSON.', recommendation: 'Check sentinel logs.' }],
      summary: 'LLM analysis returned non-JSON response.'
    };
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);
    return {
      status: parsed.status || 'warning',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: parsed.summary || 'No summary provided.'
    };
  } catch (err) {
    console.warn(`[sentinel] Failed to parse LLM JSON: ${err.message}`);
    return {
      status: 'warning',
      issues: [{ severity: 'warning', description: 'Failed to parse LLM analysis output.', recommendation: 'Check sentinel logs.' }],
      summary: 'LLM analysis returned invalid JSON.'
    };
  }
}
