# Agent-to-Agent Communication Protocols & Standards

> Generated: 2026-03-18 | Scope: Comprehensive survey of all agent protocols as of March 2026

---

## Executive Summary

The agent protocol landscape is rapidly consolidating around two anchors:
- **MCP** (Anthropic) — Universal tool/context integration. Already the dominant standard.
- **A2A** (Google) — Agent-to-agent communication. Most mature inter-agent protocol.

Payment, discovery, and identity layers remain fragmented. AXIP's opportunity is at the **marketplace layer** — discovery + bidding + settlement + reputation — which no existing protocol addresses.

### The 2026 Protocol Stack

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer:        AG-UI (runtime) + A2UI (declarative)      │
├─────────────────────────────────────────────────────────────┤
│  Payment Layer:   AP2 / ACP (Stripe) / x402 / Visa TAP     │
├─────────────────────────────────────────────────────────────┤
│  MARKETPLACE:     >>> AXIP opportunity <<<                   │
│                   (discovery + bidding + settlement +         │
│                    reputation — NO existing protocol here)   │
├─────────────────────────────────────────────────────────────┤
│  Agent-to-Agent:  A2A (primary) + SLIM (messaging)          │
├─────────────────────────────────────────────────────────────┤
│  Tool/Context:    MCP (dominant standard)                    │
├─────────────────────────────────────────────────────────────┤
│  Discovery:       NANDA / AGNTCY Directory / ANP            │
├─────────────────────────────────────────────────────────────┤
│  Identity:        LOKA / DIDs / ERC-8004 / Visa TAP         │
├─────────────────────────────────────────────────────────────┤
│  On-chain Trust:  ERC-8004 / Solana Agent Registry           │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Google A2A (Agent2Agent) Protocol

**Status: Moderate-High Maturity** | 150+ organizations | Linux Foundation governance

### What It Is
Open protocol for agent-to-agent collaboration. Agents communicate without exposing internal state, memory, or tools.

### Architecture
```
┌──────────┐   Discovery    ┌──────────────────┐
│ A2A      │◄──────────────►│ Agent Card       │
│ Client   │  (well-known)  │ (JSON @ /.well-  │
│ (Agent)  │                │  known/agent.json)│
└────┬─────┘                └──────────────────┘
     │
     │  JSON-RPC 2.0 / gRPC (v0.3+) over HTTPS/TLS
     ▼
┌──────────┐
│ A2A      │──► Task (stateful lifecycle)
│ Server   │──► Messages (user/agent roles)
│ (Agent)  │──► Artifacts (output: files, data)
└──────────┘──► Parts (TextPart/FilePart/DataPart)
```

### Key Details
- **Version**: v0.3 (July 2025). Draft v1.0 in progress.
- **Transport**: JSON-RPC 2.0 over HTTP, SSE streaming, gRPC over HTTP/2
- **Discovery**: Agent Cards at `/.well-known/agent-card.json`
- **Security**: OAuth, API Key, HTTP Bearer/JWT. Per-skill OAuth scopes. Card signing (v0.3+).
- **Task States**: working → completed | canceled | rejected | failed
- **Key Methods**: `message/send`, `message/stream`, `tasks/get`, `tasks/resubscribe`
- **Backers**: Google, Microsoft, Amazon, SAP, Salesforce, ServiceNow, 150+ orgs
- **Governance**: Apache 2.0, Linux Foundation

### Gaps
- No built-in payment/settlement
- Agent Card signing supported but not enforced (spoofing risk)
- No protocol-level token lifetime enforcement
- No marketplace mechanics (bidding, reputation, pricing)

### AXIP Relationship
A2A handles communication; AXIP handles marketplace economics. They are complementary. AXIP could use A2A as a transport layer while adding bidding, settlement, and reputation on top.

---

## 2. Anthropic MCP (Model Context Protocol)

**Status: High Maturity** | 10,000+ servers | 97M+ monthly SDK downloads | Linux Foundation (AAIF)

### What It Is
Universal connector ("USB-C for AI") for how LLMs access external tools, data sources, and systems. Tool integration standard, not agent-to-agent.

### Architecture
```
┌─────────────────────────────────┐
│           MCP Host              │
│  (Claude, ChatGPT, Cursor,     │
│   VS Code, Gemini, Copilot)    │
│  ┌──────────┐  ┌──────────┐   │
│  │MCP Client│  │MCP Client│   │  1:1 mapping per server
│  └────┬─────┘  └────┬─────┘   │
└───────┼──────────────┼─────────┘
        │              │
   JSON-RPC 2.0   JSON-RPC 2.0
   (stdio or      (Streamable HTTP)
    HTTP+SSE)
        │              │
┌───────▼─────┐  ┌────▼────────┐
│ MCP Server  │  │ MCP Server  │
│ Exposes:    │  │ Exposes:    │
│ - Tools     │  │ - Tools     │
│ - Resources │  │ - Resources │
│ - Prompts   │  │ - Prompts   │
└─────────────┘  └─────────────┘
```

