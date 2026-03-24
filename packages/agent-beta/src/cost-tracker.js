/**
 * Agent Beta — Cost Tracker
 *
 * Simplified version of Eli's cost-tracker.js.
 * All calls are $0 (local Ollama) but tracked for usage analytics.
 * No Anthropic pricing logic, no budget gating.
 */

import { getDb } from './db.js';

/**
 * Log an inference call to the database.
 *
 * @param {Object} params
 * @param {string} params.taskName - Which skill triggered this call
 * @param {string} params.model - Model identifier (e.g., 'qwen3:8b')
 * @param {string} params.provider - Always 'ollama' for Beta
 * @param {number} params.inputTokens - Input token count
 * @param {number} params.outputTokens - Output token count
 * @param {number} params.durationMs - Call duration in milliseconds
 * @param {string|null} [params.error] - Error message if call failed
 */
export function trackCall({ taskName, model, provider, inputTokens, outputTokens, durationMs, error = null }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO api_calls (task_name, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(taskName, model, provider, inputTokens, outputTokens, durationMs, error);
  } catch (dbErr) {
    // Non-fatal — don't let tracking failures break the skill
    console.error(`[cost-tracker] Failed to log call: ${dbErr.message}`);
  }

  // Console log for visibility (matches Eli's format)
  const costStr = '$0 (local)';
  console.log(`[cost] ${taskName} | ${model} | ${inputTokens}in/${outputTokens}out | ${costStr} | ${durationMs}ms`);
}

/**
 * Get usage stats for the current month.
 *
 * @returns {{ totalCalls: number, totalInputTokens: number, totalOutputTokens: number, totalDurationMs: number }}
 */
export function getUsageStats() {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(duration_ms), 0) as total_duration_ms
      FROM api_calls
      WHERE timestamp >= datetime('now', 'start of month')
        AND error IS NULL
    `).get();

    return {
      totalCalls: row.total_calls,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalDurationMs: row.total_duration_ms
    };
  } catch {
    return { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 };
  }
}
