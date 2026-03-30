/**
 * Agent Summarize — Summarization Skill (Live, URL-aware)
 *
 * Real LLM-powered text summarization via local Ollama (qwen3:14b).
 * Supports two input modes:
 *   1. Plain text — summarize raw text passed in the description
 *   2. URL-aware — detect/accept a URL, fetch the page, then summarize
 *
 * Input resolution order:
 *   1. constraints.url (structured input from task requester)
 *   2. URL detected in description (starts with http/https)
 *   3. Plain text in description
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

const FETCH_TIMEOUT_MS = summarizeConfig.fetch_timeout_ms || 15000;
const MAX_PAGE_CHARS = summarizeConfig.max_page_chars || 40000;
const MAX_INPUT_CHARS = summarizeConfig.max_input_chars || 16000;
const FETCH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── URL Detection ────────────────────────────────────────────────

/**
 * Detect if a string is (or starts with) an HTTP/HTTPS URL.
 * Also handles "Summarize https://..." style descriptions.
 *
 * @param {string} text
 * @returns {{ isUrl: boolean, url: string|null }}
 */
function detectUrl(text) {
  if (!text) return { isUrl: false, url: null };

  const directMatch = text.trim().match(/^(https?:\/\/[^\s]+)/i);
  if (directMatch) return { isUrl: true, url: directMatch[1] };

  const prefixedMatch = text.match(/(?:summarize|summary of|sum up|tldr)[:\s]+((https?:\/\/[^\s]+))/i);
  if (prefixedMatch) return { isUrl: true, url: prefixedMatch[1] };

  return { isUrl: false, url: null };
}

// ─── Page Fetcher ─────────────────────────────────────────────────

/**
 * Fetch a web page and extract clean text (strip HTML tags).
 *
 * @param {string} url - HTTP/HTTPS URL to fetch
 * @returns {Promise<{ text: string, title: string, url: string }>}
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': FETCH_USER_AGENT },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    const truncated = text.length > MAX_PAGE_CHARS
      ? text.slice(0, MAX_PAGE_CHARS) + '\n\n[Content truncated]'
      : text;

    return { text: truncated, title, url };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError' ? `Fetch timed out after ${FETCH_TIMEOUT_MS}ms` : err.message;
    throw new Error(`Failed to fetch ${url}: ${msg}`);
  }
}

// ─── Main Summarize Function ──────────────────────────────────────

/**
 * Summarize text or a URL using the local LLM.
 *
 * @param {string} description - Task description (plain text or URL)
 * @param {Object} [constraints] - Optional structured params: { url?: string, style?: string }
 * @returns {Promise<{ summary: string, key_points: string[], original_length: number, summary_length: number, source_url?: string, source_title?: string }>}
 */
export async function summarize(description, constraints = {}) {
  let textToSummarize = description || '';
  let sourceUrl = null;
  let sourceTitle = null;

  // Priority 1: structured URL from constraints
  if (constraints?.url) {
    const urlStr = constraints.url.trim();
    try {
      new URL(urlStr);
      console.log(`[summarize] Fetching URL from constraints: ${urlStr}`);
      const page = await fetchPage(urlStr);
      textToSummarize = `Title: ${page.title}\n\n${page.text}`;
      sourceUrl = urlStr;
      sourceTitle = page.title;
    } catch (err) {
      console.error(`[summarize] URL fetch failed: ${err.message}`);
      return {
        summary: `Failed to fetch URL: ${err.message}`,
        key_points: [],
        original_length: 0,
        summary_length: 0,
        source_url: urlStr,
        error: err.message
      };
    }
  } else {
    // Priority 2: URL detected in description
    const detected = detectUrl(description);
    if (detected.isUrl) {
      console.log(`[summarize] URL detected in description: ${detected.url}`);
      try {
        const page = await fetchPage(detected.url);
        textToSummarize = `Title: ${page.title}\n\n${page.text}`;
        sourceUrl = detected.url;
        sourceTitle = page.title;
      } catch (err) {
        console.error(`[summarize] URL fetch failed: ${err.message}`);
        return {
          summary: `Failed to fetch URL: ${err.message}`,
          key_points: [],
          original_length: 0,
          summary_length: 0,
          source_url: detected.url,
          error: err.message
        };
      }
    }
    // Priority 3: plain text (no change needed)
  }

  if (!textToSummarize || textToSummarize.trim().length === 0) {
    return {
      summary: 'No text provided for summarization.',
      key_points: [],
      original_length: 0,
      summary_length: 0
    };
  }

  // Truncate plain text input (URL content already truncated during fetch)
  if (!sourceUrl && textToSummarize.length > MAX_INPUT_CHARS) {
    textToSummarize = textToSummarize.slice(0, MAX_INPUT_CHARS) + '\n\n[Text truncated for length]';
  }

  const originalLength = textToSummarize.split(/\s+/).length;
  const sourceNote = sourceUrl ? `\nSource: ${sourceUrl}` : '';

  const prompt = `Summarize the following content concisely and accurately.${sourceNote}

Provide:
1. A clear summary (3-5 sentences capturing the main points)
2. Key points as a bulleted list (3-6 bullets, most important facts only)

Format your response exactly as:

SUMMARY:
[Your summary here]

KEY POINTS:
- [Point 1]
- [Point 2]
- [Point 3]

Content to summarize:

${textToSummarize}`;

  try {
    const result = await route({
      prompt,
      system: 'You are a precise summarization assistant. Extract the most important information. Be factual and concise. No filler phrases.',
      taskName: 'summarize',
      maxTokens: summarizeConfig.max_output_tokens || 768,
      temperature: summarizeConfig.temperature || 0.2
    });

    console.log(`[summarize] LLM: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms${sourceUrl ? ` (URL: ${sourceUrl.slice(0, 60)})` : ''}`);

    const parsed = parseResponse(result.text);
    const summaryLength = parsed.summary.split(/\s+/).length;

    const output = {
      summary: parsed.summary,
      key_points: parsed.key_points,
      original_length: originalLength,
      summary_length: summaryLength
    };

    if (sourceUrl) {
      output.source_url = sourceUrl;
      output.source_title = sourceTitle;
    }

    return output;
  } catch (err) {
    console.error(`[summarize] LLM failed: ${err.message}`);
    return {
      summary: 'Summarization unavailable.',
      key_points: [],
      original_length: originalLength,
      summary_length: 0,
      ...(sourceUrl && { source_url: sourceUrl })
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

  const summaryMatch = text.match(/(?:SUMMARY|Summary)[:\s]*\n([\s\S]*?)(?=(?:KEY POINTS|Key Points|KEY_POINTS|\n-|\n\*)|$)/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    summary = text.split('\n\n')[0]?.trim() || text.trim();
  }

  const keyPointsMatch = text.match(/(?:KEY POINTS|Key Points|KEY_POINTS)[:\s]*\n([\s\S]*?)$/i);
  if (keyPointsMatch) {
    key_points = keyPointsMatch[1].trim()
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*') || line.trim().match(/^\d+\./))
      .map(line => line.replace(/^[\s\-\*\d.]+/, '').trim())
      .map(line => line.replace(/\*\*/g, '').trim())
      .filter(Boolean);
  } else {
    key_points = text.split('\n')
      .filter(line => line.trim().startsWith('- ') || line.trim().startsWith('* '))
      .map(line => line.replace(/^[\s\-\*]+/, '').trim())
      .map(line => line.replace(/\*\*/g, '').trim())
      .filter(Boolean);
  }

  summary = summary
    .replace(/\*\*/g, '')
    .replace(/KEY POINTS.*$/i, '')
    .trim();

  return { summary, key_points };
}
