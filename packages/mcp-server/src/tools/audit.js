/**
 * @axip/mcp-server — audit_company tool
 *
 * Customer-facing surface for the Axios AI Innovations AI Readiness
 * Audit. Any MCP-compatible agent (Claude Desktop, Cursor, custom)
 * calls this tool with a structured intake payload; the tool routes
 * via AXIP `task_request` to the AXIP network where Eli (or any
 * agent advertising the `audit_company` capability) bids on it,
 * runs runAssessmentV2() against the v2 prompt set, and returns
 * the audit report.
 *
 * Defenses (per THREAT_MODEL.md):
 *   - Zod .strict() on the input — unknown keys throw, not ignored
 *   - Per-field length caps so a 10MB description can't exhaust LLM
 *     context budget on the worker side
 *   - Output schema enforced before passthrough — if Eli returns
 *     something that isn't shaped right, we surface an error rather
 *     than pass through possibly-malicious content
 *   - 5-minute hard timeout on the AXIP round-trip
 *   - PII scrubber applied before any local logging
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { fenceInput, scrubPIIDeep } from '../security.js';

const AUDIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for the full round-trip

// ─── Input schema ──────────────────────────────────────────────────
//
// Mirrors the OUTPUT structure of prompts/v2/intake-questions.md.
// Strict mode: any extra key is rejected (defense against schema
// drift attempts and prompt-injection-via-extra-fields).

const OrgSchema = z.object({
  ai_tools_in_use:             z.string().max(2000).optional().default(''),
  custom_ai_deployed:          z.string().max(2000).optional().default(''),
  decision_maker_review_style: z.string().max(1000).optional().default(''),
  staff_sentiment:             z.string().max(1000).optional().default(''),
  data_owner:                  z.string().max(500).optional().default(''),
  internal_champion:           z.string().max(500).optional().default(''),
}).strict();

const WorkflowSchema = z.object({
  name:                        z.string().min(1).max(200),
  description:                 z.string().max(2000).optional().default(''),
  frequency:                   z.string().max(200).optional().default(''),
  volume_per_run:              z.string().max(200).optional().default(''),
  data_location:               z.string().max(1000).optional().default(''),
  judgment_pct:                z.string().max(200).optional().default(''),
  failure_impact:              z.string().max(2000).optional().default(''),
  human_review_before_output:  z.string().max(500).optional().default(''),
  regulated_data:              z.string().max(500).optional().default(''),
  error_catch_process:         z.string().max(2000).optional().default(''),
  tools_touched:               z.string().max(1000).optional().default(''),
  time_to_measurable_value:    z.string().max(500).optional().default(''),
  cost_of_20pct_improvement:   z.string().max(500).optional().default(''),
}).strict();

export const AuditCompanyInputSchema = z.object({
  client_name: z.string().min(1).max(200),
  industry:    z.string().max(200).optional().default(''),
  report_tier: z.enum(['tier1', 'tier2']).default('tier1'),
  intake: z.object({
    org:                  OrgSchema,
    workflows:            z.array(WorkflowSchema).min(1).max(15), // 1–15 workflows per audit
    additional_workflows: z.string().max(2000).optional().default(''),
    success_criteria:     z.string().max(2000).optional().default(''),
  }).strict(),
}).strict();

// ─── Output schema ────────────────────────────────────────────────
//
// What we expect back from Eli through the relay. If Eli returns
// something that doesn't match, we fail closed.

const CompositeSchema = z.object({
  workflow_name:   z.string(),
  composite_score: z.number(),
  base_tier:       z.string(),
  tier:            z.string(),
  scores:          z.record(z.string(), z.number()),
}).passthrough();

const AuditOutputSchema = z.object({
  audit_id:        z.string(),
  report_tier:     z.string(),
  composites:      z.array(CompositeSchema),
  report_markdown: z.string(),
}).passthrough();

// ─── Tool registration ────────────────────────────────────────────

/**
 * Register the audit_company tool on an MCP server.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@axip/sdk').AXIPAgent} agent
 */
