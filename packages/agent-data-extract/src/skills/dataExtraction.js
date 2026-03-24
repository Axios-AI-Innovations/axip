/**
 * Agent Data Extract — Data Extraction Skill
 *
 * Fetches a web page and uses Ollama to extract structured data fields.
 *
 * Input:  { url: string, extract: string }
 *           e.g., extract="company name, pricing, features"
 * Output: { extracted: {key: value}, source_url: string, confidence: number }
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { route } from '../router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const extractConfig = config.extraction || {};

const FETCH_TIMEOUT_MS = extractConfig.fetch_timeout_ms || 15000;
const MAX_PAGE_CHARS = extractConfig.max_page_chars || 40000;

const FETCH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Extract structured data from a web page.
 *
 * @param {Object} params
 * @param {string} params.url - URL to fetch and extract from
 * @param {string} params.extract - Comma-separated fields to extract (e.g., "company name, pricing, features")
 * @returns {Promise<{ extracted: Object, source_url: string, confidence: number }>}
 */
export async function dataExtraction({ url, extract }) {
  if (!url || !url.trim()) {
    return { extracted: {}, source_url: '', confidence: 0, error: 'No URL provided.' };
  }

  if (!extract || !extract.trim()) {
    return { extracted: {}, source_url: url, confidence: 0, error: 'No extraction fields specified.' };
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { extracted: {}, source_url: url, confidence: 0, error: 'Only HTTP/HTTPS URLs are supported.' };
    }
  } catch {
    return { extracted: {}, source_url: url, confidence: 0, error: `Invalid URL: ${url}` };
  }

  // ── Fetch the page ────────────────────────────────────────────
  let pageText;
  try {
    pageText = await fetchPage(parsedUrl.href);
  } catch (err) {
    console.error(`[data-extract] Fetch failed for ${url}: ${err.message}`);
    return { extracted: {}, source_url: url, confidence: 0, error: `Fetch failed: ${err.message}` };
  }

  if (!pageText || pageText.trim().length === 0) {
    return { extracted: {}, source_url: url, confidence: 0, error: 'Page returned empty content.' };
  }

  console.log(`[data-extract] Fetched ${pageText.length} chars from ${url}`);

  // ── Extract with LLM ──────────────────────────────────────────
  const truncated = pageText.length > MAX_PAGE_CHARS
    ? pageText.slice(0, MAX_PAGE_CHARS) + '\n\n[Content truncated]'
    : pageText;

  const fieldsToExtract = extract.split(',').map(f => f.trim()).filter(Boolean);
  const fieldsList = fieldsToExtract.map(f => `  - "${f}"`).join('\n');

  const prompt = `You are a data extraction assistant. Extract the following fields from the web page content below.

Fields to extract:
${fieldsList}

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{
  "extracted": {
    "<field_name>": "<extracted_value_or_null>"
  },
  "confidence": <0.0_to_1.0>
}

Use null for fields that cannot be found. Be precise — extract exact values from the text.

Web page content from ${url}:
---
${truncated}
---`;

  try {
    const result = await route({
      prompt,
      system: 'You are a precise data extraction engine. Output only valid JSON. No markdown, no explanation.',
      taskName: 'data-extraction',
      maxTokens: extractConfig.max_output_tokens || 1024,
      temperature: extractConfig.temperature || 0.1
    });

    console.log(`[data-extract] LLM: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

    const parsed = parseExtractionResponse(result.text, fieldsToExtract);
    return {
      ...parsed,
      source_url: url
    };

  } catch (err) {
    console.error(`[data-extract] LLM failed: ${err.message}`);
    return {
      extracted: Object.fromEntries(fieldsToExtract.map(f => [f, null])),
      source_url: url,
      confidence: 0,
      error: `Extraction failed: ${err.message}`
    };
  }
}

// ─── Page Fetcher ─────────────────────────────────────────────────

async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();
    return stripHtml(html);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Page fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

/**
 * Strip HTML tags and clean up whitespace for LLM consumption.
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

// ─── Response Parser ──────────────────────────────────────────────

function parseExtractionResponse(text, expectedFields) {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    console.warn('[data-extract] Could not find JSON object in LLM response');
    return {
      extracted: Object.fromEntries(expectedFields.map(f => [f, null])),
      confidence: 0
    };
  }

  try {
    const parsed = JSON.parse(objMatch[0]);

    const extracted = {};
    for (const field of expectedFields) {
      // Try exact match, then case-insensitive match
      const value = parsed.extracted?.[field]
        ?? parsed.extracted?.[field.toLowerCase()]
        ?? parsed.extracted?.[field.replace(/\s+/g, '_')]
        ?? null;
      extracted[field] = value !== undefined ? value : null;
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : _estimateConfidence(extracted);

    return {
      extracted,
      confidence: Math.round(confidence * 100) / 100
    };
  } catch (err) {
    console.warn(`[data-extract] Failed to parse JSON: ${err.message}`);
    return {
      extracted: Object.fromEntries(expectedFields.map(f => [f, null])),
      confidence: 0
    };
  }
}

function _estimateConfidence(extracted) {
  const values = Object.values(extracted);
  if (values.length === 0) return 0;
  const found = values.filter(v => v !== null && v !== '').length;
  return found / values.length;
}
