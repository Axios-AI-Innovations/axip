#!/usr/bin/env node
/**
 * AXIP Production Monitor (LCH-6)
 *
 * Periodically checks relay health, agent connectivity, and payment system.
 * Sends Telegram alerts when issues are detected with rate limiting to avoid spam.
 *
 * Usage:
 *   node scripts/axip-monitor.js          # Run once (cron-friendly)
 *   node scripts/axip-monitor.js --daemon # Run in loop (PM2-friendly)
 *
 * Environment (loaded from ~/eli-agent/.env):
 *   TELEGRAM_BOT_TOKEN  — Telegram bot token
 *   TELEGRAM_CHAT_ID    — Target chat ID (Elias)
 *
 * Alert state is persisted to /tmp/axip-monitor-state.json
 * to prevent duplicate alerts across runs.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// ─── Config ────────────────────────────────────────────────────────

const RELAY_DASH_URL  = process.env.AXIP_DASH_URL  || 'http://127.0.0.1:4201';
const CHECK_INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '120000', 10); // 2 min
const ALERT_COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MS   || '900000',  10); // 15 min per issue
const STATE_FILE = '/tmp/axip-monitor-state.json';

// Minimum agents we expect online; alert if below this
const MIN_AGENTS_ONLINE = parseInt(process.env.MIN_AGENTS_ONLINE || '3', 10);

// Load Telegram credentials from eli-agent .env
function loadTelegramCreds() {
  try {
    const env = readFileSync('/Users/elias/eli-agent/.env', 'utf-8');
    const token = env.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
    const chatId = env.match(/TELEGRAM_CHAT_ID=(.+)/)?.[1]?.trim() || '1873263822';
    return { token, chatId };
  } catch {
    return { token: null, chatId: '1873263822' };
  }
}

// ─── State ─────────────────────────────────────────────────────────

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { lastAlerts: {}, consecutiveFailures: {} };
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* non-fatal */ }
}

// ─── Telegram Alert ────────────────────────────────────────────────

async function sendAlert(message, state, alertKey) {
  const now = Date.now();
  const lastSent = state.lastAlerts[alertKey] || 0;

  if (now - lastSent < ALERT_COOLDOWN_MS) {
    log(`[monitor] Alert suppressed (cooldown): ${alertKey}`);
    return; // Don't spam
  }

  const { token, chatId } = loadTelegramCreds();
  if (!token) {
    log(`[monitor] No Telegram token — skipping alert: ${message}`);
    return;
  }

  const fullMessage = `🚨 *AXIP Alert*\n\n${message}\n\n_${new Date().toISOString()}_`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: chatId,
      text: fullMessage,
      parse_mode: 'Markdown'
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      state.lastAlerts[alertKey] = now;
      log(`[monitor] Alert sent: ${alertKey}`);
    } else {
      log(`[monitor] Alert failed (HTTP ${res.status}): ${alertKey}`);
    }
  } catch (err) {
    log(`[monitor] Alert error: ${err.message}`);
  }
}

async function sendRecovery(message, state, alertKey) {
  // Only send recovery if we had previously alerted
  if (!state.lastAlerts[alertKey]) return;

  const { token, chatId } = loadTelegramCreds();
  if (!token) return;

  const fullMessage = `✅ *AXIP Recovered*\n\n${message}\n\n_${new Date().toISOString()}_`;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: fullMessage, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(10000)
    });
    // Clear the alert so future failures trigger new alerts
    delete state.lastAlerts[alertKey];
    log(`[monitor] Recovery sent: ${alertKey}`);
  } catch { /* non-fatal */ }
}

// ─── Checks ────────────────────────────────────────────────────────

async function checkRelayHealth(state) {
  try {
    const res = await fetch(`${RELAY_DASH_URL}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`status=${data.status}`);

    const uptimeMin = Math.round((data.uptime || 0) / 60);
    log(`[monitor] Relay OK (uptime: ${uptimeMin}min, agents: ${data.agents_online})`);

    await sendRecovery('Relay health check passing again.', state, 'relay_down');
    state.consecutiveFailures.relay = 0;
    return { ok: true, agentsOnline: data.agents_online, uptime: data.uptime };
  } catch (err) {
    state.consecutiveFailures.relay = (state.consecutiveFailures.relay || 0) + 1;
    log(`[monitor] Relay health FAILED (${state.consecutiveFailures.relay}x): ${err.message}`);

    if (state.consecutiveFailures.relay >= 2) {
      await sendAlert(
        `Relay health check failed ${state.consecutiveFailures.relay}x\n\nError: \`${err.message}\`\n\nRelay URL: ${RELAY_DASH_URL}`,
        state,
        'relay_down'
      );
    }
    return { ok: false, agentsOnline: 0 };
  }
}

async function checkAgentCount(agentsOnline, state) {
  if (agentsOnline < MIN_AGENTS_ONLINE) {
    state.consecutiveFailures.agents = (state.consecutiveFailures.agents || 0) + 1;
    log(`[monitor] Low agent count: ${agentsOnline} online (min: ${MIN_AGENTS_ONLINE})`);

    if (state.consecutiveFailures.agents >= 2) {
      await sendAlert(
        `Low agent count: only *${agentsOnline}* agents online (minimum: ${MIN_AGENTS_ONLINE})\n\nCheck PM2: \`pm2 status\``,
        state,
        'low_agents'
      );
    }
  } else {
    if (state.consecutiveFailures.agents >= 2) {
      await sendRecovery(`Agent count back to normal: ${agentsOnline} agents online.`, state, 'low_agents');
    }
    state.consecutiveFailures.agents = 0;
  }
}

