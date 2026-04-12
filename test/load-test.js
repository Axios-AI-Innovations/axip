/**
 * AXIP Load Test — AGT-7
 *
 * Tests relay throughput with two phases:
 *
 * Phase 1 — Connection + Discover stress test
 *   100 agents connect concurrently and send discover requests.
 *   The relay handles discover_result entirely — no agent bidding needed.
 *   This tests relay WebSocket throughput and routing.
 *
 * Phase 2 — Task lifecycle stress test
 *   N concurrent task requesters send task_request → wait for bid → accept → wait for result.
 *   Concurrency is kept ≤ agent capacity to avoid starvation.
 *   Tests end-to-end task lifecycle throughput.
 *
 * Measures per phase:
 *   - Connect latency (p50/p95/p99)
 *   - Response latency
 *   - Success rate
 *   - Throughput (ops/sec)
 *
 * Usage:
 *   node test/load-test.js                           # full test (phase1 + phase2)
 *   node test/load-test.js --phase 1                 # discover stress only
 *   node test/load-test.js --phase 2                 # task lifecycle only
 *   node test/load-test.js --phase 2 --tasks 20      # 20 tasks, default concurrency
 *   node test/load-test.js --relay ws://127.0.0.1:4200
 *   node test/load-test.js --capability summarize
 */

import { AXIPAgent } from '@axip/sdk';
import { randomUUID } from 'crypto';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ?? defaultVal;
}