### Key Details
- **Primitives**: Tools (functions), Resources (data), Prompts (templates)
- **Transport**: stdio (local), Streamable HTTP (remote)
- **Security**: OAuth 2.1 with mandatory PKCE, Client ID Metadata Documents
- **Adoption**: OpenAI (Mar 2025), Google (Apr 2025), Microsoft (May 2025)
- **Governance**: AAIF under Linux Foundation. Co-founded by Anthropic, Block, OpenAI.
- **Known Issues**: ~2,000 exposed servers with zero auth (July 2025). Prompt injection and tool shadowing remain active attack surfaces.

### A2A vs MCP
```
Agent A ──(A2A)──► Agent B ──(MCP)──► Database Server
                                  ──► API Server
                                  ──► File Server
```
MCP = agent-to-tool. A2A = agent-to-agent. Complementary.

### AXIP Relationship
**AXIP should expose itself as an MCP server.** This is the highest-leverage integration path — one `@axip/mcp-server` package makes AXIP accessible to every MCP-compatible framework (OpenClaw, LangChain, CrewAI, etc.).

---

## 3. NANDA Protocol (MIT)

**Status: Early-Moderate** | 1,000+ agents | 15 universities | Academic

### What It Is
Decentralized discovery, identity, and routing infrastructure. "DNS for agents" with cryptographic verification and sub-second updates.

### Architecture
```
┌─────────────────────────────────────────────┐
│              Registry Quilt                  │
│  (Federation across autonomous registries)   │
│  ┌──────────┐  Cross-sign  ┌──────────┐    │
│  │Registry A│◄────────────►│Registry B│    │
│  └────┬─────┘   & Gossip   └────┬─────┘    │
└───────┼──────────────────────────┼──────────┘
        ▼                          ▼
┌──────────────────────────────────────────┐
│              NANDA Index                  │
│  Maps: @agent-handle → AgentFacts        │
│  Hosted at 15+ institutions              │
└────────────────────┬─────────────────────┘
                     ▼
┌──────────────────────────────────────────┐
│          AgentFacts (JSON-LD)             │
│  - W3C Verifiable Credentials v2         │
│  - Ed25519 signatures                    │
│  - Short-lived credentials (<5 min)      │
│  - Sub-second revocation                 │
└──────────────────────────────────────────┘
```

### Key Details
- **Discovery**: Registry Quilt using gossip + CRDTs for cross-registry sync
- **Identity**: AgentFacts as W3C Verifiable Credentials, Ed25519 signed
- **Five Guarantees**: Federated index, rapid resolution, sub-second revocation, schema-validated capabilities, privacy-preserving discovery
- **Why Not DNS**: DNS update cycles too slow (minutes), no trust/attestation model
- **Payment**: No native payment layer
- **Backers**: MIT Media Lab, 18 research institutions

### AXIP Relationship
NANDA is a discovery/identity layer. AXIP could register agents in NANDA for broader discoverability while maintaining its own relay-based marketplace internally.

---

## 4. LOKA Protocol (CMU)

**Status: Very Early (Research)** | Academic paper only | No implementation

### What It Is
Decentralized framework for trustworthy AI agent ecosystems. Four layers:
1. **Identity (UAIL)**: W3C DIDs — agent controls own identity
2. **Governance**: Intent-centric communication with ethical annotations
3. **Security**: Post-quantum cryptography (NIST PQC standards)
4. **Consensus**: Decentralized Ethical Consensus Protocol (DECP)

### AXIP Relationship
Conceptually interesting (post-quantum crypto, ethical consensus) but years from practical deployment. Monitor for identity standards influence.

---

## 5. Google Agent Payments Protocol (AP2)

**Status: Early-Moderate** | 60+ organizations

### What It Is
Open protocol for AI-agent-initiated purchases. Trust/authorization framework for agentic commerce.

### Key Details
- **Two-Mandate System**: Intent Mandate (authorize search) → Cart Mandate (authorize purchase)
- **Auto-mandate**: Fully automated purchasing with detailed constraints
- **VDCs**: Verifiable Digital Credentials — tamper-evident audit trail
- **Payment Rails**: Cards initially; bank transfers, digital currencies on roadmap
- **UCP Integration**: Universal Commerce Protocol handles catalog/checkout; AP2 handles trust/payment
- **Backers**: Mastercard, PayPal, Adyen, Salesforce, Shopify, Cloudflare

### AXIP Relationship
AP2 is for e-commerce (agent buys products). AXIP is for agent-to-agent services (agent buys capabilities). Different use cases, but AP2's VDC concept and mandate system could inform AXIP's settlement design.

---

## 6. Visa Trusted Agent Protocol (TAP)

**Status: Moderate** | 100+ partners | Real transactions completed

### What It Is
Cryptographic verification framework. Merchants distinguish legitimate AI agents from bots.