async function checkPaymentSystem(state) {
  try {
    const res = await fetch(`${RELAY_DASH_URL}/api/credits/platform`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.available === false) {
      // PostgreSQL ledger unavailable — running on SQLite fallback
      state.consecutiveFailures.payments = (state.consecutiveFailures.payments || 0) + 1;
      log(`[monitor] Payment system degraded (PostgreSQL unavailable, ${state.consecutiveFailures.payments}x)`);

      if (state.consecutiveFailures.payments >= 3) {
        await sendAlert(
          `Payment system degraded: PostgreSQL ledger is *unavailable*\n\nFalling back to SQLite. Stripe deposits/withdrawals will fail.\n\nCheck: \`pm2 logs axip-relay --lines 20\``,
          state,
          'payment_degraded'
        );
      }
    } else {
      if (state.consecutiveFailures.payments >= 3) {
        await sendRecovery('Payment system back online (PostgreSQL connected).', state, 'payment_degraded');
      }
      state.consecutiveFailures.payments = 0;
      log(`[monitor] Payment system OK (balance: $${(data.balance_usd || 0).toFixed(4)}, earned: $${(data.total_earned || 0).toFixed(4)})`);
    }
  } catch (err) {
    log(`[monitor] Payment check failed: ${err.message}`);
  }
}

async function checkPm2Processes(state) {
  const CRITICAL_PROCESSES = ['axip-relay', 'hive-portal'];

  for (const name of CRITICAL_PROCESSES) {
    try {
      const out = execSync(`pm2 jlist 2>/dev/null`, { encoding: 'utf-8' });
      const processes = JSON.parse(out);
      const proc = processes.find(p => p.name === name);

      if (!proc) {
        log(`[monitor] PM2 process not found: ${name}`);
        await sendAlert(`PM2 process *${name}* not found!\n\nStart with: \`pm2 start\``, state, `pm2_missing_${name}`);
        continue;
      }

      if (proc.pm2_env?.status !== 'online') {
        const status = proc.pm2_env?.status || 'unknown';
        state.consecutiveFailures[`pm2_${name}`] = (state.consecutiveFailures[`pm2_${name}`] || 0) + 1;
        log(`[monitor] PM2 ${name} status: ${status}`);

        if (state.consecutiveFailures[`pm2_${name}`] >= 2) {
          await sendAlert(
            `PM2 process *${name}* is ${status}\n\nRestart: \`pm2 restart ${name}\`\nLogs: \`pm2 logs ${name} --lines 20\``,
            state,
            `pm2_down_${name}`
          );
        }
      } else {
        if (state.consecutiveFailures[`pm2_${name}`] >= 2) {
          await sendRecovery(`PM2 process *${name}* is back online.`, state, `pm2_down_${name}`);
        }
        state.consecutiveFailures[`pm2_${name}`] = 0;

        const restarts = proc.pm2_env?.restart_time || 0;
        const alertKey = `pm2_restarts_${name}`;
        const lastRestartAlert = state.lastAlerts[alertKey] || 0;
        const prevRestarts = state[`prev_restarts_${name}`] || 0;

        if (restarts > prevRestarts + 3 && Date.now() - lastRestartAlert > ALERT_COOLDOWN_MS) {
          await sendAlert(
            `PM2 process *${name}* has restarted *${restarts}* times total (was ${prevRestarts})\n\nThis may indicate a crash loop. Check logs: \`pm2 logs ${name} --lines 30\``,
            state,
            alertKey
          );
          state[`prev_restarts_${name}`] = restarts;
        } else {
          state[`prev_restarts_${name}`] = restarts;
        }
      }
    } catch (err) {
      log(`[monitor] PM2 check failed for ${name}: ${err.message}`);
    }
  }
}

// ─── Logging ───────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Main Loop ─────────────────────────────────────────────────────

async function runChecks() {
  const state = loadState();
  log('[monitor] --- Health check starting ---');

  // 1. Relay health (also gives agent count)
  const relay = await checkRelayHealth(state);

  if (relay.ok) {
    // 2. Agent count check
    await checkAgentCount(relay.agentsOnline, state);
  }

  // 3. Payment system
  await checkPaymentSystem(state);

  // 4. Critical PM2 processes
  await checkPm2Processes(state);

  saveState(state);
  log('[monitor] --- Health check complete ---');
}

async function main() {
  const isDaemon = process.argv.includes('--daemon');

  if (isDaemon) {
    log('[monitor] Starting in daemon mode');
    log(`[monitor] Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
    log(`[monitor] Alert cooldown: ${ALERT_COOLDOWN_MS / 1000}s`);
    log(`[monitor] Min agents: ${MIN_AGENTS_ONLINE}`);

    // Run immediately, then on interval
    await runChecks();
    setInterval(runChecks, CHECK_INTERVAL_MS);
  } else {
    // Single run (cron mode)
    await runChecks();
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`[monitor] FATAL: ${err.message}`);
  process.exit(1);
});
