/**
 * Agent Summarize — Ollama Provider
 *
 * Local LLM inference via Ollama HTTP API.
 * Uses qwen3:14b — strong long-form comprehension and summarization.
 * Cost: $0 per call. Still logged for usage analytics.
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
 * @param {string} params.model - Ollama model name (e.g., 'qwen3:14b')
 * @param {string} params.prompt - The user prompt
 * @param {string} [params.system] - System prompt (optional)
 * @param {string} params.taskName - Which skill is calling (for cost tracking)
 * @param {Object} [params.options] - Ollama generation options (temperature, etc.)
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number, durationMs: number }>}
 */
export async function complete({ model, prompt, system = '', taskName = 'unknown', options = {} }) {
  const startTime = Date.now();

  // 90-second timeout — summarizing long pages can take time
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await ollamaClient.chat({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt }
      ],
      think: false,
      options: {
        num_predict: options.maxTokens || 768,
        temperature: options.temperature ?? 0.2,
        ...options
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;

    const errMsg = err.name === 'AbortError' ? `Ollama call timed out after 90s` : err.message;

    trackCall({
      taskName,
      model,
      provider: 'ollama',
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      error: errMsg
    });

    console.error(`[ollama] Error calling ${model} for ${taskName}: ${errMsg}`);
    throw new Error(errMsg);
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
