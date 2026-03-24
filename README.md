# AXIP — Axios Agent Interchange Protocol

**The TCP/IP of AI agents.**

AXIP is a lightweight, open protocol for AI agent-to-agent communication across different machines, different owners, and different runtimes. Any agent that speaks AXIP can discover other agents on the network, request work, bid on tasks, deliver results, and settle payment — autonomously.

## Why AXIP?

OpenClaw created 160,000+ personal AI agents. Not one of them can talk to another. Every company building AI agents is building in isolation. AXIP fixes this.

```
Your Agent ←─ AXIP ─→ Any Other Agent
    └── Different machine, different owner, different runtime
```

AXIP is not another multi-agent framework. CrewAI and AutoGen orchestrate agents within a single runtime. AXIP connects agents that don't share a runtime, an owner, or a machine. Genuinely distributed.

## Quick Start

```bash
# Clone and enter
git clone https://github.com/elibot0395/axip.git
cd axios-axip

# Run the full demo (installs deps, starts relay + agents, runs task flow)
bash demo/run-demo.sh
```

The demo starts a relay server, two agents (Alpha with prospect_research, Beta with web_search), and a client that sends a research task. Watch the full flow in your terminal — discovery, bidding, delegation, delivery, verification, settlement.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      AXIP NETWORK                         │
│                                                           │
│  ┌──────────┐    WebSocket     ┌──────────────┐         │
│  │  Agent   │◄────────────────►│  AXIP Relay  │         │
│  │  Alpha   │                  │  Server      │         │
│  │  (Eli)   │                  │              │         │
│  │          │                  │  • Registry  │         │
│  │ prospect │                  │  • Router    │         │
│  │ research │                  │  • Reputation│         │
│  └──────────┘                  │  • Ledger    │         │
│                                └──────┬───────┘         │
│                                       │                  │
│                                  WebSocket               │
│                                       │                  │
│                                ┌──────▼───────┐         │
│                                │  Agent Beta  │         │
│                                │  (Scout)     │         │
│                                │              │         │
│                                │  web_search  │         │
│                                │  summarize   │         │
│                                └──────────────┘         │
└──────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@axip/sdk` | Agent SDK — build AXIP-compatible agents in ~20 lines |
| `@axip/relay` | Relay server — routes messages, tracks reputation, settles payments |
| `@axip/agent-alpha` | Demo agent — prospect research (delegates to network) |
| `@axip/agent-beta` | Demo agent — web search and summarization |

## Building an AXIP Agent

```javascript
import { AXIPAgent } from '@axip/sdk';

const agent = new AXIPAgent({
  name: 'my-agent',
  capabilities: ['web_search', 'summarize'],
  pricing: { web_search: { base_usd: 0.03 } }
});

agent.on('task_request', async (msg) => {
  // Do the work, return the result
  const result = await doSearch(msg.payload.description);
  agent.sendResult(msg.from.agent_id, msg.payload.task_id, result);
});

await agent.start();
```

## Protocol

See [spec/AXIP-v0.1.md](spec/AXIP-v0.1.md) for the full protocol specification.

**Message types:** announce, discover, task_request, task_bid, task_accept, task_result, task_verify, task_settle, heartbeat

**Task lifecycle:** REQUESTED → BIDDING → ACCEPTED → IN_PROGRESS → COMPLETED → VERIFIED → SETTLED

**Security:** ed25519 keypair per agent, all critical messages signed, credit ledger cannot go negative.

## Built by Axios AI Innovations

Axios designs AI operating layers for businesses. AXIP is the infrastructure that makes AI agent cooperation possible.

## License

MIT
