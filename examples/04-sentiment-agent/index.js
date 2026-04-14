/**
 * Example 04: Sentiment Agent
 *
 * Keyword-based sentiment analysis — no LLM, no external APIs.
 * Shows how to build a fast, stateless processing agent that can
 * handle high throughput at low cost.
 *
 * Capability: sentiment_analysis
 * Returns: { score, label, confidence, positive_words, negative_words }
 *
 * Run:
 *   cp .env.example .env && npm install && node index.js
 */

import 'dotenv/config';
import { AXIPAgent } from '@axip/sdk';

// ─── Sentiment Lexicon ───────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic',
  'awesome', 'outstanding', 'superb', 'brilliant', 'perfect', 'love',
  'best', 'happy', 'joy', 'delighted', 'pleased', 'thrilled', 'excited',
  'positive', 'success', 'successful', 'helpful', 'useful', 'beautiful',
  'impressive', 'innovative', 'fast', 'reliable', 'easy', 'smooth',
  'recommend', 'recommended', 'worth', 'valuable', 'enjoy', 'enjoyed'
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'horrible', 'dreadful', 'poor', 'worst',
  'hate', 'dislike', 'disappoint', 'disappointed', 'disappointing',
  'frustrating', 'frustration', 'broken', 'useless', 'waste', 'fail',
  'failed', 'failure', 'slow', 'buggy', 'error', 'errors', 'crash',
  'crashes', 'problem', 'problems', 'issue', 'issues', 'annoying',
  'difficult', 'confusing', 'unreliable', 'expensive', 'overpriced'
]);

// ─── Analysis Function ───────────────────────────────────────────

function analyzeSentiment(text) {
  // Normalize: lowercase, split into words
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  const positiveFound = words.filter(w => POSITIVE_WORDS.has(w));
  const negativeFound = words.filter(w => NEGATIVE_WORDS.has(w));

  const positiveCount = positiveFound.length;
  const negativeCount = negativeFound.length;
  const total = positiveCount + negativeCount;

  // Score: -1.0 (very negative) to +1.0 (very positive)
  let score = 0;
  let label = 'neutral';
  let confidence = 0.5;

  if (total > 0) {
    score = (positiveCount - negativeCount) / total;
    confidence = Math.min(0.95, 0.5 + (total / words.length) * 2);

    if (score > 0.3) label = 'positive';
    else if (score < -0.3) label = 'negative';
    else label = 'neutral';
  }

  return {
    score: parseFloat(score.toFixed(3)),
    label,
    confidence: parseFloat(confidence.toFixed(3)),
    positive_words: [...new Set(positiveFound)],
    negative_words: [...new Set(negativeFound)],
    word_count: words.length
  };
}

// ─── Agent Setup ─────────────────────────────────────────────────

const RELAY_URL = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';

const agent = new AXIPAgent({
  name: 'sentiment-agent',
  capabilities: ['sentiment_analysis'],
  relayUrl: RELAY_URL,
  pricing: { base: 0.002 },
  metadata: {
    description: 'Fast keyword-based sentiment analysis. Returns score (-1 to +1), label, and matched words.',
    accuracy: 'keyword-based (no LLM)',
    latency: 'instant'
  }
});

const activeTasks = new Map();

// ─── Event Handlers ─────────────────────────────────────────────

agent.on('task_match', (msg) => {
  const { task_id, description } = msg.payload;

  agent.bid(msg, {
    price: 0.002,
    etaSeconds: 1,
    message: 'Instant keyword-based sentiment analysis.'
  });

  activeTasks.set(task_id, {
    description,
    requesterId: msg.from.agent_id
  });

  console.log(`[sentiment] Bid for task ${task_id.slice(0, 8)}`);
});

agent.on('task_accept', (msg) => {
  const { task_id } = msg.payload;
  const task = activeTasks.get(task_id);

  if (!task) return;

  try {
    if (!task.description?.trim()) {
      throw new Error('Input text is empty');
    }
    if (task.description.length > 10000) {
      throw new Error('Input exceeds 10,000 character limit');
    }

    const result = analyzeSentiment(task.description);
    agent.sendResult(task.requesterId, task_id, result);

    console.log(`[sentiment] ${task_id.slice(0, 8)}: ${result.label} (score=${result.score})`);
  } catch (err) {
    console.error(`[sentiment] Error: ${err.message}`);
    agent.sendResult(task.requesterId, task_id, { error: err.message }, { status: 'failed' });
  }

  activeTasks.delete(task_id);
});

agent.on('task_settle', (msg) => {
  console.log(`[sentiment] Settled: $${msg.payload.amount_usd}`);
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
console.log(`[sentiment] Connected to ${RELAY_URL}`);
console.log(`[sentiment] Ready for sentiment_analysis tasks.`);
