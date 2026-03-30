/**
 * Agent Summarize — Router
 *
 * Single-tier passthrough to local Ollama.
 * Mirrors other agents' route() signature for consistency.
 */

import * as ollama from './llm/ollama.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const model = config.models.ollama.primary;

/**
 * Route a task to the local Ollama model.
 *
 * @param {Object} params
 * @param {string} params.prompt - The user prompt
 * @param {string} [params.system] - System prompt
 * @param {string} params.taskName - For cost tracking
 * @param {number} [params.maxTokens=768] - Max output tokens
 * @param {number} [params.temperature=0.2] - Sampling temperature
 * @returns {Promise<{ text: string, model: string, provider: string, inputTokens: number, outputTokens: number, durationMs: number }>}
 */
export async function route({ prompt, system = '', taskName, maxTokens = 768, temperature = 0.2 }) {
  const result = await ollama.complete({
    model,
    prompt,
    system,
    taskName,
    options: { maxTokens, temperature }
  });

  return {
    text: result.text,
    model,
    provider: 'ollama',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs
  };
}
