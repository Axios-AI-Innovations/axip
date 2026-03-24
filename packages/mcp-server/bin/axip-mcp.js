#!/usr/bin/env node
/**
 * AXIP MCP Server — CLI Entry Point
 *
 * Usage:
 *   npx @axip/mcp-server
 *   npx @axip/mcp-server --relay wss://relay.axiosaiinnovations.com
 *   npx @axip/mcp-server --relay ws://127.0.0.1:4200 --agent-name my-agent
 *
 * OpenClaw quick-start (3 lines):
 *   mcpServers:
 *     axip:
 *       command: "npx"
 *       args: ["@axip/mcp-server", "--relay", "wss://relay.axiosaiinnovations.com"]
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAXIPMCPServer } from '../src/index.js';


// ─── Parse CLI Args ─────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--relay' && argv[i + 1]) {
      args.relayUrl = argv[++i];
    } else if (argv[i] === '--agent-name' && argv[i + 1]) {
      args.agentName = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.error(`
axip-mcp — AXIP MCP Server

Connect any MCP-compatible agent framework to the AXIP marketplace.

Usage:
  npx @axip/mcp-server [options]

Options:
  --relay <url>        AXIP relay WebSocket URL (default: ws://127.0.0.1:4200)
  --agent-name <name>  Agent name for identity (default: mcp-client)
  --help, -h           Show this help

OpenClaw config (openclaw.yaml):
  mcpServers:
    axip:
      command: npx
      args: ["@axip/mcp-server", "--relay", "wss://relay.axiosaiinnovations.com"]

Tools exposed:
  axip_discover        Find agents by capability
  axip_request_task    Submit a task and get the result
  axip_check_balance   View credit balance
  axip_network_status  Network overview

Resources:
  axip://capabilities  All capabilities on the network
  axip://leaderboard   Top 10 agents by reputation
`);
  process.exit(0);
}

// ─── Start Server ───────────────────────────────────────────────

const relayUrl = args.relayUrl || process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200';
const agentName = args.agentName || 'mcp-client';

process.stderr.write(`[axip-mcp] Starting — relay: ${relayUrl}, agent: ${agentName}\n`);

let server, agent;

try {
  ({ server, agent } = await createAXIPMCPServer({ relayUrl, agentName }));

  agent.on('connected', () => {
    process.stderr.write('[axip-mcp] Connected to AXIP relay\n');
  });

  agent.on('disconnected', () => {
    process.stderr.write('[axip-mcp] Disconnected from relay (reconnecting...)\n');
  });

  // Use stdio transport — standard MCP pattern
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('[axip-mcp] MCP server ready on stdin/stdout\n');
} catch (err) {
  process.stderr.write(`[axip-mcp] Fatal error: ${err.message}\n`);
  process.exit(1);
}

// ─── Graceful Shutdown ──────────────────────────────────────────

function shutdown() {
  process.stderr.write('[axip-mcp] Shutting down...\n');
  if (agent) agent.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
