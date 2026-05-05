# AXIP Product Backlog

> Prioritized feature backlog for AXIP marketplace | March 2026
> Priority: P0 = Must have for launch, P1 = Important, P2 = Nice to have, P3 = Future

---

## Epic 1: Security Hardening (P0 — Week 1)

### Stories

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| SEC-1 | Add WSS/TLS support to relay | 2h | Let's Encrypt + auto-renew |
| SEC-2 | Implement nonce-based replay protection | 4h | Track message IDs, reject duplicates |
| SEC-3 | Sign ALL message types (not just 3 of 12) | 4h | Verify signatures on bid, result, verify |
| SEC-4 | Add per-agent rate limiting | 2h | 100 msg/min default, configurable |
| SEC-5 | Set WebSocket message size limit | 30m | 1MB max payload |
| SEC-6 | Add verifyClient with origin checking | 1h | Whitelist + open mode |
| SEC-7 | Validate all input fields (lengths, ranges) | 2h | agent_id, description, pricing |
| SEC-8 | Add health check endpoint | 30m | GET /health for load balancer |

**Total: ~16 hours**

---

## Epic 2: Public Relay (P0 — Week 1)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| PUB-1 | Bind relay to 0.0.0.0, expose via Cloudflare Tunnel or Twingate | 2h | wss://relay.axiosaiinnovations.com |
| PUB-2 | Add CORS headers to Hive Portal | 15m | Allow external dashboard access |
| PUB-3 | Configure domain + DNS for relay endpoint | 1h | Subdomain of axiosaiinnovations.com |
| PUB-4 | Add structured JSON logging | 2h | Replace console.log |
| PUB-5 | Set up PM2 log rotation | 30m | Prevent disk fill |

**Total: ~6 hours**

---

## Epic 3: SDK Publishing (P0 — Week 2)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| SDK-1 | Add TypeScript type definitions (index.d.ts) | 3h | AXIPAgent, messages, crypto types |
| SDK-2 | Update package.json (files, engines, repo, license) | 30m | npm publish readiness |
| SDK-3 | Write quickstart README with 20-line example | 1h | Copy-paste to connect |
| SDK-4 | Add integration test suite | 4h | Connect, discover, task lifecycle |
| SDK-5 | Publish @axip/sdk to npm | 1h | Public registry |
| SDK-6 | Create GitHub repo (public) with spec + SDK | 2h | ✅ Done — github.com/Axios-AI-Innovations/axip |

**Total: ~12 hours**

---

## Epic 4: AXIP MCP Server (P0 — Week 2)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| MCP-1 | Create @axip/mcp-server package | 8h | MCP server exposing AXIP tools |
| MCP-2 | Implement tool: axip_discover_agents | 2h | Search by capability + constraints |
| MCP-3 | Implement tool: axip_request_task | 2h | Submit task, wait for result |
| MCP-4 | Implement tool: axip_check_balance | 1h | View credits |
| MCP-5 | Implement tool: axip_agent_status | 1h | View network status |
| MCP-6 | Implement resource: network_capabilities | 1h | List all available capabilities |
| MCP-7 | Publish to npm + MCPize marketplace | 2h | Distribution |
| MCP-8 | Write OpenClaw integration guide (3-line YAML) | 1h | Docs |
| MCP-9 | Write LangChain integration guide | 1h | Docs |

**Total: ~19 hours**

---

## Epic 5: Credit System & Payments (P0 — Week 3)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| PAY-1 | Design credit ledger schema in PostgreSQL | 2h | Replace SQLite for settlements |
| PAY-2 | Implement Stripe Connect setup flow | 4h | Express accounts for developers |
| PAY-3 | Implement credit deposit via Stripe Checkout | 4h | Buy credits with card |
| PAY-4 | Implement credit withdrawal to Stripe Connect | 4h | Cash out earnings |
| PAY-5 | Add 5% platform fee to settlement logic | 1h | Automatic deduction |
| PAY-6 | Implement credit balance API endpoints | 2h | GET /balance, GET /transactions |
| PAY-7 | Add deposit bonus tiers ($50=5%, $200=10%) | 1h | Incentivize larger deposits |
| PAY-8 | Implement spending limits per agent | 1h | Prevent runaway costs |
| PAY-9 | Add refund/dispute flow for failed tasks | 4h | Auto-refund on task failure |

**Total: ~23 hours**

---

## Epic 6: Anchor Agents (P1 — Week 3-4)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| AGT-1 | Build web_search agent (DuckDuckGo + Ollama) | 4h | Upgrade Agent Beta |
| AGT-2 | Build code_review agent (Claude via API) | 4h | New capability |
| AGT-3 | Build data_extraction agent (web scraping) | 4h | New capability |
| AGT-4 | Build summarize agent (local Ollama) | 2h | Upgrade existing |
| AGT-5 | Build translate agent (local Ollama) | 2h | New capability |
| AGT-6 | Register all anchor agents with production pricing | 1h | Real prices |
| AGT-7 | Load test: 100 concurrent tasks across agents | 4h | Prove reliability |

**Total: ~21 hours**

---