const PHASE        = parseInt(getArg('phase',       '0'), 10);  // 0 = both
const TASKS_P1     = parseInt(getArg('p1-tasks',  '100'), 10);  // discover stress tasks
const CONCUR_P1    = parseInt(getArg('p1-conc',    '20'), 10);  // phase 1 concurrency
const TASKS_P2     = parseInt(getArg('tasks',       '20'), 10); // task lifecycle tasks
const CONCUR_P2    = parseInt(getArg('concurrency',  '4'), 10); // phase 2 concurrency
const TIMEOUT_SEC  = parseInt(getArg('timeout',     '60'), 10);
const RELAY_URL    = getArg('relay', process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200');
const CAPABILITY   = getArg('capability', 'summarize');

// ─── Stats ────────────────────────────────────────────────────────────────────

function makeStats() {
  return { success: 0, failed: 0, timed_out: 0, connect_ms: [], op_ms: [] };
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function mean(arr) {
  return arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ─── Phase 1: Discover Stress Test ───────────────────────────────────────────

async function runDiscoverTask(index) {
  const agentName = `lt-discover-${index}-${randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const agent = new AXIPAgent({
    name: agentName,
    capabilities: [],
    relayUrl: RELAY_URL,
    metadata: { load_test: true }
  });

  // Suppress crypto identity log spam
  try {
    const origLog = console.log;
    console.log = (...a) => { if (!a[0]?.includes('[crypto]')) origLog(...a); };
    await agent.start();
    console.log = origLog;
  } catch (err) {
    try { agent.stop(); } catch {}
    return { success: false, error: err.message, connect_ms: 0, op_ms: 0 };
  }

  const connect_ms = Date.now() - t0;

  try {
    const t1 = Date.now();
    const capabilities = [CAPABILITY, 'web_search', 'code_review', 'translate', 'data_extraction'];
    const cap = capabilities[index % capabilities.length];
    await agent.discover(cap);
    const op_ms = Date.now() - t1;
    return { success: true, connect_ms, op_ms };
  } catch (err) {
    const isTimeout = err.message.toLowerCase().includes('timed out');
    return { success: false, error: err.message, connect_ms, op_ms: 0, timed_out: isTimeout };
  } finally {
    try { agent.stop(); } catch {}
  }
}

async function phase1(totalTasks, concurrency) {
  console.log(`\n  Phase 1: Discover Stress Test`);
  console.log(`  ${totalTasks} tasks, ${concurrency} concurrent, relay: ${RELAY_URL}`);
  console.log('');

  const stats = makeStats();
  let nextIndex = 0;
  let completed = 0;
  const t0 = Date.now();

  async function worker() {
    while (nextIndex < totalTasks) {
      const idx = nextIndex++;
      const result = await runDiscoverTask(idx);
      completed++;
      if (result.success) {
        stats.success++;
        stats.connect_ms.push(result.connect_ms);
        stats.op_ms.push(result.op_ms);
      } else {
        if (result.timed_out) stats.timed_out++;
        else stats.failed++;
      }
      if (completed % 10 === 0 || completed === totalTasks) {
        process.stdout.write(
          `\r  Progress: ${completed}/${totalTasks} | success: ${stats.success} | fail: ${stats.failed} | timeout: ${stats.timed_out}    `
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, totalTasks) }, () => worker());
  await Promise.all(workers);
  const duration_ms = Date.now() - t0;

  const successRate = ((stats.success / totalTasks) * 100).toFixed(1);
  const throughput = (stats.success / (duration_ms / 1000)).toFixed(2);

  console.log('\n');
  console.log('  ── Phase 1 Results ─────────────────────────');
  console.log(`  Total tasks:      ${totalTasks}`);
  console.log(`  Success:          ${stats.success} (${successRate}%)`);
  console.log(`  Failed:           ${stats.failed}`);
  console.log(`  Timed out:        ${stats.timed_out}`);
  console.log(`  Throughput:       ${throughput} discover/sec`);
  console.log(`  Duration:         ${(duration_ms / 1000).toFixed(1)}s`);
  if (stats.connect_ms.length > 0) {
    console.log(`  Connect latency:  p50=${percentile(stats.connect_ms, 50)}ms  p95=${percentile(stats.connect_ms, 95)}ms  avg=${mean(stats.connect_ms)}ms`);
  }
  if (stats.op_ms.length > 0) {
    console.log(`  Discover latency: p50=${percentile(stats.op_ms, 50)}ms  p95=${percentile(stats.op_ms, 95)}ms  avg=${mean(stats.op_ms)}ms`);
  }

  const passed = parseFloat(successRate) >= 90;
  console.log(`  Result:           ${passed ? 'PASS' : 'FAIL'} (${successRate}% >= 90% threshold)`);

  return {
    phase: 1,
    total: totalTasks,
    success: stats.success,
    failed: stats.failed,
    timed_out: stats.timed_out,
    success_rate: parseFloat(successRate),
    throughput: parseFloat(throughput),
    duration_sec: parseFloat((duration_ms / 1000).toFixed(1)),
    latency: {
      connect: stats.connect_ms.length > 0 ? { p50: percentile(stats.connect_ms, 50), p95: percentile(stats.connect_ms, 95), avg: mean(stats.connect_ms) } : null,
      discover: stats.op_ms.length > 0 ? { p50: percentile(stats.op_ms, 50), p95: percentile(stats.op_ms, 95), avg: mean(stats.op_ms) } : null
    },
    passed
  };
}

// ─── Phase 2: Task Lifecycle Stress Test ─────────────────────────────────────

async function runTaskLifecycle(index) {
  const taskId = `lt-task-${randomUUID()}`;
  const agentName = `lt-requester-${index}-${randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const agent = new AXIPAgent({
    name: agentName,
    capabilities: [],
    relayUrl: RELAY_URL,
    metadata: { load_test: true }
  });

  // Suppress identity creation logs
  const origLog = console.log;
  console.log = (...a) => { if (!a[0]?.includes('[crypto]')) origLog(...a); };
  try { await agent.start(); } catch (err) {
    console.log = origLog;
    try { agent.stop(); } catch {}
    return { success: false, error: err.message, phase: 'connect', connect_ms: 0 };
  }
  console.log = origLog;

  const connect_ms = Date.now() - t0;
  const t1 = Date.now();

  try {
    // Wait for bid with timeout
    const bidPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No bid in ${TIMEOUT_SEC}s`)), TIMEOUT_SEC * 1000);
      agent.on('task_bid', (msg) => {
        if (msg.payload.task_id === taskId) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });

    // Send task request
    const descriptions = [
      'Summarize the importance of trust in AI agent networks',
      'Briefly describe how payment settlement works in distributed systems',
      'What are the advantages of reputation-based routing',
      'Explain the role of cryptographic signing in agent protocols',
      'Why is escrow important for agent-to-agent payments'
    ];
    agent.send('task_request', 'network', {
      task_id: taskId,
      description: descriptions[index % descriptions.length],
      capability_required: CAPABILITY,
      constraints: { max_cost_usd: 0.10 },
      reward: 0.05
    });

    const bidMsg = await bidPromise;
    const bid_ms = Date.now() - t1;

    // Accept bid and wait for result
    const t2 = Date.now();
    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No result in ${TIMEOUT_SEC}s`)), TIMEOUT_SEC * 1000);
      agent.on('task_result', (msg) => {
        if (msg.payload.task_id === taskId) { clearTimeout(timer); resolve(msg); }
      });
      // Settle also counts as completion
      agent.on('task_settle', (msg) => {
        if (msg.payload.task_id === taskId) { clearTimeout(timer); resolve(msg); }
      });
    });

    agent.acceptBid(bidMsg.from.agent_id, taskId, bidMsg.payload.bid_id);

    const resultMsg = await resultPromise;
    const result_ms = Date.now() - t2;

    const total_ms = Date.now() - t0;

    return {
      success: true,
      connect_ms,
      bid_ms,
      result_ms,
      total_ms,
      status: resultMsg.payload?.status || resultMsg.type
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      connect_ms,
      timed_out: err.message.includes('No bid') || err.message.includes('No result')
    };
  } finally {
    try { agent.stop(); } catch {}
  }
}

