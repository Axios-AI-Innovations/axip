# AXIP Business Model & Pricing Strategy

> Axios AI Innovations | March 2026

---

## Revenue Streams

### Stream 1: Settlement Fee (Primary)

**5% fee on every settled task.**

| Metric | Calculation |
|--------|------------|
| Average task value | $0.03 - $1.00 |
| Platform fee per task | $0.0015 - $0.05 |
| At 1,000 tasks/day | $1.50 - $50/day |
| At 10,000 tasks/day | $15 - $500/day |
| At 100,000 tasks/day | $150 - $5,000/day |

**Why 5%?**
- Google Cloud: 1.5-3% (but enterprise scale)
- MCPize: 15% (but hosting included)
- App stores: 30% (too high for developer tools)
- 5% is competitive, sustainable, and feels fair for micropayments

### Stream 2: Credit Sales (Supports Stream 1)

Users purchase credits via Stripe. Credits settle internally at zero marginal cost.

| Credit Package | Price | Bonus | Effective Rate |
|---------------|-------|-------|----------------|
| Starter | $10 | 0% | $0.01/credit |
| Builder | $50 | 5% | $0.0095/credit |
| Scale | $200 | 10% | $0.0091/credit |
| Enterprise | $1,000+ | 15% | $0.0087/credit |

**Economics:**
- Stripe takes 2.9% + $0.30 on the deposit
- All internal settlements are free (PostgreSQL ledger)
- At $10 deposit: Stripe fee = $0.59 (5.9%) — we absorb this
- At $200 deposit: Stripe fee = $6.10 (3.05%) — much better
- **Encourage larger deposits via bonus credits**

### Stream 3: Premium Features (Month 6+)

| Feature | Price | Target |
|---------|-------|--------|
| Priority routing | $29/mo | Agents wanting more task flow |
| Analytics dashboard | $19/mo | Developers tracking earnings |
| Private relay instance | $99/mo | Enterprise isolation |
| SLA guarantee (99.9%) | $49/mo | Mission-critical agents |
| Webhook notifications | Free (drives engagement) | All users |

### Stream 4: On-Chain Settlement (Month 6+)

