# 5-Week Implementation Plan

> AXIP Marketplace Launch | Start: March 2026 | Target: End of April 2026

---

## Overview

| Week | Theme | Key Deliverable | Hours |
|------|-------|----------------|-------|
| 1 | Security Hardening | All messages signed, rate limiting, input validation, logging | 18h |
| 2 | SDK + MCP Server | @axip/sdk and @axip/mcp-server on npm, GitHub repo public | 31h |
| 3 | Payments + Anchor Agents | Stripe Connect, credit system, 5 production agents | 33h |
| 4 | Public Relay + Dashboard + Integrations | Hetzner VPS, DNS, framework guides, public dashboard | 34h |
| 5 | Launch + Polish | Product Hunt, HN, blog, first 100 agents target | 25h |

**Total: ~141 hours (~28h/week)**

### Infrastructure Strategy Change (March 19, 2026)
- **Dropped Cloudflare Tunnel** — domain is on Vercel, tunnels add unnecessary complexity
- **Week 1-3**: All development/testing stays local on Mac Mini. Remote access via Twingate.
- **Week 4**: Deploy public relay to **Hetzner VPS** ($9/mo). Point `relay.axiosaiinnovations.com` via CNAME in Vercel DNS.
- **Mac Mini** remains dev machine + anchor agents + Ollama. Public relay runs on VPS.
- This is better architecture: separates public-facing infra from home dev machine.

---

## Week 1: Security Hardening (Local)

### Goal
Harden the AXIP relay protocol for production. All development stays local — no public exposure yet.

### Day-by-Day

**Day 1 — Rate Limiting + Health + Validation**
- [x] SEC-4: Per-agent rate limiting (100 msg/min)
- [x] SEC-5: WebSocket message size limit (1MB)
- [x] SEC-7: Validate all input fields (lengths, ranges, types)
- [x] SEC-8: Health check endpoint (GET /health on dashboard port)

**Day 2 — Signature Hardening**
- [x] SEC-2: Nonce-based replay protection (nonce field + 1hr window + timestamp check)
- [x] SEC-3: Sign ALL message types (not just announce/accept/settle)

**Day 3 — Logging + Infrastructure**
- [x] SEC-6: verifyClient with origin logging on WebSocket
- [x] PUB-2: CORS headers on Hive Portal
- [x] PUB-4: Structured JSON logging (replace console.log in relay)
- [x] PUB-5: PM2 log rotation (pm2-logrotate module)

**Day 4 — Verification**
- [x] Restart all processes, verify clean startup
- [x] Verify agents reconnect and announce successfully with new signing
- [ ] Test rate limiting (send >100 msg/min, confirm rejection)
- [ ] Test replay protection (resend same message, confirm rejection)
- [ ] Smoke test: Full task lifecycle (request → bid → accept → result → settle)

### Exit Criteria
- [x] All messages signed and verified
- [x] Rate limiting active (100 msg/min per agent)
- [x] Replay protection working (nonce + timestamp)
- [x] Input validation on all fields
- [x] Structured JSON logging
- [x] Health check endpoint responding
- [x] All agents reconnecting cleanly after restart

---

## Week 2: SDK + MCP Server

### Goal
External developers can `npm install @axip/sdk` and connect an agent in <5 minutes.

### Day-by-Day

**Monday (Day 6) — TypeScript Types + Tests**
- [ ] SDK-1: Write index.d.ts with full type coverage
- [x] SDK-4: Integration test suite (connect, discover, task lifecycle)

**Tuesday (Day 7) — SDK Polish + Publish**
- [ ] SDK-2: Update package.json for npm publish
- [ ] SDK-3: Write quickstart README
- [ ] SDK-5: Publish @axip/sdk to npm
- [ ] SDK-6: Create public GitHub repo

**Wednesday (Day 8) — MCP Server Core**
- [ ] MCP-1: Create @axip/mcp-server package scaffold
- [ ] MCP-2: Implement axip_discover_agents tool
- [ ] MCP-3: Implement axip_request_task tool

**Thursday (Day 9) — MCP Server Features**
- [ ] MCP-4: axip_check_balance tool
- [ ] MCP-5: axip_agent_status tool
- [ ] MCP-6: network_capabilities resource
- [ ] MCP-7: Publish to npm

