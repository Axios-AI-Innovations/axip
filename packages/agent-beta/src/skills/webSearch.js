/**
 * Agent Beta — Web Search Skill (Live)
 *
 * Real DuckDuckGo web search with LLM-powered summarization.
 * Replaces the mock webSearch.js with actual search results.
 *
 * Architecture (mirrors Eli's morning-briefing gather/process pattern):
 *   gather(query)   — Deterministic. Calls DuckDuckGo via duck-duck-scrape.
 *                      No LLM. Returns raw [{ title, url, snippet }].
 *   process(query, rawResults) — LLM-only. Asks qwen3:8b to summarize each
 *                      snippet and assign relevance scores. Returns
 *                      [{ title, url, summary, relevance }].
 *   webSearch(query) — Orchestrates: check cache → gather → process → cache → return.
 *
 * Cache: SHA-256 hash of normalized query. TTL from config (default 60 min).
 * Fallback: If LLM fails, returns raw DDG snippets with 0.5 relevance.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { route } from '../router.js';
import { getDb } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const config = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'default.json'), 'utf-8'));
const searchConfig = config.search || {};

const MAX_RESULTS = searchConfig.max_results || 8;
const CACHE_TTL_MINUTES = searchConfig.cache_ttl_minutes || 60;
const SEARCH_TIMEOUT_MS = searchConfig.timeout_ms || 10000;

// ─── Main Orchestrator ───────────────────────────────────────────

/**
 * Perform a real web search with LLM-powered summarization.
 * Checks cache first, then DDG → LLM → cache → return.
 *
 * @param {string} query - Search query (e.g., "Tesla recent news AI strategy funding")
 * @returns {Promise<{ query: string, results: Array<{ title, url, summary, relevance }>, total_results: number, search_duration_ms: number }>}
 */
export async function webSearch(query) {
  const startTime = Date.now();
  const normalizedQuery = query.trim().toLowerCase();
  const queryHash = createHash('sha256').update(normalizedQuery).digest('hex');

  // ── Check cache ──────────────────────────────────────────────
  const cached = getCachedResults(queryHash);
  if (cached) {
    const durationMs = Date.now() - startTime;
    const confidence = cached.length > 0
      ? cached.reduce((sum, r) => sum + (r.relevance || 0.5), 0) / cached.length
      : 0;
    console.log(`[web-search] Cache hit for "${query.slice(0, 50)}" (${cached.length} results, ${durationMs}ms)`);
    return {
      query,
      results: cached,
      total_results: cached.length,
      search_duration_ms: durationMs,
      confidence: Math.round(confidence * 100) / 100,
      cached: true
    };
  }

  // ── Step 1: Gather (DDG search, no LLM) ──────────────────────
  console.log(`[web-search] Searching DDG for: "${query.slice(0, 80)}"`);
  const rawResults = await gather(query);

  if (rawResults.length === 0) {
    const durationMs = Date.now() - startTime;
    console.log(`[web-search] No results from DDG for "${query.slice(0, 50)}"`);
    return {
      query,
      results: [],
      total_results: 0,
      search_duration_ms: durationMs,
      cached: false
    };
  }

  console.log(`[web-search] DDG returned ${rawResults.length} raw results`);

  // ── Step 2: Process (LLM summarization + relevance scoring) ──
  const processedResults = await process(query, rawResults);

  // ── Step 3: Post-process results ────────────────────────────
  // Filter out very low-relevance results, deduplicate by domain, sort by relevance
  const refinedResults = postProcess(processedResults);

  // ── Step 4: Cache results ────────────────────────────────────
  cacheResults(queryHash, normalizedQuery, refinedResults);

  const durationMs = Date.now() - startTime;
  const confidence = refinedResults.length > 0
    ? refinedResults.reduce((sum, r) => sum + (r.relevance || 0.5), 0) / refinedResults.length
    : 0;
  console.log(`[web-search] Complete: ${refinedResults.length} results in ${durationMs}ms (confidence: ${confidence.toFixed(2)})`);

  return {
    query,
    results: refinedResults,
    total_results: refinedResults.length,
    search_duration_ms: durationMs,
    confidence: Math.round(confidence * 100) / 100,
    cached: false
  };
}