async function phase2(totalTasks, concurrency) {
  console.log(`\n  Phase 2: Task Lifecycle Test`);
  console.log(`  ${totalTasks} tasks, ${concurrency} concurrent, capability: ${CAPABILITY}`);
  console.log(`  (Low concurrency intentional — LLM agents have limited slots)`);
  console.log('');

  const stats = makeStats();
  const bid_ms_arr = [];
  const result_ms_arr = [];
  let nextIndex = 0;
  let completed = 0;
  const t0 = Date.now();

  async function worker() {
    while (nextIndex < totalTasks) {
      const idx = nextIndex++;
      const result = await runTaskLifecycle(idx);
      completed++;
      if (result.success) {
        stats.success++;
        stats.connect_ms.push(result.connect_ms);
        bid_ms_arr.push(result.bid_ms);
        result_ms_arr.push(result.result_ms);
        stats.op_ms.push(result.total_ms);
      } else {
        if (result.timed_out) stats.timed_out++;
        else stats.failed++;
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(
        `\r  Progress: ${completed}/${totalTasks} [${elapsed}s] | success: ${stats.success} | timeout: ${stats.timed_out} | err: ${stats.failed}    `
      );
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, totalTasks) }, () => worker());
  await Promise.all(workers);
  const duration_ms = Date.now() - t0;

  const successRate = ((stats.success / totalTasks) * 100).toFixed(1);
  const throughput = (stats.success / (duration_ms / 1000)).toFixed(3);

  console.log('\n');
  console.log('  ── Phase 2 Results ─────────────────────────');
  console.log(`  Total tasks:      ${totalTasks}`);
  console.log(`  Successful:       ${stats.success} (${successRate}%)`);
  console.log(`  Timed out:        ${stats.timed_out}`);
  console.log(`  Errors:           ${stats.failed}`);
  console.log(`  Throughput:       ${throughput} tasks/sec`);
  console.log(`  Duration:         ${(duration_ms / 1000).toFixed(1)}s`);
  if (stats.connect_ms.length > 0) {
    console.log(`  Connect latency:  p50=${percentile(stats.connect_ms, 50)}ms  p95=${percentile(stats.connect_ms, 95)}ms  avg=${mean(stats.connect_ms)}ms`);
  }
  if (bid_ms_arr.length > 0) {
    console.log(`  Bid latency:      p50=${percentile(bid_ms_arr, 50)}ms  p95=${percentile(bid_ms_arr, 95)}ms  avg=${mean(bid_ms_arr)}ms`);
  }
  if (result_ms_arr.length > 0) {
    console.log(`  Result latency:   p50=${percentile(result_ms_arr, 50)}ms  p95=${percentile(result_ms_arr, 95)}ms  avg=${mean(result_ms_arr)}ms`);
  }
  if (stats.op_ms.length > 0) {
    console.log(`  Total e2e:        p50=${percentile(stats.op_ms, 50)}ms  p95=${percentile(stats.op_ms, 95)}ms  avg=${mean(stats.op_ms)}ms`);
  }

  // Phase 2 threshold lower — LLM agents have real capacity limits
  const passed = parseFloat(successRate) >= 70;
  console.log(`  Result:           ${passed ? 'PASS' : 'FAIL'} (${successRate}% >= 70% threshold)`);

  return {
    phase: 2,
    total: totalTasks,
    success: stats.success,
    timed_out: stats.timed_out,
    failed: stats.failed,
    success_rate: parseFloat(successRate),
    throughput: parseFloat(throughput),
    duration_sec: parseFloat((duration_ms / 1000).toFixed(1)),
    latency: {
      connect: stats.connect_ms.length > 0 ? { p50: percentile(stats.connect_ms, 50), p95: percentile(stats.connect_ms, 95), avg: mean(stats.connect_ms) } : null,
      bid: bid_ms_arr.length > 0 ? { p50: percentile(bid_ms_arr, 50), p95: percentile(bid_ms_arr, 95), avg: mean(bid_ms_arr) } : null,
      result: result_ms_arr.length > 0 ? { p50: percentile(result_ms_arr, 50), p95: percentile(result_ms_arr, 95), avg: mean(result_ms_arr) } : null
    },
    passed
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('═'.repeat(62));
console.log('  AXIP LOAD TEST — AGT-7');
console.log('═'.repeat(62));
console.log(`  Relay:         ${RELAY_URL}`);
if (PHASE === 0 || PHASE === 1)
  console.log(`  Phase 1:       ${TASKS_P1} discover tasks @ ${CONCUR_P1} concurrent`);
if (PHASE === 0 || PHASE === 2)
  console.log(`  Phase 2:       ${TASKS_P2} task lifecycle @ ${CONCUR_P2} concurrent (${CAPABILITY})`);
console.log(`  Timeout:       ${TIMEOUT_SEC}s per task`);

const results = [];

if (PHASE === 0 || PHASE === 1) {
  const r1 = await phase1(TASKS_P1, CONCUR_P1);
  results.push(r1);
}

if (PHASE === 0 || PHASE === 2) {
  // Small delay between phases to let agents drain
  if (PHASE === 0) {
    console.log('\n  Waiting 5s for agents to drain before Phase 2...');
    await new Promise(r => setTimeout(r, 5000));
  }
  const r2 = await phase2(TASKS_P2, CONCUR_P2);
  results.push(r2);
}

// Overall verdict
const allPassed = results.every(r => r.passed);
console.log('\n' + '═'.repeat(62));
console.log(`  OVERALL: ${allPassed ? 'PASS' : 'FAIL'}`);
results.forEach(r => {
  console.log(`  Phase ${r.phase}: ${r.passed ? 'PASS' : 'FAIL'} (${r.success_rate}% success, ${r.throughput} ops/sec)`);
});
console.log('═'.repeat(62));

process.exit(allPassed ? 0 : 1);