**Friday (Day 10) — Integration Guides**
- [ ] MCP-8: OpenClaw integration guide (3-line YAML)
- [ ] MCP-9: LangChain integration guide
- [ ] Test: OpenClaw → MCP → AXIP → Agent Beta (full flow)

### Exit Criteria
- [x] `npm install @axip/sdk` works
- [x] `npm install @axip/mcp-server` works
- [x] Public GitHub repo with spec, SDK, examples
- [x] An OpenClaw agent can discover and use AXIP agents via MCP
- [x] Integration tests pass in CI

---

## Week 3: Payments + Anchor Agents

### Goal
Real money can flow through AXIP. Five production-quality agents available.

### Day-by-Day

**Monday (Day 11) — Credit Ledger**
- [ ] PAY-1: Design credit ledger schema in PostgreSQL
- [ ] PAY-5: Add 5% platform fee to settlement logic

**Tuesday (Day 12) — Stripe Integration**
- [ ] PAY-2: Stripe Connect Express setup flow
- [ ] PAY-3: Credit deposit via Stripe Checkout

**Wednesday (Day 13) — Withdrawal + Limits**
- [ ] PAY-4: Credit withdrawal to Stripe Connect
- [ ] PAY-8: Spending limits per agent
- [ ] PAY-7: Deposit bonus tiers

**Thursday (Day 14) — Anchor Agents**
- [ ] AGT-1: Upgrade Agent Beta (web_search) for production
- [x] AGT-2: Build code_review agent (Ollama) — done, running as agent-code-review
- [ ] AGT-4: Upgrade summarize agent

**Friday (Day 15) — More Agents + Testing**
- [x] AGT-3: Build data_extraction agent — done, running as agent-data-extract
- [x] AGT-5: Build translate agent — done 2026-03-24, translator-alpha online
- [x] AGT-6: Register all with production pricing
- [ ] PAY-9: Refund flow for failed tasks
- [ ] PAY-6: Balance/transaction API endpoints

### Exit Criteria
- [x] Credits can be purchased via Stripe
- [x] Earnings can be withdrawn via Stripe Connect
- [x] 5% platform fee active on all settlements
- [x] 5 anchor agents live with real pricing
- [x] Full money flow tested: deposit → task → settlement → withdraw

---

## Week 4: Public Relay + Dashboard + Framework Integrations

### Goal
Deploy public relay to Hetzner VPS. Public dashboard. Framework integration guides.

### Day-by-Day

**Monday (Day 16) — Hetzner VPS Setup**
- [ ] VPS-1: Provision Hetzner CX22 VPS ($4.85/mo, 2 vCPU, 4GB RAM)
- [ ] VPS-2: Install Node.js 22, PM2, clone axios-axip repo
- [ ] VPS-3: Deploy relay + dashboard + portal to VPS
- [ ] VPS-4: Set up WSS via Let's Encrypt + nginx reverse proxy
- [ ] **MANUAL**: Add DNS in Vercel: `relay.axiosaiinnovations.com` CNAME → VPS IP
- [ ] **MANUAL**: Add DNS in Vercel: `portal.axiosaiinnovations.com` CNAME → VPS IP

**Tuesday (Day 17) — Python SDK + Framework Adapters**
- [ ] INT-5: Build axip-python package (pip install axip)
- [ ] INT-1: OpenClaw skill for AXIP
- [ ] INT-2: CrewAI tool wrapper
- [ ] INT-3: LangChain @tool example
- [ ] INT-4: OpenAI Agents SDK example

**Wednesday (Day 18) — Dashboard Core**
- [ ] DSH-1: Agent onboarding guide on Hive Portal
- [ ] DSH-2: Capability marketplace page (search/filter)
- [ ] DSH-6: OpenAPI docs for all endpoints

**Thursday (Day 19) — Dashboard Features**
- [ ] DSH-3: Reputation leaderboard
- [ ] DSH-4: Network stats timeline
- [ ] DSH-5: Task posting web UI (non-SDK users)
- [ ] DSH-7: Status page

**Friday (Day 20) — Integration Testing**
- [ ] INT-6: Submit OpenClaw skill to Skills Registry
- [ ] AGT-7: Load test with 100 concurrent tasks against VPS relay
- [ ] Verify: External agent connects to wss://relay.axiosaiinnovations.com
- [ ] Verify: Full task lifecycle over public relay

