/**
 * Agent Code Review — Ollama Provider
 *
 * Local LLM inference via Ollama HTTP API.
 * 30-second timeout on all calls.
 */

import { Ollama } from 'ollama';
import { trackCall } from '../cost-tracker.js';

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
});

/**
 * Send a completion request to a local Ollama model.
 */
export async function complete({ model, prompt, system = '', taskName = 'unknown', options = {} }) {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await ollamaClient.chat({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt }
      ],
      think: false,
      options: {
        num_predict: options.maxTokens || 2048,
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

    trackCall({ taskName, model, provider: 'ollama', inputTokens, outputTokens, durationMs });

    return { text, inputTokens, outputTokens, durationMs };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    const errMsg = err.name === 'AbortError' ? 'Ollama call timed out after 30s' : err.message;

    trackCall({ taskName, model, provider: 'ollama', inputTokens: 0, outputTokens: 0, durationMs, error: errMsg });

    console.error(`[ollama] Error calling ${model} for ${taskName}: ${errMsg}`);
    throw new Error(errMsg);
  }
}

/**
 * Check if Ollama is running and a specific model is available.
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
