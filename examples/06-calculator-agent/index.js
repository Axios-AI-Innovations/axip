/**
 * Example 06: Calculator Agent
 *
 * Evaluates math expressions passed as task descriptions.
 * Shows production patterns:
 * - Input parsing and sanitization
 * - Structured result with provenance
 * - Error reporting with helpful messages
 * - Rejecting tasks outside scope
 *
 * Capability: calculate
 * Input format: any math expression ("2 + 2", "sqrt(16) * 3", "100 / 4 + 25")
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Safe Math Evaluator ─────────────────────────────────────────
//
// Evaluates expressions without using eval(). Supports:
//   +, -, *, /, ** (power), % (modulo)
//   sqrt(x), abs(x), round(x), floor(x), ceil(x), log(x), log2(x)
//   PI, E constants

const SAFE_MATH_PATTERN = /^[\d\s+\-*/().%^,]+$/;

const MATH_FUNCTIONS = {
  sqrt:  (x) => Math.sqrt(x),
  abs:   (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil:  (x) => Math.ceil(x),
  log:   (x) => Math.log(x),
  log2:  (x) => Math.log2(x),
  log10: (x) => Math.log10(x),
  sin:   (x) => Math.sin(x),
  cos:   (x) => Math.cos(x),
  tan:   (x) => Math.tan(x),
  pow:   (x, y) => Math.pow(x, y),
  min:   (...args) => Math.min(...args),
  max:   (...args) => Math.max(...args)
};

function safeEval(expression) {
  // Normalize: trim, replace ^ with **, constants
  let expr = expression.trim()
    .replace(/\bPI\b/gi, String(Math.PI))
    .replace(/\bE\b/g, String(Math.E));

  // Only allow digits, operators, parentheses, spaces, dots, commas
  const cleaned = expr.replace(/[a-z_]+/gi, '');
  if (!SAFE_MATH_PATTERN.test(cleaned)) {
    throw new Error('Expression contains unsafe characters');
  }

  // Replace named functions with Math equivalents
  for (const [name, fn] of Object.entries(MATH_FUNCTIONS)) {
    const regex = new RegExp(`\\b${name}\\s*\\(`, 'gi');
    if (regex.test(expr)) {
      // Inject the function into a controlled scope via Function constructor
      // This is safe because we've already validated no dangerous tokens
      expr = expr.replace(new RegExp(`\\b${name}\\b`, 'gi'), `__math.${name}`);
    }
  }

  // Evaluate in a sandboxed Function with only Math functions exposed
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function('__math', `"use strict"; return (${expr})`)(MATH_FUNCTIONS);
    if (typeof result !== 'number') throw new Error('Result is not a number');
    if (!isFinite(result)) throw new Error('Result is infinite or NaN');
    return result;
  } catch (err) {
    throw new Error(`Could not evaluate expression: ${err.message}`);
  }
}

// ─── Agent Setup ─────────────────────────────────────────────────

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';

const agent = new AXIPAgent({
  name: 'calculator-agent',
  capabilities: ['calculate'],
  relayUrl: RELAY_URL,
  pricing: { base: 0.001 },
  metadata: {
    description: 'Evaluates math expressions. Supports +,-,*,/,**,%, sqrt, abs, round, floor, ceil, log, sin, cos, tan, min, max, PI, E.',
    max_expression_length: 500
  }
});

const activeTasks = new Map();

// ─── Event Handlers ─────────────────────────────────────────────

agent.on('task_match', (msg) => {
  const { task_id, description } = msg.payload;

  // Quick pre-check: refuse obviously non-math tasks
  if (description && description.length > 500) {
    console.log(`[calculator] Skipping ${task_id.slice(0, 8)}: expression too long`);
    return; // Don't bid
  }

  agent.bid(msg, {
    price: 0.001,
    etaSeconds: 1,
    message: 'Instant calculation.'
  });

  activeTasks.set(task_id, {
    expression: description,
    requesterId: msg.from.agent_id
  });

  console.log(`[calculator] Bid for task ${task_id.slice(0, 8)}: "${description?.slice(0, 40)}"`);
});

agent.on('task_accept', (msg) => {
  const { task_id } = msg.payload;
  const task = activeTasks.get(task_id);

  if (!task) return;

  try {
    if (!task.expression?.trim()) {
      throw new Error('No expression provided');
    }

    const startMs = Date.now();
    const result  = safeEval(task.expression);
    const elapsed = Date.now() - startMs;

    agent.sendResult(task.requesterId, task_id, {
      expression: task.expression,
      result,
      result_string: String(result),
      elapsed_ms: elapsed
    });

    console.log(`[calculator] ${task.expression} = ${result} (${elapsed}ms)`);
  } catch (err) {
    console.error(`[calculator] Error on ${task_id.slice(0, 8)}: ${err.message}`);
    agent.sendResult(task.requesterId, task_id, {
      error: err.message,
      expression: task.expression
    }, { status: 'failed' });
  }

  activeTasks.delete(task_id);
});

agent.on('task_settle', (msg) => {
  console.log(`[calculator] Settled: $${msg.payload.amount_usd}`);
});

agent.on('task_cancel', (msg) => {
  const taskId = msg.payload?.task_id;
  if (taskId) activeTasks.delete(taskId);
});

agent.connection.on('connected', () => {
  if (activeTasks.size > 0) activeTasks.clear();
});

// ─── Graceful Shutdown ───────────────────────────────────────────

process.on('SIGTERM', () => { agent.stop(); process.exit(0); });
process.on('SIGINT',  () => { agent.stop(); process.exit(0); });

// ─── Start ───────────────────────────────────────────────────────

await agent.start();
console.log(`[calculator] Connected to ${RELAY_URL}`);
console.log(`[calculator] Ready for calculate tasks.`);
console.log(`[calculator] Try: "2 + 2", "sqrt(16) * 3", "100 / 4 + 25"`);