### Exit Criteria
- [ ] Public relay live at wss://relay.axiosaiinnovations.com
- [ ] WSS/TLS working with valid cert
- [ ] Python SDK on PyPI
- [ ] Integration guides for 4 frameworks
- [ ] Public dashboard with marketplace, leaderboard, stats
- [ ] Load test passed (100 concurrent tasks on VPS)

---

## Week 5: Launch

### Goal
AXIP is live, announced, and attracting the first 100 agents.

### Day-by-Day

**Monday (Day 21) — Content**
- [x] LCH-1: Write launch blog post
- [x] LCH-4: Record demo video (60s agent-to-agent task)

**Tuesday (Day 22) — Launch Prep**
- [x] LCH-2: Create Product Hunt listing
- [x] LCH-3: Prepare HN "Show HN" post
- [ ] LCH-5: Set up Discord community
- [x] LCH-7: Create examples repo (5+ agents)

**Wednesday (Day 23) — LAUNCH DAY**
- [ ] Post on Product Hunt (aim for top 5)
- [ ] Post on Hacker News
- [ ] Publish blog post
- [ ] Share on Twitter/X, LinkedIn, Reddit
- [x] LCH-6: Monitor relay, payments, alerts

**Thursday (Day 24) — Community Response**
- [ ] Respond to all HN/PH comments
- [ ] Fix any bugs from launch traffic
- [ ] Onboard first wave of external agents
- [ ] INT-7: Publish framework tutorials

**Friday (Day 25) — Retrospective + Plan**
- [ ] Review metrics: connected agents, tasks, settlements
- [ ] Identify top issues from community feedback
- [ ] Plan Week 6+ priorities
- [ ] Update product backlog based on user feedback

### Exit Criteria
- [x] Product Hunt and HN launches completed
- [x] Blog post, demo video, tutorials published
- [x] Discord community active
- [x] First external agents connected
- [x] No critical bugs in first 48 hours

---

## Post-Launch Priorities (Weeks 6-8)

| Priority | What | Why |
|----------|------|-----|
| 1 | Community support + bug fixes | Retention > acquisition |
| 2 | Python SDK polish based on feedback | Developer experience |
| 3 | Begin x402/USDC integration | Better micropayment economics |
| 4 | A2A Agent Card for relay | Broader discovery |
| 5 | Apply to cloud startup programs | AWS/GCP/Azure credits |
| 6 | Begin multi-relay federation design | Scale + resilience |

---

## Resource Requirements

### Human
- **Elias**: Primary developer (~28h/week for 5 weeks)
- **Eli (agent)**: Can handle anchor agent development, testing, content drafts
- **Claude Code (Max Plan)**: All complex development tasks

### Infrastructure
- **Mac Mini M4 Pro**: Dev machine + anchor agents + Ollama (already running)
- **Twingate**: Remote access (already configured)
- **Hetzner VPS**: Public relay hosting (Week 4, ~$5/mo)
- **Vercel**: Domain DNS (already hosting axiosaiinnovations.com)
- **Stripe**: Payment processing (2.9% + $0.30 per deposit)
- **npm**: Package publishing (free for public packages)
- **GitHub**: Public repo (free, account connected)

### Budget
| Item | Cost | Frequency |
|------|------|-----------|
| Hetzner VPS (CX22) | $4.85/mo | Monthly |
| Stripe fees (absorbed) | Variable | Per deposit |
| Domain (already owned, Vercel) | $0 | — |
| Mac Mini (already owned) | $0 | — |
| Claude Max Plan (already have) | $0 | — |
| Legal (ToS, developer agreement) | $2,000-5,000 | One-time |
| **Total estimated:** | **$2,000-5,060** | **Mostly one-time** |

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| No external agents connect | Medium | Critical | Seed with 5+ own agents; cold outreach to framework communities |
| Security vulnerability found | Medium | High | Security audit in Week 1; bug bounty after launch |
| Stripe Connect onboarding complexity | Medium | Medium | Start with Express (simplest); can upgrade later |
| VPS relay goes down | Low | Medium | PM2 auto-restart; Mac Mini as local fallback |
| Legal cease & desist | Low | High | ToS drafted before launch; credit system (not money transmission) |
| Framework breaking changes | Low | Medium | Pin SDK versions; integration tests catch regressions |
