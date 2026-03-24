/**
 * Agent Beta — Summarization Skill (Live)
 *
 * Real LLM-powered text summarization via local Ollama (qwen3:8b).
 * Replaces the mock summarize.js with actual inference.
 *
 * Used when Eli (or another AXIP agent) delegates a `summarize` task.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { route } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const summarizeConfig = config.summarize || {};

/**
 * Summarize text using the local LLM.
 *
 * @param {string} text - Text to summarize
 * @returns {Promise<{ summary: string, key_points: string[], original_length: number, summary_length: number }>}
 */
export async function summarize(text) {
  const originalLength = (text || '').split(/\s+/).length;

  if (!text || text.trim().length === 0) {
    return {
      summary: 'No text provided for summarization.',
      key_points: [],
      original_length: 0,
      summary_length: 0
    };
  }

  // Truncate input if it exceeds the token budget
  // Rough estimate: 1 token ≈ 4 chars for English text
  const maxChars = (summarizeConfig.max_input_tokens || 4000) * 4;
  const truncatedText = text.length > maxChars
    ? text.slice(0, maxChars) + '\n\n[Text truncated for length]'
    : text;

  const prompt = `Summarize the following text concisely. Provide:
1. A clear summary (2-4 sentences)
2. Key points as a bulleted list (3-5 bullets)

Format your response exactly as:

SUMMARY:
[Your summary here]

KEY POINTS:
- [Point 1]
- [Point 2]
- [Point 3]

Text to summarize:

${truncatedText}`;

  try {
    const result = await route({
      prompt,
      system: 'You are a concise summarization assistant. Be factual and direct.',
      taskName: 'summarize',
      maxTokens: summarizeConfig.max_output_tokens || 512,
      temperature: summarizeConfig.temperature || 0.3
    });

    console.log(`[summarize] LLM: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

    // Parse the structured response
    const parsed = parseResponse(result.text);
    const summaryLength = parsed.summary.split(/\s+/).length;

    return {
      summary: parsed.summary,
      key_points: parsed.key_points,
      original_length: originalLength,
      summary_length: summaryLength
    };
  } catch (err) {
    console.error(`[summarize] LLM failed: ${err.message}`);

    // Fallback: return a truncated version of the input
    return {
      summary: 'Summarization unavailable.',
      key_points: [],
      original_length: originalLength,
      summary_length: 0
    };
  }
}

// ─── Response Parser ──────────────────────────────────────────────

/**
 * Parse the LLM's structured response into summary + key_points.
 * Handles variations in formatting (bold markers, different header styles).
 *
 * @param {string} text - Raw LLM output
 * @returns {{ summary: string, key_points: string[] }}
 */
function parseResponse(text) {
  let summary = '';
  let key_points = [];

  // Try to extract SUMMARY section
  const summaryMatch = text.match(/(?:SUMMARY|Summary)[:\s]*\n([\s\S]*?)(?=(?:KEY POINTS|Key Points|KEY_POINTS|\n-|\n\*)|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    // Fallback: use first paragraph
    summary = text.split('\n\n')[0]?.trim() || text.trim();
  }

  // Try to extract KEY POINTS section
  const keyPointsMatch = text.match(/(?:KEY POINTS|Key Points|KEY_POINTS)[:\s]*\n([\s\S]*?)$/i);
  if (keyPointsMatch) {
    key_points = keyPointsMatch[1].trim()
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*') || line.trim().match(/^\d+\./))
      .map(line => line.replace(/^[\s\-\*\d.]+/, '').trim())
      .map(line => line.replace(/\*\*/g, '').trim())
      .filter(Boolean);
  } else {
    // Fallback: look for any bulleted lines anywhere in the text
    key_points = text.split('\n')
      .filter(line => line.trim().startsWith('- ') || line.trim().startsWith('* '))
      .map(line => line.replace(/^[\s\-\*]+/, '').trim())
      .map(line => line.replace(/\*\*/g, '').trim())
      .filter(Boolean);
  }

  // Clean up summary — remove any bold markers or trailing headers
  summary = summary
    .replace(/\*\*/g, '')
    .replace(/KEY POINTS.*$/i, '')
    .trim();

  return { summary, key_points };
}
