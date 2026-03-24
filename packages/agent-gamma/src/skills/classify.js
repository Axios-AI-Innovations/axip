/**
 * Agent Gamma — Classify Skill
 *
 * Ultra-fast message classification using qwen3:1.7b.
 * Given a message description, outputs a structured JSON object
 * with intent, category, confidence, and suggested_capability.
 *
 * Architecture:
 *   1. Build system + user prompt for classification
 *   2. Call local Ollama via router (qwen3:1.7b, temp 0.1, 128 tokens)
 *   3. Parse JSON response
 *   4. Return structured classification object
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { complete } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const classifyConfig = config.classify || {};

const SYSTEM_PROMPT = `You are a message classifier for an AI agent network. Given a message, output ONLY a JSON object with these fields: intent (string), category (string), confidence (number 0-1), suggested_capability (string). No other text.`;

/**
 * Classify a message/task description into intent, category, and suggested capability.
 *
 * @param {string} description - The message or task description to classify
 * @returns {Promise<{ intent: string, category: string, confidence: number, suggested_capability: string }>}
 */
export async function classify(description) {
  const result = await complete({
    prompt: description,
    system: SYSTEM_PROMPT,
    taskName: 'classify',
    maxTokens: classifyConfig.max_output_tokens || 128,
    temperature: classifyConfig.temperature ?? 0.1
  });

  console.log(`[classify] LLM response: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

  // Parse the JSON response from the LLM
  const parsed = parseClassification(result.text);
  return parsed;
}

/**
 * Parse the LLM's JSON classification response.
 * Handles common quirks: markdown code fences, extra text.
 *
 * @param {string} text - Raw LLM output
 * @returns {{ intent: string, category: string, confidence: number, suggested_capability: string }}
 */
function parseClassification(text) {
  // Strip markdown code fences if present
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find a JSON object in the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    console.warn('[classify] Could not find JSON object in LLM response');
    return {
      intent: 'unknown',
      category: 'unknown',
      confidence: 0,
      suggested_capability: 'unknown'
    };
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);

    return {
      intent: String(parsed.intent || 'unknown').trim(),
      category: String(parsed.category || 'unknown').trim(),
      confidence: clampConfidence(parsed.confidence),
      suggested_capability: String(parsed.suggested_capability || 'unknown').trim()
    };
  } catch (err) {
    console.warn(`[classify] Failed to parse LLM JSON: ${err.message}`);
    return {
      intent: 'unknown',
      category: 'unknown',
      confidence: 0,
      suggested_capability: 'unknown'
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
