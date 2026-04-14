/**
 * Example 03: Text Tools Agent
 *
 * One agent, three capabilities. Shows how to:
 * - Register multiple capabilities in a single agent
 * - Route task_match and task_accept by capability
 * - Return structured results with metadata
 *
 * Capabilities:
 *   word_count   — count words, sentences, paragraphs
 *   uppercase    — convert text to UPPER CASE
 *   reverse_text — reverse each word in the text
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Configuration ───────────────────────────────────────────────

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';

// Pricing per capability
const PRICING = {
  word_count:   0.001,
  uppercase:    0.001,
  reverse_text: 0.001
};

const agent = new AXIPAgent({
  name: 'text-tools-agent',
  capabilities: ['word_count', 'uppercase', 'reverse_text'],
  relayUrl: RELAY_URL,
  pricing: { base: 0.001 },
  metadata: {
    description: 'Text analysis and transformation tools.',
    capabilities_detail: {
      word_count:   'Count words, sentences, and paragraphs in text',
      uppercase:    'Convert text to UPPER CASE',
      reverse_text: 'Reverse each word in the input text'
    }
  }
});

const activeTasks = new Map();

// ─── Capability Handlers ─────────────────────────────────────────

/**
 * word_count: analyze the structure of a piece of text
 */
function handleWordCount(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;

  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    characters,
    characters_no_spaces: charactersNoSpaces,
    average_word_length: words.length
      ? (words.reduce((sum, w) => sum + w.length, 0) / words.length).toFixed(1)
      : '0'
  };
}

/**
 * uppercase: convert to UPPER CASE
 */
function handleUppercase(text) {
  return {
    result: text.toUpperCase(),
    original_length: text.length,
    changed_chars: [...text].filter((c, i) => c !== text.toUpperCase()[i]).length
  };
}

/**
 * reverse_text: reverse each word individually
 */
function handleReverseText(text) {
  const reversed = text
    .split(/(\s+)/)
    .map(token => /\s+/.test(token) ? token : token.split('').reverse().join(''))
    .join('');

  return {
    result: reversed,
    words_reversed: text.trim().split(/\s+/).filter(Boolean).length
  };
}

// Route capability name to handler function
const HANDLERS = {
  word_count:   handleWordCount,
  uppercase:    handleUppercase,
  reverse_text: handleReverseText
};

// ─── Event Handlers ─────────────────────────────────────────────

agent.on('task_match', (msg) => {
  const { task_id, capability, description } = msg.payload;

  const price = PRICING[capability] ?? 0.001;

  agent.bid(msg, {
    price,
    etaSeconds: 1,
    message: `${capability} ready.`
  });

  activeTasks.set(task_id, {
    capability,
    description,
    requesterId: msg.from.agent_id
  });

  console.log(`[text-tools] Bid $${price} for ${capability} task ${task_id.slice(0, 8)}`);
});

agent.on('task_accept', (msg) => {
  const { task_id } = msg.payload;
  const task = activeTasks.get(task_id);

  if (!task) return;

  const handler = HANDLERS[task.capability];

  if (!handler) {
    agent.sendResult(task.requesterId, task_id,
      { error: `Unknown capability: ${task.capability}` },
      { status: 'failed' }
    );
    activeTasks.delete(task_id);
    return;
  }

  try {
    const result = handler(task.description);
    agent.sendResult(task.requesterId, task_id, result);
    console.log(`[text-tools] Delivered ${task.capability} result for ${task_id.slice(0, 8)}`);
  } catch (err) {
    console.error(`[text-tools] Error: ${err.message}`);
    agent.sendResult(task.requesterId, task_id, { error: err.message }, { status: 'failed' });
  }

  activeTasks.delete(task_id);
});

agent.on('task_settle', (msg) => {
  console.log(`[text-tools] Settled: $${msg.payload.amount_usd}`);
});

agent.on('task_cancel', (msg) => {
  const taskId = msg.payload?.task_id;
  if (taskId) activeTasks.delete(taskId);
});

agent.connection.on('connected', () => {
  if (activeTasks.size > 0) {
    console.log(`[text-tools] Reconnected — clearing ${activeTasks.size} stale task(s)`);
    activeTasks.clear();
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────

function shutdown() {
  agent.stop();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ───────────────────────────────────────────────────────

await agent.start();
console.log(`[text-tools] Connected to ${RELAY_URL}`);
console.log(`[text-tools] Capabilities: word_count, uppercase, reverse_text`);
console.log(`[text-tools] Ready.`);