// ─── Gather: DuckDuckGo Search (Deterministic, No LLM) ──────────

const DDG_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Search DuckDuckGo via HTML endpoint and return raw results.
 * Uses the HTML endpoint (html.duckduckgo.com) which is more reliable
 * than the JSON API (which gets rate-limited quickly).
 * No LLM calls. Retries up to 3 times with exponential backoff on failure.
 *
 * @param {string} query - Search query
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
 */
async function gather(query) {
  const MAX_RETRIES = 3;
  let delay = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: { 'User-Agent': DDG_USER_AGENT },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`DDG HTTP ${response.status}`);
      }

      const html = await response.text();
      const results = parseDDGHtml(html);

      if (results.length === 0) {
        console.warn('[web-search] DDG returned no results');
      }

      return results.slice(0, MAX_RESULTS);
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`[web-search] DDG failed after ${MAX_RETRIES} attempts: ${err.message}`);
        return [];
      }
      console.warn(`[web-search] DDG attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2; // exponential backoff: 1s → 2s → 4s
    }
  }
  return [];
}

/**
 * Parse DuckDuckGo HTML search results page.
 * Extracts titles, URLs, and snippets from the HTML response.
 *
 * @param {string} html - Raw HTML from html.duckduckgo.com
 * @returns {Array<{ title: string, url: string, snippet: string }>}
 */
function parseDDGHtml(html) {
  const results = [];

  // Extract result links and titles
  const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let resultUrl = match[1];
    // Decode DDG redirect URLs: //duckduckgo.com/l/?uddg=ENCODED_URL&...
    if (resultUrl.includes('uddg=')) {
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        resultUrl = decodeURIComponent(uddgMatch[1]);
      }
    }
    links.push({
      url: resultUrl,
      title: match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim()
    });
  }

  const snippets = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(
      match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim()
    );
  }

  for (let i = 0; i < links.length; i++) {
    if (links[i].url && links[i].title) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || ''
      });
    }
  }

  return results;
}

// ─── Process: LLM Summarization + Relevance Scoring ──────────────

/**
 * Ask the LLM to summarize each search result snippet and assign
 * a relevance score (0.0–1.0) relative to the query.
 *
 * On LLM failure: falls back to raw DDG snippets with 0.5 relevance.
 *
 * @param {string} query - Original search query
 * @param {Array<{ title, url, snippet }>} rawResults - DDG results from gather()
 * @returns {Promise<Array<{ title, url, summary, relevance }>>}
 */
async function process(query, rawResults) {
  // Build prompt with all snippets
  const snippetBlock = rawResults.map((r, i) =>
    `[${i}] Title: ${r.title}\nSnippet: ${r.snippet}`
  ).join('\n\n');

  const prompt = `You are analyzing search results for the query: "${query}"

Here are the search result snippets:

${snippetBlock}

For each search result, write a 1-2 sentence factual summary and assign a relevance score (0.0-1.0) to the query. Respond ONLY as a JSON array, no other text:
[{ "index": 0, "summary": "...", "relevance": 0.85 }, ...]`;

  try {
    const result = await route({
      prompt,
      system: 'You are a search result analyst. Output only valid JSON arrays. No markdown, no explanation.',
      taskName: 'web-search-summarize',
      maxTokens: searchConfig.max_output_tokens || 1500,
      temperature: 0.3
    });

    console.log(`[web-search] LLM summarization: ${result.model}, ${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms`);

    // Parse LLM response into structured data
    const parsed = parseLLMSummaries(result.text, rawResults.length);

    // Merge LLM summaries back with raw results
    return rawResults.map((r, i) => {
      const llmData = parsed.find(p => p.index === i);
      return {
        title: r.title,
        url: r.url,
        summary: llmData?.summary || r.snippet,
        relevance: llmData?.relevance ?? 0.5
      };
    });
  } catch (err) {
    // LLM failed — fall back to raw snippets with default relevance
    console.error(`[web-search] LLM summarization failed: ${err.message}`);
    console.log('[web-search] Falling back to raw DDG snippets');

    return rawResults.map(r => ({
      title: r.title,
      url: r.url,
      summary: r.snippet,
      relevance: 0.5
    }));
  }
}

// ─── LLM Response Parser ─────────────────────────────────────────

/**
 * Parse the LLM's JSON response. Handles common quirks:
 * - Markdown code fences (```json ... ```)
 * - Extra text before/after the JSON array
 * - Missing or malformed entries
 *
 * @param {string} text - Raw LLM output
 * @param {number} expectedCount - Number of results expected
 * @returns {Array<{ index: number, summary: string, relevance: number }>}
 */
function parseLLMSummaries(text, expectedCount) {
  // Strip markdown code fences if present
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find a JSON array in the text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.warn('[web-search] Could not find JSON array in LLM response');
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]);

    if (!Array.isArray(parsed)) {
      console.warn('[web-search] LLM response is not an array');
      return [];
    }

    // Validate and normalize each entry
    return parsed
      .filter(item => typeof item.index === 'number' && item.index >= 0 && item.index < expectedCount)
      .map(item => ({
        index: item.index,
        summary: String(item.summary || '').trim(),
        relevance: clampRelevance(item.relevance)
      }));
  } catch (err) {
    console.warn(`[web-search] Failed to parse LLM JSON: ${err.message}`);
    return [];
  }
}

/**
 * Post-process LLM-scored results:
 * - Filter results with relevance < 0.25 (clearly off-topic)
 * - Deduplicate by domain (keep highest-relevance result per domain)
 * - Sort by relevance descending
 *
 * Falls back gracefully: if all filtered out, returns original sorted.
 *
 * @param {Array<{ title, url, summary, relevance }>} results
 * @returns {Array<{ title, url, summary, relevance }>}
 */
function postProcess(results) {
  if (results.length === 0) return results;

  // Deduplicate by domain — keep highest relevance per domain
  const seen = new Map();
  for (const r of results) {
    let domain = r.url;
    try {
      domain = new URL(r.url).hostname.replace(/^www\./, '');
    } catch { /* use raw url as key */ }
    const existing = seen.get(domain);
    if (!existing || r.relevance > existing.relevance) {
      seen.set(domain, r);
    }
  }
  const deduped = Array.from(seen.values());

  // Filter low-relevance results
  const MIN_RELEVANCE = 0.25;
  const filtered = deduped.filter(r => r.relevance >= MIN_RELEVANCE);

  // If filtering removed everything, keep originals (safety fallback)
  const final = filtered.length > 0 ? filtered : deduped;

  // Sort by relevance descending
  return final.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Clamp relevance to [0.0, 1.0]. Handle both 0.85 and 85 formats.
 */
function clampRelevance(value) {
  if (typeof value !== 'number' || isNaN(value)) return 0.5;
  if (value > 1) value = value / 100; // Handle "85" → 0.85
  return Math.max(0, Math.min(1, value));
}

// ─── Cache Layer ─────────────────────────────────────────────────

/**
 * Check for cached search results.
 * Returns null if no valid cache entry exists.
 *
 * @param {string} queryHash - SHA-256 hash of the normalized query
 * @returns {Array|null} Cached results or null
 */
function getCachedResults(queryHash) {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT results, cached_at FROM search_cache
      WHERE query_hash = ?
        AND datetime(cached_at, '+' || ? || ' minutes') > datetime('now')
    `).get(queryHash, CACHE_TTL_MINUTES);

    if (row) {
      return JSON.parse(row.results);
    }
  } catch (err) {
    // Cache read failure is non-fatal
    console.error(`[web-search] Cache read error: ${err.message}`);
  }
  return null;
}

/**
 * Store search results in the cache.
 *
 * @param {string} queryHash - SHA-256 hash of the normalized query
 * @param {string} query - Original normalized query
 * @param {Array} results - Processed search results to cache
 */
function cacheResults(queryHash, query, results) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO search_cache (query_hash, query, results, result_count, cached_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(queryHash, query, JSON.stringify(results), results.length);

    console.log(`[web-search] Results cached (hash: ${queryHash.slice(0, 12)}…)`);
  } catch (err) {
    // Cache write failure is non-fatal
    console.error(`[web-search] Cache write error: ${err.message}`);
  }
}