### Key Details
- **Onboarding**: Visa vets agents, assigns Ed25519 keypairs
- **Three Data Elements**: Agent Intent, Consumer Recognition, Payment Information
- **Verification**: Merchant checks agent signature against Visa registry
- **Centralized**: Visa is the gatekeeper — strength for trust, weakness for openness
- **Projection**: Millions of agent-completed purchases by 2026 holiday season

### AXIP Relationship
Different trust model. Visa TAP = centralized verification for commerce. AXIP = decentralized reputation for services. TAP's Ed25519 approach mirrors AXIP's existing crypto.

---

## 7. Blockchain Agent Registries

### Solana Agent Registry
- Launched March 2026. 9,000+ agents.
- Three on-chain registries: Identity (NFT), Reputation (on-chain scores), Validation (zkML, TEE, staking)
- Cross-chain with ERC-8004

### ERC-8004 (Ethereum)
- Live on mainnet Jan 2026. Backed by MetaMask, Ethereum Foundation, Google, Coinbase.
- Minimalist: identity NFT → agent card JSON. No token, no payment layer (integrates x402).
- Crypto-economic validation with slashing.

### AXIP Relationship
AXIP's Ed25519 identity could bridge to ERC-8004 for on-chain reputation. The Solana registry's reputation model could complement AXIP's EMA-based system.

---

## 8. Other Notable Protocols

| Protocol | Layer | Status | Key Detail |
|----------|-------|--------|------------|
| **ANP** (Agent Network Protocol) | Agent Network | Early | "HTTP for Agentic Web." W3C Working Group forming. |
| **ACP** (IBM/BeeAI) | Messaging | Deprecated | Merged into A2A (Aug 2025) |
| **ACP** (Stripe/OpenAI) | Commerce | Moderate | Powers ChatGPT "Instant Checkout." Shared Payment Tokens. |
| **x402** (Coinbase) | Micropayments | Moderate | HTTP 402 + USDC on-chain. 75M txns, $24M processed. |
| **AG-UI** | Agent→Frontend | Early | Event-based protocol for real-time UI updates |
| **A2UI** (Google) | Agent→UI | Early | Declarative JSON → native widgets |
| **AGNTCY** (Cisco/LF) | Infrastructure | Early-Moderate | SLIM messaging (quantum-safe gRPC), 65+ companies |

---

## 9. Interoperability & Convergence

### Can Agents Speak Multiple Protocols?
Yes — this is the expected pattern. A2A Agent Cards support multiple transports. ERC-8004 agent cards advertise A2A, MCP, ENS, DID, and wallet endpoints simultaneously.

### Protocol Relationships
| Pairing | How They Work Together |
|---------|----------------------|
| MCP + A2A | MCP for tools, A2A for agent collaboration |
| A2A + AP2 | AP2 extends A2A for payment flows |
| A2A + ACP (Stripe) | ACP at checkout, A2A for coordination |
| NANDA + MCP + A2A | NANDA discovers agents; resolves to MCP/A2A endpoints |
| AGNTCY + A2A + MCP | AGNTCY directories + SLIM messaging |
| ERC-8004 + x402 | On-chain identity + on-chain micropayments |

### Convergence Timeline
- **Now**: MCP (tools) + A2A (agents) as practical foundation
- **2026**: AAIF/Linux Foundation consolidating governance
- **2027+**: IETF `agent://` URI standard, W3C formal specs

---

## 10. Standards Bodies

| Body | What They're Doing | Key Projects |
|------|-------------------|--------------|
| **Linux Foundation (AAIF)** | Primary governance home | MCP, Goose, AGENTS.md |
| **Linux Foundation (A2A)** | A2A protocol stewardship | A2A, AGNTCY |
| **IETF** | Internet-Drafts for agents | `agent://` URI, HTTP agent discovery, SCIM for agents |
| **W3C** | Web standards for agents | AI Agent Protocol Community Group, ANP Working Group |
| **Ethereum Foundation** | On-chain agent identity | ERC-8004, dAI team |
| **x402 Foundation** | Crypto micropayment standard | x402 + Coinbase/Cloudflare |

---

## Key Takeaways for AXIP Product Planning

1. **AXIP fills a unique gap**: No existing protocol provides discovery + bidding + settlement + reputation as a marketplace. A2A handles communication, MCP handles tools, payment protocols handle money — but none combine them into a marketplace.

2. **Build on MCP + A2A, don't compete**: AXIP should expose itself as an MCP server and potentially support A2A Agent Cards for discovery. Don't reinvent transport or tool calling.

3. **Payment layer is fragmented**: Stripe ACP for cards, x402 for crypto, AP2 for trust mandates. AXIP should support multiple payment rails rather than picking one.

4. **Identity convergence coming**: DIDs, ERC-8004, and Visa TAP all use Ed25519 (same as AXIP). Position for interoperability by supporting standard agent identity formats.

5. **Governance matters**: Being under Linux Foundation (AAIF) would give AXIP credibility. Consider contributing AXIP spec to AAIF or AGNTCY.
