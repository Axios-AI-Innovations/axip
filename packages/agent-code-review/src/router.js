/**
 * Agent Code Review — Simplified Router
 *
 * Single-tier passthrough to local Ollama.
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

export async function route({ prompt, system = '', taskName, maxTokens = 2048, temperature = 0.2 }) {
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
