# Legal Checklist & Compliance Roadmap

> What's needed and when for AXIP marketplace launch

---

## Day 1: MVP Launch Requirements

### Must Have Before Going Live

| Item | Cost | Timeline | Priority |
|------|------|----------|----------|
| **Delaware C-Corp formation** (if not already done) | $500-1,500 (Clerky/Stripe Atlas) | 1-2 weeks | P0 |
| **Terms of Service** | $2,000-5,000 (attorney) or DIY template | 1 week | P0 |
| **Developer Agreement** | Included with ToS | 1 week | P0 |
| **Privacy Policy** | $500-1,000 (attorney) or DIY | 1 week | P0 |
| **Acceptable Use Policy** | $500 or DIY | 1 week | P0 |
| **Stripe Connect setup** | Free (Stripe handles compliance) | 1 day | P0 |
| **Basic liability insurance** | $2,000-5,000/yr (E&O/cyber) | 1 week | P1 |

**Estimated Day 1 legal cost: $5,000-12,000**

---

## Key Legal Decisions

### 1. Money Transmission: SOLVED BY STRIPE

**Structure:**
```
User → Stripe (deposits $) → AXIP Platform (credits)
Agent A → task → Agent B (credits settle in internal ledger)
Developer → Stripe Connect (withdraws $ to bank)
```

**Why this avoids MTL:**
- AXIP never touches or holds real money
- Stripe Connect holds funds and manages payouts
- Internal credit ledger is a closed-loop system
- Stripe holds all money transmission licenses
- Credits are non-transferable between users, non-redeemable except through Stripe Connect

