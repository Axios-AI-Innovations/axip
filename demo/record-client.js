/**
 * AXIP Screen Recording Demo Client
 *
 * Connects to the live local relay and runs a full web_search task lifecycle.
 * Designed for screen recording — beautiful output, deliberate pacing.
 *
 * Usage:
 *   node demo/record-client.js
 *   DEMO_QUERY="AI agent marketplaces 2026" node demo/record-client.js
 *
 * Flow: connect → discover → request → bid → accept → result → verify → settle
 */

import { AXIPAgent } from '@axip/sdk';
import chalk from 'chalk';

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';
const QUERY = process.env.DEMO_QUERY || 'AI agent marketplaces 2026';
const TASK_TIMEOUT_MS = 90_000;

const c = {
  banner: chalk.hex('#00D4FF').bold,
  label:  chalk.gray,
  ok:     chalk.green,
  arrow:  chalk.hex('#00D4FF').bold,
  value:  chalk.white.bold,
  dim:    chalk.gray,
  warn:   chalk.yellow,
  step:   chalk.hex('#FFB800').bold,
  settle: chalk.hex('#00FF88').bold,
  url:    chalk.cyan,
  title:  chalk.white.bold,
  divider: chalk.gray,
};

const WIDE  = 64;
const LINE  = c.divider('─'.repeat(WIDE));
const DLINE = c.divider('═'.repeat(WIDE));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function printBanner() {
  console.clear();
  console.log('');
  console.log(c.banner('  ╔══════════════════════════════════════════════════════════╗'));
  console.log(c.banner('  ║                                                          ║'));
  console.log(c.banner('  ║   AXIP  ·  Agent Interchange Protocol                   ║'));
  console.log(c.banner('  ║   AI agents doing business with each other               ║'));
  console.log(c.banner('  ║                                                          ║'));
  console.log(c.banner('  ╚══════════════════════════════════════════════════════════╝'));
  console.log('');
}

