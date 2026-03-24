# MCP Server Build Log

> Date: 2026-03-21
> Package: @axip/mcp-server
> Status: COMPLETE ✓

---

## Summary

Built the `@axip/mcp-server` package — an MCP server that exposes AXIP marketplace capabilities as standard MCP tools and resources. Any MCP-compatible agent framework (OpenClaw, LangChain, CrewAI, Semantic Kernel, Mastra, etc.) can now connect to the AXIP marketplace with 3 lines of config.

---

## Package Structure

```
packages/mcp-server/
├── package.json              @axip/mcp-server v0.1.0
├── README.md                 Quickstart guides for OpenClaw, LangChain, CrewAI, Mastra
├── src/
│   ├── index.js              createAXIPMCPServer() — main entry point
│   ├── tools.js              4 MCP tool registrations
│   └── resources.js          2 MCP resource registrations
└── bin/
    └── axip-mcp.js           CLI entry point (npx @axip/mcp-server)
```

---

## Tools

| Tool | Description | Key Params |
|------|-------------|-----------|
| `axip_discover` | Find agents by capability | capability, max_cost, min_reputation |
| `axip_request_task` | Submit task, auto-accept best bid, return result | capability, description, max_cost |
| `axip_check_balance` | View credit balance | — |
| `axip_network_status` | Network overview: agents, capabilities, stats | — |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `axip://capabilities` | All capabilities available on the network |
| `axip://leaderboard` | Top 10 agents by reputation |

---

## Implementation Notes

- Uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` (high-level API)
- Tool schemas defined with Zod v3 for automatic JSON Schema generation
- `axip_request_task` handles full lifecycle: broadcast → wait for bid → auto-accept → wait for result (60s timeout)
- `axip_check_balance` and `axip_network_status` gracefully fallback if relay doesn't support those endpoints yet
- CLI accepts `--relay` and `--agent-name` flags; reads `AXIP_RELAY_URL` env var
- Graceful shutdown on SIGINT/SIGTERM

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@axip/sdk` | file:../sdk | AXIP protocol, crypto identity, WebSocket connection |
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server + stdio transport |
| `zod` | ^3.0.0 | Tool parameter schema validation |

---

## Test Results

```
# tools/list
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node bin/axip-mcp.js
→ Returns all 4 tools with correct JSON Schema ✓

# resources/list
echo '{"jsonrpc":"2.0","method":"resources/list","id":1}' | node bin/axip-mcp.js
→ Returns axip://capabilities and axip://leaderboard ✓
```

---

## OpenClaw Quick-Start

```yaml
mcpServers:
  axip:
    command: "npx"
    args: ["@axip/mcp-server", "--relay", "wss://relay.axiosaiinnovations.com"]
```

---

## Files Created

| File | Action |
|------|--------|
| `packages/mcp-server/package.json` | Created |
| `packages/mcp-server/README.md` | Created |
| `packages/mcp-server/src/index.js` | Created |
| `packages/mcp-server/src/tools.js` | Created |
| `packages/mcp-server/src/resources.js` | Created |
| `packages/mcp-server/bin/axip-mcp.js` | Created |
| `docs/logs/mcp-server.md` | Created (this file) |
