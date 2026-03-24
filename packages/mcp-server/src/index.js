/**
 * AXIP MCP Server — Entry Point
 *
 * Creates and configures an MCP server that exposes AXIP marketplace
 * capabilities as tools and resources.
 *
 * Usage:
 *   import { createAXIPMCPServer } from '@axip/mcp-server';
 *   const { server, agent } = await createAXIPMCPServer({ relayUrl, agentName });
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AXIPAgent } from '@axip/sdk';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

export { registerTools } from './tools.js';
export { registerResources } from './resources.js';

/**
 * Create and configure an AXIP MCP Server instance.
 *
 * @param {Object} opts
 * @param {string} [opts.relayUrl='ws://127.0.0.1:4200'] - AXIP relay WebSocket URL
 * @param {string} [opts.agentName='mcp-client'] - Name for this MCP client agent
 * @returns {Promise<{ server: McpServer, agent: AXIPAgent }>}
 */
export async function createAXIPMCPServer({
  relayUrl = process.env.AXIP_RELAY_URL || 'ws://127.0.0.1:4200',
  agentName = 'mcp-client'
} = {}) {
  // Create the AXIP agent (acts as a client — no capabilities to offer)
  const agent = new AXIPAgent({
    name: agentName,
    capabilities: [],
    relayUrl
  });

  // Create the MCP server using the high-level McpServer API
  const server = new McpServer(
    { name: '@axip/mcp-server', version: '0.1.0' }
  );

  // Register tools and resources
  registerTools(server, agent);
  registerResources(server, agent);

  // Connect to the AXIP relay
  await agent.start();

  return { server, agent };
}
