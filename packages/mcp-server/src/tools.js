/**
 * AXIP MCP Server — Tool Definitions
 *
 * Exposes AXIP marketplace capabilities as MCP tools.
 * Uses McpServer's .tool() API with Zod schema validation.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { registerAuditTool } from './tools/audit.js';

const TASK_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Register all AXIP tools on the MCP server.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@axip/sdk').AXIPAgent} agent
 */
export function registerTools(server, agent) {

  // Customer-facing audit tool — wraps AXIP request_task with the
  // structured intake schema. See src/tools/audit.js for input/output
  // schema, security defenses, and timeout handling.
  registerAuditTool(server, agent);


  // ─── axip_discover ──────────────────────────────────────────────

  server.tool(
    'axip_discover_agents',
    'Find agents on the AXIP network by capability. Returns a list of available agents with their pricing and reputation.',
    {
      capability: z.string().describe('The capability to search for (e.g. "web_search", "code_review", "data_analysis")'),
      max_cost: z.number().optional().describe('Maximum cost in USD per task'),
      min_reputation: z.number().min(0).max(1).optional().describe('Minimum reputation score 0-1')
    },
    async ({ capability, max_cost, min_reputation }) => {
      try {
        const constraints = {};
        if (max_cost !== undefined) constraints.max_cost = max_cost;
        if (min_reputation !== undefined) constraints.min_reputation = min_reputation;

        const result = await agent.discover(capability, constraints);
        const agents = result?.payload?.agents || [];

        const formatted = agents.map(a => ({
          agent_id: a.agent_id,
          name: a.name || a.agent_id,
          capabilities: a.capabilities || [capability],
          pricing: a.pricing || {},
          reputation: a.reputation ?? null
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ agents: formatted, count: formatted.length }, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: err.message, agents: [] }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ─── axip_request_task ──────────────────────────────────────────

  server.tool(
    'axip_request_task',
    'Submit a task to the AXIP network and wait for the result. Handles the full lifecycle: discovery → bid selection → execution → result. Timeout: 60 seconds.',
    {
      capability: z.string().describe('The capability required for this task (e.g. "web_search", "code_review")'),
      description: z.string().describe('Detailed description of the task to perform'),
      max_cost: z.number().optional().describe('Maximum amount in USD willing to pay')
    },
    async ({ capability, description, max_cost }) => {
      const taskId = `task_${randomUUID()}`;
      const startTime = Date.now();

      try {
        // Step 1: Broadcast task request to network
        const constraints = {};
        if (max_cost !== undefined) constraints.max_cost = max_cost;

        agent.send('task_request', 'network', {
          task_id: taskId,
          description,
          capability_required: capability,
          constraints,
          reward: max_cost || 0
        });

        // Step 2: Wait for first bid (auto-accept best)
        const bid = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            agent.off('task_bid', onBid);
            reject(new Error('No bids received within 30 seconds'));
          }, TASK_TIMEOUT_MS / 2);

          function onBid(msg) {
            if (msg.payload?.task_id !== taskId) return;
            clearTimeout(timeout);
            agent.off('task_bid', onBid);
            resolve(msg);
          }

          agent.on('task_bid', onBid);
        });

        // Step 3: Accept the bid
        const bidId = bid.payload.bid_id;
        const bidderAgentId = bid.from.agent_id;
        agent.acceptBid(bidderAgentId, taskId, bidId);

        // Step 4: Wait for result
        const resultMsg = await new Promise((resolve, reject) => {
          const remaining = TASK_TIMEOUT_MS - (Date.now() - startTime);
          const timeout = setTimeout(() => {
            agent.off('task_result', onResult);
            reject(new Error('Task execution timed out after 60 seconds'));
          }, Math.max(remaining, 5000));

          function onResult(msg) {
            if (msg.payload?.task_id !== taskId) return;
            clearTimeout(timeout);
            agent.off('task_result', onResult);
            resolve(msg);
          }

          agent.on('task_result', onResult);
        });

        const payload = resultMsg.payload;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: taskId,
              status: payload.status || 'completed',
              result: payload.output,
              cost: payload.actual_cost_usd ?? bid.payload.price_usd ?? 0,
              agent_used: bidderAgentId
            }, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: taskId,
              status: 'failed',
              result: null,
              cost: 0,
              agent_used: null,
              error: err.message
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ─── axip_check_balance ─────────────────────────────────────────

  server.tool(
    'axip_check_balance',
    'Check the current credit balance and spending summary for this AXIP agent.',
    {},
    async () => {
      try {
        const msg = agent.send('balance_request', 'relay', {});

        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            agent.off('balance_result', onResult);
            resolve({
              balance_usd: 0,
              total_earned: 0,
              total_spent: 0,
              note: 'Balance endpoint not yet supported by relay'
            });
          }, 5000);

          function onResult(m) {
            if (m.type !== 'balance_result') return;
            clearTimeout(timeout);
            agent.off('balance_result', onResult);
            resolve(m.payload);
          }

          agent.on('balance_result', onResult);
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // ─── axip_network_status ────────────────────────────────────────

  server.tool(
    'axip_network_status',
    'Get an overview of the AXIP network: online agents, available capabilities, and activity stats.',
    {},
    async () => {
      try {
        agent.send('status_request', 'relay', {});

        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            agent.off('status_result', onResult);
            resolve({
              agents_online: 0,
              total_agents: 0,
              capabilities: [],
              tasks_today: 0,
              note: 'Status endpoint not yet supported by relay'
            });
          }, 5000);

          function onResult(m) {
            if (m.type !== 'status_result') return;
            clearTimeout(timeout);
            agent.off('status_result', onResult);
            resolve(m.payload);
          }

          agent.on('status_result', onResult);
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2)
          }],
          isError: true
        };
      }
    }
  );
}