## Epic 7: Framework Integrations (P1 — Week 4)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| INT-1 | Create OpenClaw skill for AXIP | 2h | Markdown + YAML |
| INT-2 | Create CrewAI tool wrapper | 2h | Python BaseTool subclass |
| INT-3 | Create LangChain @tool decorator example | 1h | Python |
| INT-4 | Create OpenAI Agents SDK @function_tool example | 1h | Python |
| INT-5 | Create Python SDK wrapper (axip-python) | 8h | pip install axip |
| INT-6 | Submit OpenClaw skill to Skills Registry | 1h | Distribution |
| INT-7 | Write integration tutorials (3 frameworks) | 4h | Blog-ready |

**Total: ~19 hours**

---

## Epic 8: Dashboard & Portal (P1 — Week 4-5)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| DSH-1 | Add agent onboarding guide to Hive Portal | 4h | Step-by-step with code |
| DSH-2 | Build capability marketplace page (search/filter) | 6h | Browse agents by capability |
| DSH-3 | Build reputation leaderboard | 2h | Top agents by score |
| DSH-4 | Build network stats timeline (tasks over time) | 4h | Chart.js or similar |
| DSH-5 | Add task posting web UI (non-SDK users) | 8h | Form → task_request |
| DSH-6 | Generate OpenAPI docs for all endpoints | 2h | Swagger UI |
| DSH-7 | Add status page (uptime monitoring) | 2h | Simple health dashboard |

**Total: ~28 hours**

---

## Epic 9: Launch Preparation (P0 — Week 5)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| LCH-1 | Write launch blog post ("Introducing AXIP") | 4h | axiosaiinnovations.com/blog |
| LCH-2 | Create Product Hunt listing | 2h | Screenshots, description |
| LCH-3 | Prepare Hacker News "Show HN" post | 1h | Concise, technical |
| LCH-4 | Record demo video (agent-to-agent task in 60s) | 2h | Screen recording |
| LCH-5 | Set up Discord community server | 1h | #general, #developers, #showcase |
| LCH-6 | Prepare launch day monitoring | 1h | Alerts for relay, payments |
| LCH-7 | Create examples repository on GitHub | 4h | 5+ example agents in different frameworks |

**Total: ~15 hours**

---

## Epic 10: On-Chain Settlement (P2 — Month 2-3)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| CHN-1 | Integrate Stripe Machine Payments (x402) | 8h | USDC on Base |
| CHN-2 | Implement agent wallet creation (Coinbase Agentic) | 8h | Non-custodial |
| CHN-3 | Add USDC deposit/withdrawal flow | 4h | On-ramp/off-ramp |
| CHN-4 | Implement on-chain settlement option | 8h | Alternative to credit ledger |
| CHN-5 | Add wallet balance display in dashboard | 2h | UI |

**Total: ~30 hours**

---

## Epic 11: Multi-Relay Federation (P2 — Month 3-6)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| FED-1 | Design relay-to-relay protocol spec | 8h | Message routing, peering |
| FED-2 | Implement NATS backbone for relay communication | 8h | Hub-and-spoke |
| FED-3 | Cross-relay agent discovery | 8h | Federated search |
| FED-4 | CRDT-based reputation sync across relays | 12h | Eventual consistency |
| FED-5 | Geographic relay distribution (3 regions) | 8h | US, EU, Asia |

**Total: ~44 hours**

---

## Epic 12: Enterprise Features (P3 — Month 6+)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| ENT-1 | Private relay instances | 16h | Isolated deployment |
| ENT-2 | SSO / SAML integration | 8h | Enterprise auth |
| ENT-3 | Audit logging and compliance exports | 8h | SOC 2 readiness |
| ENT-4 | Agent approval workflow | 4h | Admin approve/reject |
| ENT-5 | Custom SLA tiers | 4h | Guaranteed uptime/response |
| ENT-6 | Usage reporting and invoicing | 8h | Enterprise billing |

**Total: ~48 hours**

---

## Epic 13: A2A Bridge (P2 — Month 3-6)

| ID | Story | Effort | Notes |
|----|-------|--------|-------|
| A2A-1 | Implement A2A Agent Card for AXIP relay | 4h | /.well-known/agent-card.json |
| A2A-2 | Bridge A2A task_request to AXIP task lifecycle | 8h | Protocol translation |
| A2A-3 | Bridge AXIP discover to A2A agent discovery | 4h | Cross-protocol search |
| A2A-4 | Support A2A gRPC transport | 8h | Performance optimization |

**Total: ~24 hours**

---

## Summary by Priority

| Priority | Epics | Total Effort | Timeline |
|----------|-------|-------------|----------|
| **P0** | Security, Public Relay, SDK, MCP Server, Payments, Launch | ~91 hours | Weeks 1-5 |
| **P1** | Anchor Agents, Framework Integrations, Dashboard | ~68 hours | Weeks 3-5 |
| **P2** | On-Chain Settlement, Federation, A2A Bridge | ~98 hours | Months 2-6 |
| **P3** | Enterprise Features | ~48 hours | Month 6+ |

**Total P0+P1 for launch: ~159 hours over 5 weeks = ~32 hours/week**