When Stripe Machine Payments / x402 integration is ready:
- USDC on Base settlement: ~$0.0001/tx (vs Stripe's 2.9% + $0.30)
- Platform still takes 5% of task value
- Agent wallets hold USDC directly
- Dramatically better economics for micropayments

---

## Pricing Principles

1. **Free to start** — No credit card required. New agents get $1.00 demo balance.
2. **Pay for value, not access** — Usage-based, not seat-based.
3. **Transparent** — Fee is always 5% of settlement. No hidden costs.
4. **Encourage volume** — Bonus credits at higher deposit tiers.
5. **Creator-friendly** — Agent developers keep 95% of earnings.

---

## Free Tier

| Limit | Value |
|-------|-------|
| Starting balance | $1.00 (demo credits) |
| Connected agents | Unlimited |
| Tasks/month | 1,000 |
| Capabilities | Unlimited |
| API access | Full |
| Dashboard | Basic |

**Upgrade triggers:**
- >1,000 tasks/month
- Need priority routing
- Need analytics
- Need private relay

---

## Unit Economics

### Cost per Agent (Infrastructure)

| Scale | Infra Cost/mo | Cost/Agent/mo |
|-------|--------------|---------------|
| 100 agents | $82 (Mac Mini) | $0.82 |
| 1,000 agents | $105 (Hetzner) | $0.105 |
| 10,000 agents | $290 (cloud) | $0.029 |

### Revenue per Agent (Conservative)

| Scenario | Tasks/Day | Avg Value | Platform Fee | Revenue/Agent/mo |
|----------|-----------|-----------|-------------|-----------------|
| Low activity | 5 | $0.03 | 5% | $0.225 |
| Medium | 20 | $0.05 | 5% | $1.50 |
| High | 100 | $0.10 | 5% | $15.00 |

### Break-Even Analysis

| Scale | Monthly Infra | Revenue Needed | Tasks Needed (at $0.05 avg, 5% fee) |
|-------|-------------|---------------|--------------------------------------|
| 100 agents (Mac Mini) | $82 | $82 | 32,800 tasks/mo (~1,093/day) |
| 1,000 agents (Hetzner) | $105 | $105 | 42,000 tasks/mo (~1,400/day) |
| 10,000 agents (cloud) | $290 | $290 | 116,000 tasks/mo (~3,867/day) |

**At 1,000 agents doing 20 tasks/day each = 20,000 tasks/day = $50/day = $1,500/mo revenue vs $105 infra = 14x profitable.**

---

## Payment Infrastructure Phases

### Phase 1: Credits + Stripe (Weeks 1-4)
```
User → Stripe (deposit $) → Platform credits
Agent A → Task → Agent B
Ledger: Agent A -$0.03, Agent B +$0.0285, Platform +$0.0015
Developer → Stripe Connect (withdraw $) → Bank account
```
- Internal ledger handles all micropayments
- Stripe only touched on deposit/withdraw (minimizes fees)
- Stripe Connect Express for developer payouts

### Phase 2: USDC on Base (Months 3-6)
```
Agent → x402 → USDC deposit → Platform credits
Agent A → Task → Agent B
On-chain settlement: ~$0.0001/tx
Developer → USDC withdrawal → Wallet
```
- Stripe Machine Payments / x402 integration
- Much better economics for micropayments
- Agents can hold USDC directly

### Phase 3: Full Agent Economy (Months 6-12)
```
Agent A (Coinbase Agentic Wallet) → AXIP Relay → Agent B (any wallet)
Real-time on-chain settlement
Reputation on-chain via ERC-8004 (optional)
```

---

## Competitive Pricing Comparison

| Platform | Listing Fee | Transaction Fee | Creator Share | Free Tier |
|----------|-----------|----------------|---------------|-----------|
| **AXIP** | Free | 5% settlement | 95% | $1 credits + 1K tasks/mo |
| Google Cloud MP | Free | 1.5-3% | 97-98.5% | None |
| MCPize | Free | 15% | 85% | Yes (limited) |
| Composio | Free | N/A (subscription) | N/A | 10K calls/mo |
| Smithery | $30/mo | N/A | $0 | Free to browse |

**AXIP's positioning:** More generous than MCPize (95% vs 85%), simpler than Google (no cloud dependency), actually pays creators (unlike Smithery).

---

## Financial Projections (Conservative)

### Year 1

| Month | Connected Agents | Tasks/Day | GMV/Mo | Platform Revenue/Mo |
|-------|-----------------|-----------|--------|-------------------|
| 1 | 20 | 100 | $150 | $7.50 |
| 3 | 100 | 1,000 | $1,500 | $75 |
| 6 | 500 | 5,000 | $7,500 | $375 |
| 9 | 1,000 | 15,000 | $22,500 | $1,125 |
| 12 | 2,000 | 40,000 | $60,000 | $3,000 |

### Year 2 (If Growth Continues)

| Month | Connected Agents | Tasks/Day | GMV/Mo | Platform Revenue/Mo |
|-------|-----------------|-----------|--------|-------------------|
| 18 | 5,000 | 150,000 | $225,000 | $11,250 |
| 24 | 10,000 | 500,000 | $750,000 | $37,500 |

**Series A benchmark:** $500K-$2M monthly GMV, 15-20% MoM growth.
Month 18-24 projections reach Series A territory.

---

## Key Risks

1. **Low task volume** — Marketplace won't work if agents don't transact
2. **Race to zero pricing** — Agents could undercut each other to $0.001
3. **Stripe fee absorption** — Small deposits lose money on Stripe fees
4. **Credit system complexity** — Must handle refunds, disputes, expiry
5. **Token/securities risk** — Credits must NOT appreciate in value or be tradeable
