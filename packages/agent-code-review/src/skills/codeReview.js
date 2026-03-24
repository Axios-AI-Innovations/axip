/**
 * Agent Code Review — Code Review Skill
 *
 * Uses qwen3:14b to review code snippets and return structured feedback.
 *
 * Input:  { code: string, language: string, focus?: "bugs"|"performance"|"style"|"security" }
 * Output: { issues: [{severity, line, description, suggestion}], summary, quality_score }
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { route } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const reviewConfig = config.code_review || {};

const FOCUS_DESCRIPTIONS = {
  bugs: 'functional bugs, logic errors, null pointer risks, off-by-one errors, incorrect conditionals',
  performance: 'performance bottlenecks, inefficient algorithms, memory leaks, unnecessary allocations, slow patterns',
  style: 'code style, naming conventions, readability, dead code, overly complex constructs, documentation',
  security: 'security vulnerabilities, injection risks, authentication flaws, insecure data handling, exposed secrets'
};

/**
 * Review a code snippet using the local LLM.
 *
 * @param {Object} params
 * @param {string} params.code - Code to review
 * @param {string} params.language - Programming language (e.g., "javascript", "python")
 * @param {string} [params.focus] - Review focus: "bugs"|"performance"|"style"|"security"
 * @returns {Promise<{ issues: Array<{severity, line, description, suggestion}>, summary: string, quality_score: number }>}
 */
export async function codeReview({ code, language, focus }) {
  if (!code || code.trim().length === 0) {
    return {
      issues: [],
      summary: 'No code provided for review.',
      quality_score: 0
    };
  }

  // Truncate if too long
  const maxChars = reviewConfig.max_input_chars || 32000;
  const truncated = code.length > maxChars
    ? code.slice(0, maxChars) + '\n\n// [Code truncated — too long for single review]'
    : code;

  const focusText = focus && FOCUS_DESCRIPTIONS[focus]
    ? `Focus specifically on: ${FOCUS_DESCRIPTIONS[focus]}.`
    : 'Review for bugs, performance, style, and security issues.';

  const prompt = `You are an expert ${language || 'software'} code reviewer. Review the following code snippet.
${focusText}

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{
  "issues": [
    {
      "severity": "critical|high|medium|low|info",
      "line": <line_number_or_null>,
      "description": "<what the issue is>",
      "suggestion": "<how to fix it>"
    }
  ],
  "summary": "<2-3 sentence overall assessment>",
  "quality_score": <0.0_to_10.0>
}

Code to review (${language || 'unknown language'}):
\`\`\`${language || ''}
${truncated}
\`\`\``;

  try {
    const result = await route({
      prompt,
      system: 'You are a strict code reviewer. Output only valid JSON. No markdown fences, no explanation outside the JSON.',
      taskName: 'code-review',
      maxTokens: reviewConfig.max_output_tokens || 2048,
      temperature: reviewConfig.temperature || 0.2
    });

    console.log(`[code-review] LLM: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

    const parsed = parseReviewResponse(result.text);
    return parsed;

  } catch (err) {
    console.error(`[code-review] LLM failed: ${err.message}`);
    return {
      issues: [{
        severity: 'info',
        line: null,
        description: 'Review unavailable due to LLM error.',
        suggestion: `Error: ${err.message}`
      }],
      summary: 'Code review could not be completed due to an internal error.',
      quality_score: 0
    };
  }
}

// ─── Response Parser ──────────────────────────────────────────────

function parseReviewResponse(text) {
  // Strip markdown code fences if present
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Extract first JSON object
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    console.warn('[code-review] Could not find JSON object in LLM response');
    return _fallbackResponse('No JSON found in response.');
  }

  try {
    const parsed = JSON.parse(objMatch[0]);

    // Normalize issues array
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(issue => ({
          severity: _normalizeSeverity(issue.severity),
          line: typeof issue.line === 'number' ? issue.line : null,
          description: String(issue.description || '').trim(),
          suggestion: String(issue.suggestion || '').trim()
        })).filter(i => i.description)
      : [];

    const qualityScore = typeof parsed.quality_score === 'number'
      ? Math.max(0, Math.min(10, parsed.quality_score))
      : _estimateQualityScore(issues);

    return {
      issues,
      summary: String(parsed.summary || 'Review complete.').trim(),
      quality_score: Math.round(qualityScore * 10) / 10
    };
  } catch (err) {
    console.warn(`[code-review] Failed to parse JSON: ${err.message}`);
    return _fallbackResponse('JSON parse error.');
  }
}

function _normalizeSeverity(value) {
  const valid = ['critical', 'high', 'medium', 'low', 'info'];
  const normalized = String(value || '').toLowerCase();
  return valid.includes(normalized) ? normalized : 'info';
}

function _estimateQualityScore(issues) {
  if (issues.length === 0) return 9.0;
  const weights = { critical: 3, high: 2, medium: 1, low: 0.5, info: 0 };
  const penalty = issues.reduce((sum, i) => sum + (weights[i.severity] || 0), 0);
  return Math.max(0, 10 - penalty);
}

function _fallbackResponse(reason) {
  return {
    issues: [{ severity: 'info', line: null, description: reason, suggestion: 'Retry the review.' }],
    summary: 'Review could not be parsed.',
    quality_score: 0
  };
}