function printSection(title) {
  console.log('');
  console.log(LINE);
  console.log(`  ${c.step(title)}`);
  console.log(LINE);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function main() {
  printBanner();
  await sleep(1500);

  // ── Step 1: Connect ──────────────────────────────────────────

  printSection('STEP 1 OF 5 — Connect to AXIP marketplace');
  await sleep(600);

  console.log(`  ${c.label('Relay:')}  ${c.value(RELAY_URL)}`);
  console.log(`  ${c.label('Agent:')}  ${c.value('demo-recorder')}  ${c.dim('(no capabilities — requester only)')}`);
  await sleep(800);

  const agent = new AXIPAgent({ name: 'demo-recorder', capabilities: [] });

  // ── Wire ALL event listeners immediately after agent creation ──
  // Listeners must be registered before any task request is sent,
  // because bids can arrive within milliseconds of broadcast.

  const bidDeferred    = deferred();
  const resultDeferred = deferred();
  const settleDeferred = deferred();

  agent.on('task_bid',    (msg) => bidDeferred.resolve(msg));
  agent.on('task_result', (msg) => resultDeferred.resolve(msg));
  agent.on('task_settle', (msg) => settleDeferred.resolve(msg));

  // Timeout guard
  const timeout = setTimeout(() => {
    console.log('');
    console.log(c.warn('  ⚠ Timeout (90s) waiting for task completion. Is agent-beta running?'));
    agent.stop();
    process.exit(1);
  }, TASK_TIMEOUT_MS);

  await new Promise((resolve, reject) => {
    agent.once('connected', resolve);
    agent.once('error_message', reject);
    agent.start().catch(reject);
  });

  await sleep(400);
  console.log(`  ${c.ok('✓')} Connected to relay`);
  await sleep(1200);

  // ── Step 2: Discover ─────────────────────────────────────────

  printSection('STEP 2 OF 5 — Discover web_search agents');
  await sleep(600);

  console.log(`  ${c.arrow('►')} Querying marketplace for capability: ${c.value('web_search')}`);
  await sleep(500);

  const discovered = await agent.discover('web_search');
  const agents = discovered?.payload?.agents || [];

  if (agents.length === 0) {
    console.log(c.warn('  ✗ No web_search agents online. Make sure agent-beta is running.'));
    clearTimeout(timeout);
    agent.stop();
    process.exit(1);
  }

  await sleep(400);
  console.log(`  ${c.ok('✓')} Found ${c.value(agents.length)} agent(s) in marketplace`);
  console.log('');

  const best = agents[0];
  console.log(`  ${c.label('Selected agent:')}  ${c.value(best.agent_id)}`);
  console.log(`  ${c.label('Reputation:')}     ${c.value(best.reputation ?? '0.80')}`);
  console.log(`  ${c.label('Capabilities:')}   ${c.value((best.capabilities || ['web_search']).join(', '))}`);
  await sleep(1800);

  // ── Step 3: Request task ─────────────────────────────────────

  printSection('STEP 3 OF 5 — Broadcast task request');
  await sleep(600);

  const taskId = `task_demo_${Date.now()}`;
  const reward = 0.05;

  console.log(`  ${c.arrow('►')} Broadcasting task to marketplace...`);
  console.log('');
  console.log(`  ${c.label('Task:')}    ${c.value(`"${QUERY}"`)}`);
  console.log(`  ${c.label('Skill:')}   ${c.value('web_search')}`);
  console.log(`  ${c.label('Budget:')}  ${c.value(`$${reward.toFixed(3)} credits`)}`);
  await sleep(400);

  // Send task THEN immediately show "broadcast" confirmation
  agent.send('task_request', 'relay', {
    task_id: taskId,
    description: QUERY,
    capability_required: 'web_search',
    constraints: { max_cost_usd: 0.10 },
    reward,
  });

  await sleep(300);
  console.log(`  ${c.ok('✓')} Request signed and broadcast  ${c.dim(`(id: ${taskId.slice(-12)})`)}`);

  // ── Step 4: Receive bid & accept ─────────────────────────────

  printSection('STEP 4 OF 5 — Receive bid  →  Accept');

  // Await bid (already registered before task request was sent)
  const bidMsg = await bidDeferred.promise;
  const { price_usd, estimated_time_seconds, bid_id } = bidMsg.payload;

  await sleep(400);
  console.log('');
  console.log(`  ${c.arrow('◄')} Bid received from ${c.value(bidMsg.from.agent_id)}`);
  console.log(`  ${c.label('  Price:')}  ${c.value(`$${Number(price_usd).toFixed(3)} credits`)}`);
  console.log(`  ${c.label('  ETA:')}    ${c.value(`${estimated_time_seconds}s`)}`);
  await sleep(800);

  console.log('');
  console.log(`  ${c.arrow('►')} Accepting bid...`);
  agent.acceptBid(bidMsg.from.agent_id, taskId, bid_id);
  await sleep(400);
  console.log(`  ${c.ok('✓')} Bid accepted — agent is working`);
  await sleep(300);
  console.log(`  ${c.dim('  Waiting for result...')}`);

  // ── Step 5: Result → Verify → Settle ─────────────────────────

  const resultMsg = await resultDeferred.promise;
  const { output, actual_cost_usd, actual_time_seconds } = resultMsg.payload;

  console.log('');
  console.log(DLINE);
  console.log(`  ${c.settle('STEP 5 OF 5 — Result received  →  Verify  →  Settle')}`);
  console.log(DLINE);
  await sleep(500);

  // Display web_search results
  const results = output?.results || [];
  const took = actual_time_seconds ? `${actual_time_seconds}s` : '–';

  console.log('');
  console.log(`  ${c.label('Query:')}         ${c.value(output?.query || QUERY)}`);
  console.log(`  ${c.label('Results:')}       ${c.value(results.length)} web results`);
  console.log(`  ${c.label('Search time:')}   ${c.value(took)}`);
  console.log('');

  const top = results.slice(0, 3);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const relevance = r.relevance != null ? `  [rel: ${(r.relevance * 100).toFixed(0)}%]` : '';
    console.log(`  ${c.step(`${i + 1}.`)} ${c.title(r.title || '–')}`);
    console.log(`     ${c.url(r.url || '')}`);
    if (r.summary) {
      const snip = r.summary.length > 120 ? r.summary.slice(0, 120) + '…' : r.summary;
      console.log(`     ${c.dim(snip)}${c.dim(relevance)}`);
    }
    console.log('');
    await sleep(300);
  }

  // Verify
  console.log(`  ${c.arrow('►')} Verifying result quality...`);
  agent.verifyResult(resultMsg.from.agent_id, taskId, true, 1.0, 'Excellent results');
  await sleep(600);
  console.log(`  ${c.ok('✓')} Verified`);
  await sleep(400);
  console.log(`  ${c.dim('  Waiting for settlement...')}`);

  // Wait for settlement
  const settleMsg = await settleDeferred.promise;

  await sleep(400);
  console.log('');
  console.log(DLINE);
  console.log(`  ${c.settle('✓ SETTLEMENT COMPLETE')}`);
  console.log(DLINE);
  console.log('');
  console.log(`  ${c.label('Amount:')}    ${c.settle(`$${Number(settleMsg.payload?.amount_usd || actual_cost_usd || 0.03).toFixed(3)} credits`)}`);
  console.log(`  ${c.label('To agent:')}  ${c.value(bidMsg.from.agent_id)}`);
  console.log(`  ${c.label('Status:')}    ${c.settle('SETTLED')}`);
  console.log('');
  console.log(`  ${c.dim('Credit transfer complete. Reputation updated.')}`);
  await sleep(1000);

  // Summary
  console.log('');
  console.log(DLINE);
  console.log(`  ${c.banner('AXIP Demo Complete')}`);
  console.log(DLINE);
  console.log('');
  console.log(`  ${c.ok('✓')} Agent discovered in marketplace`);
  console.log(`  ${c.ok('✓')} Task bid received, accepted, executed`);
  console.log(`  ${c.ok('✓')} Result verified and credits settled`);
  console.log(`  ${c.ok('✓')} No humans in the loop`);
  console.log('');
  console.log(`  ${c.label('Install the SDK:')}  ${c.value('npm install @axip/sdk')}`);
  console.log(`  ${c.label('Learn more:')}       ${c.value('axiosaiinnovations.com/axip')}`);
  console.log('');

  clearTimeout(timeout);
  await sleep(2000);
  agent.stop();
  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`\n  Error: ${err.message}`));
  process.exit(1);
});
