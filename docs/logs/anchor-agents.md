# AXIP Anchor Agents — Week 3, Day 4-5

**Date:** 2026-03-23
**Status:** ✅ Complete — 5 agents live on the network

---

## Summary

Built and deployed two new anchor agents (AGT-2 and AGT-3) and upgraded the Scout Beta agent (AGT-1) with production-grade improvements. All agents are running under PM2 and registered with the AXIP relay.

---

## AGT-1: Agent Beta (Scout) — Upgraded

**Package:** `packages/agent-beta/`
**PM2 name:** `agent-beta` (ID: 3)
**Capabilities:** `web_search`, `summarize`
**Pricing:** web_search=$0.03, summarize=$0.02

### Changes Made

1. **DDG retry with exponential backoff** — `gather()` now retries up to 3 times (1s → 2s → 4s) before returning empty results. Prevents transient failures from propagating.

2. **Ollama 30-second timeout** — Added `AbortController` around `ollamaClient.chat()` calls. Prevents hangs if Ollama is slow or overloaded. `AbortError` is caught and converted to a human-readable error.

3. **Confidence score in web_search output** — Both cached and fresh results now include `confidence: number` (average relevance of all results, 0.0–1.0). Structured output is now `{ query, results, total_results, search_duration_ms, confidence, cached }`.

4. **Clear activeTasks on reconnect** — Added `agent.connection.on('connected', ...)` handler that clears the `activeTasks` Map after a relay reconnect. Prevents stale task entries from accumulating across disconnects (memory leak fix from audit).

5. **Error response to requester** — Already present. Verified: `task_accept` catch block calls `agent.sendResult()` with `{ status: 'failed' }` so the requester doesn't hang.

---

## AGT-2: Agent Code Review — NEW

**Package:** `packages/agent-code-review/`
**PM2 name:** `agent-code-review` (ID: 10)
**Agent ID:** `code-review-xI1IqeSx`
**Capability:** `code_review`
**Pricing:** $0.05 per review
**Model:** `qwen3:14b` via Ollama

### Input
```json
{ "code": "string", "language": "string", "focus": "bugs|performance|style|security" }
```

### Output
```json
{
  "issues": [{ "severity": "critical|high|medium|low|info", "line": 3, "description": "...", "suggestion": "..." }],
  "summary": "2-3 sentence assessment",
  "quality_score": 7.5
}
```

### Test Result
Submitted a JS function with a deliberate assignment-instead-of-comparison bug (`if (result = 0)`). Agent returned:
- `quality_score: 3.5`
- 1 critical issue correctly identifying line 3 and the `=` vs `===` bug
- Accurate summary

### File Structure
```
packages/agent-code-review/
  package.json
  config/default.json
  src/
    index.js
    db.js
    router.js
    cost-tracker.js
    llm/ollama.js
    skills/codeReview.js
```

---

## AGT-3: Agent Data Extract — NEW

**Package:** `packages/agent-data-extract/`
**PM2 name:** `agent-data-extract` (ID: 11)
**Agent ID:** `data-extract-JqxBZmNT`
**Capability:** `data_extraction`
**Pricing:** $0.04 per extraction
**Model:** `qwen3:14b` via Ollama

### Input
```json
{ "url": "https://...", "extract": "company name, pricing, features" }
```

### Output
```json
{
  "extracted": { "company name": "Acme Corp", "pricing": "$99/mo", "features": "..." },
  "source_url": "https://...",
  "confidence": 0.87
}
```

### Error Handling
- Invalid URLs → immediate error response (no fetch attempt)
- Non-HTTP/HTTPS protocols → rejected
- Fetch timeout after 15s → error returned to requester
- Blocked pages / non-HTML content → error returned
- HTML stripped of scripts, styles, nav, footer before LLM sees it

### Test Result
Extracted from `https://example.com` with fields `page title, domain, purpose`:
- Confidence: 1.0
- All 3 fields extracted correctly

### File Structure
```
packages/agent-data-extract/
  package.json
  config/default.json
  src/
    index.js
    db.js
    router.js
    cost-tracker.js
    llm/ollama.js
    skills/dataExtraction.js
```

---

## PM2 Status (at completion)

| ID | Name              | Status | Uptime   | Restarts |
|----|-------------------|--------|----------|----------|
| 0  | eli               | online | 3D       | 0        |
| 2  | axip-relay        | online | 23h      | 13       |
| 3  | agent-beta        | online | 47h      | 4        |
| 4  | agent-gamma       | online | 47h      | 4        |
| 5  | agent-delta       | online | 47h      | 4        |
| 10 | agent-code-review | online | ~2min    | 0        |
| 11 | agent-data-extract| online | ~2min    | 0        |

---

## Capability Discovery Results

All 4 capabilities discoverable via relay:
- `web_search` → 2 agents (scout-beta instances)
- `summarize` → 2 agents (scout-beta instances)
- `code_review` → 1 agent (code-review-xI1IqeSx)
- `data_extraction` → 1 agent (data-extract-JqxBZmNT)

---

## Production Pricing Summary

| Capability    | Price  | Agent          |
|---------------|--------|----------------|
| web_search    | $0.030 | agent-beta     |
| summarize     | $0.020 | agent-beta     |
| classify      | TBD    | agent-gamma    |
| route         | TBD    | agent-gamma    |
| monitor       | TBD    | agent-delta    |
| alert         | TBD    | agent-delta    |
| code_review   | $0.050 | agent-code-review |
| data_extraction| $0.040| agent-data-extract |
