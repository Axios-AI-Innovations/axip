/**
 * Agent Gamma — Route Skill
 *
 * Ultra-fast task routing using qwen3:1.7b.
 * Given a task description and a list of available agents,
 * recommends the best agent for the task.
 *
 * Architecture:
 *   1. Build system + user prompt with task + agent list
 *   2. Call local Ollama via router (qwen3:1.7b, temp 0.1, 256 tokens)
 *   3. Parse JSON response
 *   4. Return structured routing recommendation
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { complete } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const routeConfig = config.route || {};

const SYSTEM_PROMPT = `You are a task router for an AI agent network. Given a task description and a list of available agents with their capabilities, output ONLY a JSON object with: recommended_agent_id (string), reasoning (string), confidence (number 0-1). Choose the agent best suited for the task. No other text.`;

/**
 * Route a task to the best available agent.
 *
 * @param {string} description - The task description to route
 * @param {Array<{ agent_id: string, name: string, capabilities: string[], reputation: number }>} agents - Available agents
 * @returns {Promise<{ recommended_agent_id: string, reasoning: string, confidence: number }>}
 */
export async function route(description, agents) {
  // Build agent list for the prompt
  const agentBlock = agents.map((a, i) =>
    `[${i}] agent_id: ${a.agent_id}, name: ${a.name}, capabilities: [${a.capabilities.join(', ')}], reputation: ${a.reputation}`
  ).join('\n');

  const prompt = `Task: "${description}"

Available agents:
${agentBlock}

Which agent should handle this task?`;

  const result = await complete({
    prompt,
    system: SYSTEM_PROMPT,
    taskName: 'route',
    maxTokens: routeConfig.max_output_tokens || 256,
    temperature: routeConfig.temperature ?? 0.1
  });

  console.log(`[route] LLM response: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

  // Parse the JSON response from the LLM
  const parsed = parseRouting(result.text);
  return parsed;
}

/**
 * Parse the LLM's JSON routing response.
 * Handles common quirks: markdown code fences, extra text.
 *
 * @param {string} text - Raw LLM output
 * @returns {{ recommended_agent_id: string, reasoning: string, confidence: number }}
 */
function parseRouting(text) {
  // Strip markdown code fences if present
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find a JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    console.warn('[route] Could not find JSON object in LLM response');
    return {
      recommended_agent_id: 'unknown',
      reasoning: 'Failed to parse LLM response',
      confidence: 0
    };
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);

    return {
      recommended_agent_id: String(parsed.recommended_agent_id || 'unknown').trim(),
      reasoning: String(parsed.reasoning || '').trim(),
      confidence: clampConfidence(parsed.confidence)
    };
  } catch (err) {
    console.warn(`[route] Failed to parse LLM JSON: ${err.message}`);
    return {
      recommended_agent_id: 'unknown',
      reasoning: `Parse error: ${err.message}`,
      confidence: 0
    };
  }
}

/**
 * Clamp confidence to [0.0, 1.0]. Handle both 0.85 and 85 formats.
 */
function clampConfidence(value) {
  if (typeof value !== 'number' || isNaN(value)) return 0;
  if (value > 1) value = value / 100; // Handle "85" -> 0.85
  return Math.max(0, Math.min(1, value));
}