export function registerAuditTool(server, agent) {
  server.tool(
    'audit_company',
    'Run an AI Readiness Audit on a company. Returns a multi-page markdown report (Tier 1: 5–7 pages, Tier 2: 15–20 pages) with 8-dimension scoring (org-level + per-workflow), composite tier classification (Quick Win / Strategic Play / Foundation First / Not Ready), and a recommended next step. Routes via AXIP — any agent advertising the audit_company capability can fulfill.',
    AuditCompanyInputSchema.shape,
    async (input) => {
      const taskId = `task_audit_${randomUUID()}`;
      const startTime = Date.now();

      // Belt-and-suspenders: re-validate (the SDK should already have
      // done this from .shape, but if a future SDK change loosens
      // validation, we fail closed here).
      const parsed = AuditCompanyInputSchema.safeParse(input);
      if (!parsed.success) {
        return errorResult(taskId, `Invalid input: ${parsed.error.message}`);
      }
      const validated = parsed.data;

      try {
        // Send the task_request with the structured intake. Eli's
        // task_request handler reads taskInfo.payload.intake etc.
        agent.send('task_request', 'network', {
          task_id: taskId,
          capability_required: 'audit_company',
          // `description` is the human-readable label most agents log
          description: `AI Readiness Audit for ${validated.client_name}`,
          // Structured payload that Eli's audit_company branch consumes
          client_name: validated.client_name,
          industry: validated.industry,
          report_tier: validated.report_tier,
          intake: validated.intake,
          // Keep the description fenced for defensive consistency even
          // though the intake fields are themselves structured/validated
          fenced_description: fenceInput(validated.client_name, 'client_name'),
          constraints: {},
          reward: 0,
        });

        // Wait for the first bid (Eli should auto-bid immediately)
        const bid = await waitForEvent(agent, 'task_bid',
          (m) => m.payload?.task_id === taskId,
          AUDIT_TIMEOUT_MS / 6);

        const bidderAgentId = bid.from.agent_id;
        agent.acceptBid(bidderAgentId, taskId, bid.payload.bid_id);

        // Wait for the audit result (Eli runs runAssessmentV2 inline)
        const remainingMs = AUDIT_TIMEOUT_MS - (Date.now() - startTime);
        const resultMsg = await waitForEvent(agent, 'task_result',
          (m) => m.payload?.task_id === taskId,
          Math.max(remainingMs, 30_000));

        const payload = resultMsg.payload;

        if (payload.status === 'failed' || payload.output?.error) {
          return errorResult(taskId, payload.output?.error || 'Worker reported task failure', {
            audit_id: payload.output?.auditId || null,
          });
        }

        // Validate the worker's response shape — if it doesn't match,
        // surface that as an error rather than pass it through.
        const outValidation = AuditOutputSchema.safeParse(payload.output);
        if (!outValidation.success) {
          return errorResult(taskId,
            `Worker returned unexpected output shape: ${outValidation.error.message}`);
        }
        const out = outValidation.data;

        const totalSec = Math.round((Date.now() - startTime) / 1000);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: taskId,
              status: 'completed',
              audit_id: out.audit_id,
              report_tier: out.report_tier,
              top_composites: out.composites
                .slice()
                .sort((a, b) => b.composite_score - a.composite_score)
                .slice(0, 3)
                .map(c => ({ workflow: c.workflow_name, score: c.composite_score, tier: c.tier })),
              report_markdown: out.report_markdown,
              cost_usd: payload.actual_cost_usd ?? bid.payload.price_usd ?? 0,
              duration_seconds: totalSec,
              agent_used: bidderAgentId,
            }, null, 2),
          }],
        };
      } catch (err) {
        console.warn('[audit_company] failed:', scrubPIIDeep({ taskId, error: err.message }));
        return errorResult(taskId, err.message);
      }
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function errorResult(taskId, message, extra = {}) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        task_id: taskId,
        status: 'failed',
        error: message,
        ...extra,
      }, null, 2),
    }],
    isError: true,
  };
}

function waitForEvent(agent, eventName, matcher, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      agent.off(eventName, listener);
      reject(new Error(`Timed out waiting for ${eventName} after ${timeoutMs}ms`));
    }, timeoutMs);
    function listener(msg) {
      if (!matcher(msg)) return;
      clearTimeout(timeout);
      agent.off(eventName, listener);
      resolve(msg);
    }
    agent.on(eventName, listener);
  });
}
