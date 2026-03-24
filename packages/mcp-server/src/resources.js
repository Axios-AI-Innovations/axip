/**
 * AXIP MCP Server — Resource Definitions
 *
 * Exposes AXIP network data as MCP resources.
 */

/**
 * Register all AXIP resources on the MCP server.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {import('@axip/sdk').AXIPAgent} agent
 */
export function registerResources(server, agent) {

  // ─── axip://capabilities ────────────────────────────────────────

  server.resource(
    'axip-capabilities',
    'axip://capabilities',
    { mimeType: 'application/json', description: 'All capabilities available on the AXIP network' },
    async () => {
      agent.send('status_request', 'relay', {});

      const capabilities = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          agent.off('status_result', onResult);
          resolve([]);
        }, 5000);

        function onResult(m) {
          if (m.type !== 'status_result') return;
          clearTimeout(timeout);
          agent.off('status_result', onResult);
          resolve(m.payload?.capabilities || []);
        }

        agent.on('status_result', onResult);
      });

      return {
        contents: [{
          uri: 'axip://capabilities',
          mimeType: 'application/json',
          text: JSON.stringify({ capabilities, count: capabilities.length }, null, 2)
        }]
      };
    }
  );

  // ─── axip://leaderboard ─────────────────────────────────────────

  server.resource(
    'axip-leaderboard',
    'axip://leaderboard',
    { mimeType: 'application/json', description: 'Top 10 agents by reputation on the AXIP network' },
    async () => {
      agent.send('leaderboard_request', 'relay', { limit: 10 });

      const entries = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          agent.off('leaderboard_result', onResult);
          resolve([]);
        }, 5000);

        function onResult(m) {
          if (m.type !== 'leaderboard_result') return;
          clearTimeout(timeout);
          agent.off('leaderboard_result', onResult);
          resolve(m.payload?.agents || []);
        }

        agent.on('leaderboard_result', onResult);
      });

      return {
        contents: [{
          uri: 'axip://leaderboard',
          mimeType: 'application/json',
          text: JSON.stringify({ leaderboard: entries, count: entries.length }, null, 2)
        }]
      };
    }
  );
}
