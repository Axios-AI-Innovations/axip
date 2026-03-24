/**
 * Agent Alpha (Eli) — Prospect Research Agent
 *
 * The "smart" agent in the demo. Receives prospect_research requests,
 * delegates web_search to the network, then compiles a research report.
 *
 * This demonstrates AXIP's core value proposition: an agent that lacks
 * a capability can discover and delegate to another agent that has it.
 *
 * Behavior:
 *   1. Connects to relay, announces: prospect_research
 *   2. Receives task_request → auto-bids
 *   3. On acceptance → discovers web_search agents → delegates
 *   4. Receives search results → compiles report → delivers
 */

import { AXIPAgent } from '@axip/sdk';
import chalk from 'chalk';
import { compileReport } from './skills/prospectResearch.js';

const PREFIX = chalk.magenta('[ALPHA]');

// Track our active tasks and sub-task correlation
const activeTasks = new Map();    // taskId -> task info
const subTaskMap = new Map();     // subTaskId -> parentTaskId

async function main() {
  const agent = new AXIPAgent({
    name: 'eli-alpha',
    capabilities: ['prospect_research'],
    pricing: {
      prospect_research: { base_usd: 0.15 }
    }
  });

  // ─── Handle incoming task requests — auto-bid ─────────────────
  agent.on('task_request', async (msg) => {
    const taskId = msg.payload.task_id;
    const capability = msg.payload.capability_required;

    // Only handle prospect_research
    if (capability !== 'prospect_research') {
      console.log(`${PREFIX}  ${chalk.gray('Ignoring task for capability:')} ${capability}`);
      return;
    }

    console.log(`${PREFIX}  ${chalk.bold('◄')} Received task: prospect_research — "${msg.payload.description}"`);

    const bidMsg = agent.sendBid(msg.from.agent_id, taskId, {
      price: 0.10,
      etaSeconds: 30,
      confidence: 0.85,
      model: 'local-template',
      message: 'I can research this prospect. Will delegate web search to the network.'
    });

    activeTasks.set(taskId, {
      description: msg.payload.description,
      requesterId: msg.from.agent_id,
      bidId: bidMsg.payload.bid_id,
      startTime: Date.now()
    });

    console.log(`${PREFIX}  ${chalk.bold('►')} Bid sent: $0.10, ETA 30s`);
  });

  // ─── Handle task acceptance — delegate web search ─────────────
  agent.on('task_accept', async (msg) => {
    const taskId = msg.payload.task_id;
    const taskInfo = activeTasks.get(taskId);

    if (!taskInfo) {
      console.warn(`${PREFIX} Accepted unknown task: ${taskId}`);
      return;
    }

    console.log(`${PREFIX}  ${chalk.green('✓')} Task accepted! Starting research...`);

    // Step 1: Discover web_search agents
    console.log(`${PREFIX}  ${chalk.gray('…')} Discovering web_search agents...`);

    try {
      const discovered = await agent.discover('web_search');
      const searchAgents = discovered.payload.agents;

      if (!searchAgents || searchAgents.length === 0) {
        console.log(`${PREFIX}  ${chalk.red('✗')} No web_search agents available!`);
        agent.sendResult(taskInfo.requesterId, taskId, {
          error: 'No web_search agents available on the network'
        }, { status: 'failed' });
        activeTasks.delete(taskId);
        return;
      }

      const bestAgent = searchAgents[0];
      console.log(`${PREFIX}  ${chalk.green('✓')} Found: ${bestAgent.agent_id} (reputation: ${bestAgent.reputation})`);

      // Step 2: Delegate web search sub-task
      const subTaskId = `subtask_${taskId}`;
      console.log(`${PREFIX}  ${chalk.bold('►')} Delegating web_search to ${bestAgent.agent_id}`);

      // Store correlation
      subTaskMap.set(subTaskId, taskId);
      taskInfo.searchAgentId = bestAgent.agent_id;

      agent.send('task_request', 'relay', {
        task_id: subTaskId,
        description: taskInfo.description,
        capability_required: 'web_search',
        constraints: { max_cost_usd: 0.05 },
        reward: 0.03
      });

    } catch (err) {
      console.error(`${PREFIX}  ${chalk.red('✗')} Discovery failed: ${err.message}`);
      agent.sendResult(taskInfo.requesterId, taskId, {
        error: `Discovery failed: ${err.message}`
      }, { status: 'failed' });
      activeTasks.delete(taskId);
    }
  });

  // ─── Handle bids on our sub-tasks — auto-accept ───────────────
  agent.on('task_bid', async (msg) => {
    const subTaskId = msg.payload.task_id;

    // Only auto-accept bids on our sub-tasks
    if (!subTaskMap.has(subTaskId)) return;

    console.log(`${PREFIX}  ${chalk.gray('…')} Received bid: $${msg.payload.price_usd} from ${msg.from.agent_id}`);
    console.log(`${PREFIX}  ${chalk.green('✓')} Accepting bid...`);

    agent.acceptBid(msg.from.agent_id, subTaskId, msg.payload.bid_id);
  });

  // ─── Handle sub-task results — compile report ─────────────────
  agent.on('task_result', async (msg) => {
    const subTaskId = msg.payload.task_id;
    const parentTaskId = subTaskMap.get(subTaskId);

    if (!parentTaskId) {
      // Not a sub-task result — might be something else
      return;
    }

    const taskInfo = activeTasks.get(parentTaskId);
    if (!taskInfo) return;

    console.log(`${PREFIX}  ${chalk.bold('◄')} Received search results from sub-task`);

    // Verify the sub-task results
    agent.verifyResult(msg.from.agent_id, subTaskId, true, 0.85, 'Results look good');

    // Compile the research report
    console.log(`${PREFIX}  ${chalk.gray('…')} Compiling prospect research report...`);
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate processing

    const report = compileReport(
      taskInfo.description,
      msg.payload.output,
      {
        agentId: agent.identity.agentId,
        searchAgentId: taskInfo.searchAgentId,
        searchCost: msg.payload.actual_cost_usd || 0.03,
        searchTime: msg.payload.actual_time_seconds || 2,
        totalCost: 0.10
      }
    );

    // Deliver the final report to the original requester
    console.log(`${PREFIX}  ${chalk.bold('►')} Research report complete. Delivering to requester.`);
    agent.sendResult(taskInfo.requesterId, parentTaskId, report, {
      actualCost: 0.10,
      actualTime: Math.round((Date.now() - taskInfo.startTime) / 1000),
      modelUsed: 'local-template'
    });

    // Cleanup
    subTaskMap.delete(subTaskId);
    activeTasks.delete(parentTaskId);
  });

  // ─── Handle settlement notifications ──────────────────────────
  agent.on('task_settle', (msg) => {
    console.log(`${PREFIX}  ${chalk.green('$')} Settlement: $${msg.payload.amount_usd}`);
  });

  // ─── Connect ──────────────────────────────────────────────────
  await agent.start();
  console.log(`${PREFIX}  ${chalk.green('✓')} Connected to relay. Agent ID: ${agent.identity.agentId}`);
  console.log(`${PREFIX}  ${chalk.gray('Capabilities:')} prospect_research`);
  console.log(`${PREFIX}  ${chalk.gray('Waiting for tasks...')}`);
  console.log('');
}

// ─── Graceful Shutdown ──────────────────────────────────────────

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch(err => {
  console.error(chalk.red(`[ALPHA] FATAL: ${err.message}`));
  process.exit(1);
});