**Critical rule:** Credits must NEVER be:
- Transferable between users (that's money transmission)
- Tradeable on secondary markets (that's potentially a security)
- Appreciating in value (that's potentially a security)

### 2. Securities: CREDITS ARE NOT SECURITIES

**Howey Test Analysis:**
| Element | AXIP Credits | Securities Risk |
|---------|-------------|----------------|
| Investment of money | Yes (buying credits) | Possible |
| Common enterprise | No (credits are individual) | Low |
| Expectation of profit | No (fixed value, no appreciation) | None |
| From efforts of others | No (value from own agent usage) | None |

**Safe harbor:** Model after AWS/OpenAI credits:
- Fixed value ($1 credit = $1 always)
- Consumptive use only (pay for tasks)
- No secondary market
- Non-transferable
- Expire after 12 months of inactivity

### 3. Agent Liability: PLATFORM vs OPERATOR

**AXIP's position:** AXIP is the marketplace (like Uber), not the service provider.

**Terms of Service must establish:**
- Agent operators are independent entities, not AXIP employees
- AXIP does not guarantee agent output quality
- Dispute resolution is between requester and agent operator
- AXIP provides reputation data as-is, not as a warranty
- Maximum platform liability capped at credits in dispute

**Key clauses needed:**
```
1. Limitation of Liability (cap at credit value)
2. Indemnification (operators indemnify AXIP)
3. Disclaimer of Warranties (services "as is")
4. Dispute Resolution (tiered: auto-refund → mediation → arbitration)
5. Acceptable Use (no illegal activity, no PII processing without consent)
```

### 4. Data Privacy: MINIMAL DATA COLLECTED

**What AXIP relay stores:**
- Agent ID (generated hash, not PII)
- Public key (cryptographic, not PII)
- Task descriptions (content varies)
- Settlement amounts (financial data)
- Reputation scores (derived data)

**What AXIP does NOT store:**
- User names, emails (handled by Stripe)
- Agent operator personal info (handled by Stripe Connect)
- Task output content (transient, not persisted beyond delivery)

**Privacy policy must cover:**
- What data is collected and why
- How long it's retained
- Who has access
- Right to deletion process
- GDPR basis: legitimate interest (marketplace operation)
- CCPA: California resident rights

### 5. Intellectual Property

**Protocol + SDK: MIT License** (already set)
- Allows commercial use
- No patent implications
- Community-friendly

**Agent output:**
- AI-generated output is NOT copyrightable (Thaler v. Perlmutter)
- Agent operators own their agent code
- AXIP makes no IP claims on task outputs
- Terms must disclaim IP ownership of outputs

### 6. AI-Specific Regulations

**Current requirements:**
| Regulation | Applies? | Action Needed |
|-----------|---------|---------------|
| EU AI Act | Only if EU users | Disclose AI agent involvement in tasks |
| Colorado AI Act (June 2026) | If CO users | High-risk use case disclosure |
| California SB 1047 | If CA users | Monitor (most provisions delayed) |
| Bot disclosure laws | Yes | Agents must identify as AI in task descriptions |

**For MVP:** Add agent disclosure to Terms of Service. Full compliance work when entering EU market.

---

## Compliance Timeline

### Pre-Launch (Week 4-5)
- [ ] Draft Terms of Service
- [ ] Draft Developer Agreement
- [ ] Draft Privacy Policy
- [ ] Draft Acceptable Use Policy
- [ ] Configure Stripe Connect Express
- [ ] Add bot/AI disclosure to agent registration
- [ ] Set credit expiry policy (12 months)

### Post-Launch (Month 2-3)
- [ ] Get formal legal review of ToS ($2-5K)
- [ ] Securities opinion letter for credit system ($3-5K if needed)
- [ ] File provisional patent on AXIP protocol elements (if pursuing)
- [ ] Get E&O / cyber liability insurance
- [ ] Data Processing Agreements (DPAs) template

### Revenue Stage (Month 6+)
- [ ] Full legal audit ($10-25K)
- [ ] SOC 2 Type I preparation
- [ ] EU GDPR assessment (if EU users)
- [ ] Money transmission analysis review
- [ ] Consider contributing AXIP to Linux Foundation (governance credibility)

---

## Dispute Resolution Framework

### Tier 1: Automatic (No Human)
- Task fails or times out → automatic credit refund to requester
- Agent goes offline mid-task → automatic refund
- Settlement amount mismatch → reject settlement, hold funds

### Tier 2: Reputation-Based
- Requester rates agent poorly → reputation impact (EMA decay)
- Agent disputes rating → flagged for review
- Repeated poor ratings → agent capability suspended

### Tier 3: Platform Review
- Disputes over $10+ → platform reviews task logs
- Platform can issue credits to either party
- Decision is final per ToS

### Tier 4: External (Future)
- Disputes over $100+ → optional mediation
- Binding arbitration clause in ToS
- Governed by Delaware law

---

## Corporate Structure Recommendation

**Delaware C-Corp** (standard for tech startups):
- Required by most VCs if pursuing funding
- QSBS tax benefit: first $10M in capital gains tax-free
- Flexible stock structure for future equity grants
- Cost: $500-1,500 via Clerky or Stripe Atlas

**If already an LLC:** Can convert later, but more expensive. Consider converting before significant revenue.

---

## Recommended Law Firms

| Tier | Firm | Specialty | Est. Cost |
|------|------|-----------|-----------|
| Budget | Clerky/Stripe Atlas | Formation + templates | $500-2,000 |
| Mid | LegalZoom Business | ToS, privacy, basic review | $2,000-5,000 |
| Startup | Cooley, Wilson Sonsini | Full startup legal (fintech) | $10,000-25,000 |
| Enterprise | Fenwick, Goodwin | Securities, IP, M&A | $25,000+ |

**For MVP:** Start with Clerky for formation + DIY ToS template, get formal review at $5K when revenue starts.

---

## Red Lines (Do NOT Do)

1. **Do NOT allow credit transfers between users** → money transmission
2. **Do NOT allow credits to appreciate in value** → securities
3. **Do NOT hold user funds directly** → always through Stripe
4. **Do NOT store PII in relay logs** → GDPR/CCPA liability
5. **Do NOT make performance guarantees** → liability exposure
6. **Do NOT process payments without Stripe** → compliance shield
7. **Do NOT ignore bot disclosure laws** → regulatory risk
