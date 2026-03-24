/**
 * Agent Data Extract — Cost Tracker
 *
 * All calls are $0 (local Ollama) but tracked for usage analytics.
 */

import { getDb } from './db.js';

export function trackCall({ taskName, model, provider, inputTokens, outputTokens, durationMs, error = null }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO api_calls (task_name, model, provider, input_tokens, output_tokens, cost_usd, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(taskName, model, provider, inputTokens, outputTokens, durationMs, error);
  } catch (dbErr) {
    console.error(`[cost-tracker] Failed to log call: ${dbErr.message}`);
  }

  const costStr = '$0 (local)';
  console.log(`[cost] ${taskName} | ${model} | ${inputTokens}in/${outputTokens}out | ${costStr} | ${durationMs}ms`);
}
