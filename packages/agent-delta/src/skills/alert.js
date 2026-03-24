/**
 * Agent Delta (Sentinel) — Alert Assessment Skill
 *
 * Takes a potential issue description and uses the LLM to assess
 * severity, provide analysis, and recommend actions.
 *
 * Uses qwen3:1.7b with low temperature (0.1) for precise,
 * consistent alert classification.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { complete } from '../router.js';
import { insertAlert } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const alertConfig = config.alert || {};

/**
 * Assess a potential issue and classify its severity.
 *
 * @param {string} description - Description of the potential issue
 * @returns {Promise<{ severity: string, assessment: string, recommended_action: string, escalate: boolean }>}
 */
export async function assessAlert(description) {
  const system = 'You are a network sentinel. Assess the following potential issue for an AI agent network. Output ONLY a JSON object with: severity (critical/warning/info), assessment (string), recommended_action (string), escalate (boolean). No other text.';

  const result = await complete({
    prompt: description,
    system,
    taskName: 'alert-assess',
    maxTokens: alertConfig.max_output_tokens || 256,
    temperature: alertConfig.temperature || 0.1
  });

  console.log(`[sentinel] Alert assessment: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

  const parsed = parseAlertResponse(result.text);

  // Persist alert to database
  insertAlert({
    severity: parsed.severity,
    source: 'alert-assess',
    message: description,
    details: parsed
  });

  return parsed;
}

// ─── LLM Response Parser ─────────────────────────────────────────

/**
 * Parse the LLM's JSON response for alert assessment.
 * Handles markdown code fences and extra text.
 *
 * @param {string} text - Raw LLM output
 * @returns {{ severity: string, assessment: string, recommended_action: string, escalate: boolean }}
 */
function parseAlertResponse(text) {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find a JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    console.warn('[sentinel] Could not find JSON object in alert LLM response');
    return {
      severity: 'warning',
      assessment: 'LLM response was not valid JSON. Manual review recommended.',
      recommended_action: 'Check sentinel logs for raw LLM output.',
      escalate: true
    };
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);
    return {
      severity: parsed.severity || 'warning',
      assessment: parsed.assessment || 'No assessment provided.',
      recommended_action: parsed.recommended_action || 'No action recommended.',
      escalate: typeof parsed.escalate === 'boolean' ? parsed.escalate : false
    };
  } catch (err) {
    console.warn(`[sentinel] Failed to parse alert JSON: ${err.message}`);
    return {
      severity: 'warning',
      assessment: 'Failed to parse LLM alert assessment.',
      recommended_action: 'Check sentinel logs.',
      escalate: true
    };
  }
}
