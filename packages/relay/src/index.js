/**
 * AXIP Relay Server — Entry Point
 *
 * Starts all relay subsystems in order:
 *   1. SQLite database
 *   2. WebSocket server (agent connections)
 *   3. Admin dashboard (HTTP)
 *
 * The relay is pure deterministic code — no AI, no LLM calls.
 * All routing, matching, reputation, and settlement is algorithmic.
 */

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDatabase, closeDatabase } from './db.js';
import { createRelayServer } from './server.js';
import * as taskManager from './taskManager.js';
import { startDashboard } from './dashboard/server.js';
import * as pgLedger from './pg-ledger.js';
import * as logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WS_PORT = parseInt(process.env.AXIP_RELAY_PORT || '4200', 10);
const WS_HOST = process.env.AXIP_RELAY_HOST || '127.0.0.1';
const DASH_PORT = parseInt(process.env.AXIP_DASH_PORT || '4201', 10);
const DASH_HOST = process.env.AXIP_DASH_HOST || '0.0.0.0';

// Load network manifest
let manifest = {};
try {
  manifest = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'manifest.json'), 'utf-8'));
} catch {
  logger.warn('relay', 'Could not load config/manifest.json');
}

const BANNER = `
 ${chalk.cyan('╔══════════════════════════════════════════════╗')}
 ${chalk.cyan('║')}     ${chalk.bold.white('AXIP RELAY')} ${chalk.gray('v0.1.0')}                        ${chalk.cyan('║')}
 ${chalk.cyan('║')}  ${chalk.gray('Agent Interchange Protocol Hub')}               ${chalk.cyan('║')}
 ${chalk.cyan('║')}  ${chalk.dim.cyan('Freedom through distributed intelligence')}   ${chalk.cyan('║')}
 ${chalk.cyan('╚══════════════════════════════════════════════╝')}`;

async function main() {
  process.stdout.write(BANNER + '\n');
  logger.info('relay', 'Starting', { node: process.version, pid: process.pid });

  // 1. Database
  try {
    initDatabase();
  } catch (err) {
    logger.error('relay', 'FATAL: Database init failed', { error: err.message });
    process.exit(1);
  }

  // 2. WebSocket server
  let relayServer;
  try {
    relayServer = createRelayServer({
      port: WS_PORT,
      host: WS_HOST,
      logger: (msg) => logger.info('relay', msg)
    });
    taskManager.setServer(relayServer);
    logger.info('relay', 'WebSocket server online', { url: `ws://${WS_HOST}:${WS_PORT}` });
  } catch (err) {
    logger.error('relay', 'FATAL: WebSocket server failed', { error: err.message });
    process.exit(1);
  }

  // 3. PostgreSQL credit ledger (non-fatal — falls back to SQLite)
  try {
    await pgLedger.initPgLedger();
  } catch (err) {
    logger.warn('relay', 'pg-ledger init error (SQLite fallback active)', { error: err.message });
  }

  // 4. Dashboard (non-fatal)
  try {
    startDashboard(DASH_PORT, DASH_HOST, manifest);
    logger.info('relay', 'Admin dashboard online', { url: `http://${DASH_HOST}:${DASH_PORT}` });
  } catch (err) {
    logger.warn('relay', 'Dashboard failed', { error: err.message });
  }

  logger.info('relay', 'All systems online. Waiting for agents...');
}

// ─── Graceful Shutdown ──────────────────────────────────────────

function shutdown(signal) {
  logger.info('relay', 'Shutting down', { signal });
  taskManager.cleanup();
  closeDatabase();
  logger.info('relay', 'Goodbye.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('relay', 'Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('relay', 'Unhandled rejection', { reason: String(reason) });
  shutdown('unhandledRejection');
});

main().catch(err => {
  logger.error('relay', 'FATAL', { error: err.message });
  process.exit(1);
});
