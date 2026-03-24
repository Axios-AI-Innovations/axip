/**
 * Agent Gamma — Ollama Provider
 *
 * Local LLM inference via Ollama HTTP API.
 * Near-copy of ~/eli-agent/src/llm/ollama.js.
 * Cost: $0 per call. Still logged for usage analytics.
 *
 * Gamma uses qwen3:1.7b (ultra-fast, ~2GB RAM) for classification
 * and routing tasks that need minimal latency.
 */

import { Ollama } from 'ollama';
import { trackCall } from '../cost-tracker.js';

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
});

/**
 * Send a completion request to a local Ollama model.
 *
 * @param {Object} params
 * @param {string} params.model - Ollama model name (e.g., 'qwen3:1.7b')
 * @param {string} params.prompt - The user prompt
 * @param {string} [params.system] - System prompt (optional)
 * @param {string} params.taskName - Which skill is calling (for cost tracking)
 * @param {Object} [params.options] - Ollama generation options (temperature, etc.)
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number, durationMs: number }>}
 */
export async function complete({ model, prompt, system = '', taskName = 'unknown', options = {} }) {
  const startTime = Date.now();

  try {
    const response = await ollamaClient.chat({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt }
      ],
      think: false, // Disable qwen3 thinking mode — it consumes tokens and returns empty content
      options: {
        num_predict: options.maxTokens || 1024,
        temperature: options.temperature ?? 0.7,
        ...options
      }
    });

    const durationMs = Date.now() - startTime;
    const inputTokens = response.prompt_eval_count || 0;
    const outputTokens = response.eval_count || 0;
    const text = response.message?.content || '';

    trackCall({
      taskName,
      model,
      provider: 'ollama',
      inputTokens,
      outputTokens,
      durationMs
    });

    return { text, inputTokens, outputTokens, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    trackCall({
      taskName,
      model,
      provider: 'ollama',
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      error: err.message
    });

    // No retry — log and throw
    console.error(`[ollama] Error calling ${model} for ${taskName}: ${err.message}`);
    throw err;
  }
}

/**
 * Check if Ollama is running and a specific model is available.
 *
 * @param {string} [model] - Specific model to check for
 * @returns {Promise<{ running: boolean, model_available: boolean, models: string[] }>}
 */
export async function healthCheck(model) {
  try {
    const list = await ollamaClient.list();
    const models = list.models.map(m => m.name);
    return {
      running: true,
      model_available: model ? models.some(m => m.startsWith(model)) : true,
      models
    };
  } catch {
    return { running: false, model_available: false, models: [] };
  }
}
