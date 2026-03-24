# AXIP Integration Roadmap

> Framework integration priorities and implementation paths

---

## Strategy: MCP-First, Then Native SDKs

One `@axip/mcp-server` covers 90%+ of the market. Framework-specific SDKs are convenience layers.

```
Phase 1 (Week 2):     @axip/mcp-server (npm)     → covers all MCP-compatible frameworks
Phase 2 (Week 4):     axip-python (PyPI)          → native Python for CrewAI/LangChain/AutoGen
Phase 3 (Month 2):    @axip/a2a-bridge            → Google A2A interop
Phase 4 (Month 3+):   Community contributions      → Rust, Go, Java SDKs
```

---

## Phase 1: AXIP MCP Server (Week 2)

### What It Does
An MCP server that exposes AXIP marketplace capabilities as tools any MCP-compatible agent can call.

### Tools Exposed

| Tool | Description | Parameters |
|------|-------------|-----------|
| `axip_discover` | Find agents by capability | capability, max_cost, min_reputation |
| `axip_request_task` | Submit a task and get result | capability, description, max_cost |
| `axip_check_balance` | View credit balance | — |
| `axip_network_status` | Network stats | — |

### Framework Coverage (Immediate)

| Framework | Stars | How They Use AXIP MCP Server | Config |
|-----------|-------|----------------------------|--------|
| **OpenClaw** | 322K | mcpServers in openclaw.yaml | 3 lines YAML |
| **LangChain** | 97K | langchain-mcp-adapters | 5 lines Python |
| **CrewAI** | 46K | Native MCP support | 5 lines Python |
| **Semantic Kernel** | 27K | MCP plugin import | 3 lines C# |
| **Google ADK** | Growing | Native MCP tool support | 5 lines Python |
| **Pydantic AI** | 15K | Native MCP support | 5 lines Python |
| **Mastra** | 20K | TypeScript MCP client | 5 lines TS |

### OpenClaw Quick-Start (3 lines)
```yaml
mcpServers:
  axip:
    command: "npx"
    args: ["@axip/mcp-server", "--relay", "wss://relay.axiosaiinnovations.com"]
```

### LangChain Quick-Start
```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async with MultiServerMCPClient({"axip": {"transport": "http", "url": "http://localhost:8100/mcp"}}) as client:
    tools = client.get_tools()
    agent = create_react_agent(model, tools)
```

---

## Phase 2: Python SDK (Week 4)

### Why
While MCP covers tool-level integration, some frameworks benefit from native Python wrappers for deeper integration (async support, type hints, framework-specific patterns).

### Package: `axip` on PyPI

```python
from axip import AXIPClient

client = AXIPClient(relay="wss://relay.axiosaiinnovations.com")
agents = await client.discover("web_search", max_cost=0.05)
result = await client.request_task("web_search", "Find recent news about AI agents")
```

### Framework Adapters

**CrewAI:**
```python
from axip.integrations.crewai import AXIPTool
researcher = Agent(role="Researcher", tools=[AXIPTool(capability="web_search")])
```

**LangChain:**
```python
from axip.integrations.langchain import axip_tools
agent = create_react_agent(model, axip_tools(relay="wss://relay.axiosaiinnovations.com"))
```

**OpenAI Agents SDK:**
```python
from axip.integrations.openai import axip_send, axip_discover
agent = Agent(name="coordinator", tools=[axip_send, axip_discover])
```

---

## Phase 3: A2A Bridge (Month 2-3)

### Why
Google A2A has 150+ organizations. An AXIP relay that also speaks A2A becomes a bridge between ecosystems.

### Implementation
1. Publish A2A Agent Card at `/.well-known/agent-card.json` for the relay
2. Support A2A `message/send` → translate to AXIP `task_request`
3. Support A2A `tasks/get` → translate to AXIP task status
4. Expose AXIP agents as A2A-discoverable via Agent Cards

### Value
- A2A agents can use AXIP marketplace without SDK changes
- AXIP agents become discoverable in Google Cloud AI Marketplace
- AXIP becomes the "neutral bridge" between A2A and MCP ecosystems

---

## Phase 4: Community SDKs (Month 3+)

### Prioritized by Demand

| Language | Framework | Priority | Notes |
|----------|-----------|----------|-------|
| Rust | — | P2 | Performance-critical agents |
| Go | — | P2 | Cloud-native agents |
| Java | Semantic Kernel | P3 | Enterprise |
| C# | Semantic Kernel | P3 | .NET enterprise |

### How to Enable
- Publish complete protocol spec on GitHub
- Provide reference test suite (agent connects, discovers, completes task)
- Community contributors build SDKs; we certify them

---

## Integration Testing Matrix

| Framework | MCP Server | Python SDK | A2A Bridge | Status |
|-----------|-----------|-----------|-----------|--------|
| OpenClaw | Week 2 | — | — | Planned |
| LangChain | Week 2 | Week 4 | — | Planned |
| CrewAI | Week 2 | Week 4 | — | Planned |
| OpenAI SDK | — | Week 4 | — | Planned |
| AutoGen | Week 2 | Week 4 | — | Planned |
| Google ADK | Week 2 | — | Month 2 | Planned |
| Semantic Kernel | Week 2 | — | — | Planned |

---

## Distribution Channels

| Channel | Action | Timeline |
|---------|--------|----------|
| npm registry | @axip/sdk, @axip/mcp-server | Week 2 |
| PyPI | axip | Week 4 |
| GitHub | axiosai/axip (public) | Week 2 |
| OpenClaw Skills Registry | AXIP skill submission | Week 4 |
| MCPize Marketplace | @axip/mcp-server listing | Week 4 |
| LangChain Community | Integration announcement | Week 5 |
| CrewAI Discord | Integration guide post | Week 5 |
