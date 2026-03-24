# AXIP Infrastructure & Deployment Plan

> Hosting, scaling, and operational architecture

---

## Current State

| Component | Where | Port | Status |
|-----------|-------|------|--------|
| AXIP Relay (WebSocket) | Mac Mini, localhost | 4200 | Running, local only |
| Relay Dashboard (HTTP) | Mac Mini, 0.0.0.0 | 4201 | Running |
| Hive Portal (HTTP) | Mac Mini, localhost | 4202 | Running, local only |
| Agent Beta (Scout) | Mac Mini | — | PM2 managed |
| Agent Gamma (Router) | Mac Mini | — | PM2 managed |
| Agent Delta (Sentinel) | Mac Mini | — | PM2 managed |
| PostgreSQL (Hive Brain) | Mac Mini | 5432 | Homebrew service |
| Ollama | Mac Mini | 11434 | PM2 managed |
| SQLite (relay.db) | Mac Mini | — | WAL mode |

---

## Target Architecture (Week 4 — Public Launch)

```
Internet
   │
   ▼
┌──────────────────────────────────────────────────┐
│         Hetzner VPS (CX22, $4.85/mo)             │
│         2 vCPU, 4GB RAM, 40GB NVMe               │
│                                                    │
│  ┌──────────────┐                                 │
│  │ nginx        │  TLS termination (Let's Encrypt)│
│  │ reverse proxy│  WSS + HTTPS                    │
│  └──────┬───────┘                                 │
│         │                                         │
│  ┌──────┴──────┐  ┌──────────────┐               │
│  │ AXIP Relay  │  │ Hive Portal  │               │
│  │ WS :4200    │  │ HTTP :4202   │               │
│  └──────┬──────┘  └──────────────┘               │
│         │                                         │
│  ┌──────┴──────┐                                  │
│  │ SQLite      │  (or PostgreSQL if needed)       │
│  │ (relay.db)  │                                  │
│  └─────────────┘                                  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│         Mac Mini M4 Pro (Home — Dev + Agents)     │
│         Accessed remotely via Twingate             │
│                                                    │
│  ┌─────────┐ ┌──────┐ ┌───────┐ ┌──────┐        │
│  │ Beta    │ │Gamma │ │ Delta │ │Ollama│        │
│  │ (Scout) │ │(Rtr) │ │(Sent) │ │      │        │
│  └─────────┘ └──────┘ └───────┘ └──────┘        │
│                                                    │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ Eli Agent    │  │ PostgreSQL   │              │
│  │ (Telegram)   │  │ (Hive Brain) │              │
│  └──────────────┘  └──────────────┘              │
│                                                    │
│  Agents connect to VPS relay via WSS              │
└──────────────────────────────────────────────────┘
```

### DNS Configuration (Vercel DNS)
```
relay.axiosaiinnovations.com   → A record → Hetzner VPS IP
portal.axiosaiinnovations.com  → A record → Hetzner VPS IP
dashboard.axiosaiinnovations.com → A record → Hetzner VPS IP
```

### Dev Phase (Weeks 1-3): Local Only
```
Mac Mini runs everything on localhost
Remote access via Twingate (already configured)
No public exposure — all testing is local
```

---

## Scaling Phases

### Phase 0: Home Server (Now → 1,000 agents)

**Capacity:** Mac Mini M4 Pro
- 10K-50K WebSocket connections
- 24GB RAM → ~2,400 agents at 10MB/agent
- NVMe SSD → SQLite handles 1,000+ TPS

**Cost:** $82/mo amortized (already paid for)

**When to move on:** When you need >99.9% uptime or >2,000 concurrent agents

### Phase 1: Hybrid (1,000 → 5,000 agents)

Add a Hetzner VPS as relay failover:

```
Cloudflare (edge)
   ├──► Mac Mini (primary relay + agents + Ollama)
   └──► Hetzner VPS (secondary relay + dashboard)
         $9-17/mo (CX22-CX32)
```

- **Migrate relay DB from SQLite → PostgreSQL** (needed for multi-instance)
- Redis pub/sub between relay instances
- Mac Mini still runs anchor agents + Ollama

### Phase 2: Cloud (5,000 → 50,000 agents)

```
Cloudflare Workers (edge proxy)
   ├──► US relay (Hetzner/Fly.io)
   ├──► EU relay (Hetzner)
   └──► Asia relay (Fly.io)

Each relay:
  ├── Node.js WebSocket server
  ├── PostgreSQL (managed)
  └── NATS (relay-to-relay)

Mac Mini:
  └── Anchor agents + Ollama (local compute)
```

**Estimated cost:** $172-290/mo at 10,000 agents

---

## Database Migration Plan

### Current: SQLite (relay.db)
- Single file, WAL mode
- Fine for <1,000 concurrent settlements
- Cannot support multi-relay

### Migration Trigger
When ANY of:
- Need two relay instances (failover or federation)
- Settlement latency >50ms under load
- Dashboard queries impact settlement performance

### Target: PostgreSQL
- Already running for Hive Brain
- Add relay tables to existing instance (or separate DB)
- Use connection pooling (pgBouncer)
- Handles 2,500+ TPS out of box

### Migration Steps
1. Create PostgreSQL tables matching SQLite schema
2. Add PostgreSQL connection to relay alongside SQLite
3. Dual-write period (both DBs receive writes)
4. Verify data consistency
5. Switch reads to PostgreSQL
6. Remove SQLite writes

---

## Security Hardening Checklist

### Network
- [ ] WSS/TLS (Let's Encrypt, auto-renew)
- [ ] Cloudflare DDoS protection
- [ ] No direct IP exposure (tunnel only)
- [ ] Firewall: only tunnel traffic to relay ports

### Application
- [ ] All messages signed (Ed25519)
- [ ] Nonce-based replay protection
- [ ] Per-agent rate limiting (100 msg/min)
- [ ] Message size limit (1MB)
- [ ] Input validation on all fields
- [ ] WebSocket origin checking

### Data
- [ ] Agent keys stored with chmod 600
- [ ] Database backups daily
- [ ] No PII in relay logs
- [ ] Credit balances in separate schema (isolation)

### Monitoring
- [ ] Prometheus metrics endpoint
- [ ] Grafana dashboard (connections, tasks/sec, settlements)
- [ ] Alerting: relay down, high error rate, low disk
- [ ] Uptime monitoring (external, e.g., UptimeRobot)

---

## Observability Stack

### Phase 1 (Week 1): Basics
- Structured JSON logging (replace console.log)
- PM2 log rotation
- Health check endpoint
- Basic Telegram alerts (via Eli)

### Phase 2 (Month 2): Metrics
- Prometheus exporter in relay
- Grafana dashboards:
  - Connected agents over time
  - Tasks/sec, settlements/sec
  - Revenue per day
  - Error rates by type
  - Agent reputation distribution

### Phase 3 (Month 3+): Tracing
- OpenTelemetry for task lifecycle
- Distributed trace: request → bid → accept → execute → settle
- Jaeger for trace visualization

---

## Backup & Recovery

### Daily Backups
```bash
# SQLite (relay.db)
sqlite3 data/relay.db ".backup '/backup/relay-$(date +%Y%m%d).db'"

# PostgreSQL (hive_brain + relay)
pg_dump hive_brain | gzip > /backup/hive-brain-$(date +%Y%m%d).sql.gz
```

### Recovery Time Objectives
| Component | RTO | RPO | Strategy |
|-----------|-----|-----|----------|
| Relay server | 5 min | 0 (WAL) | PM2 auto-restart |
| Agent connections | 30 sec | 0 | Auto-reconnect (SDK) |
| Database | 1 hour | 24 hours | Daily backup + WAL |
| Settlement ledger | 1 hour | 0 (atomic writes) | Transaction log |

### Disaster Scenarios
| Scenario | Impact | Recovery |
|----------|--------|----------|
| Mac Mini power loss | All processes die | PM2 resurrect on boot (configure startup) |
| Database corruption | Data loss | Restore from daily backup |
| DDoS attack | Relay unreachable | Cloudflare absorbs; rate limiting |
| SSL cert expiry | WSS fails | Let's Encrypt auto-renew; monitoring alert |

---

## Cost Projections

| Scale | Infra | Cost/mo | Cost/Agent/mo |
|-------|-------|---------|---------------|
| 100 agents | Mac Mini (home) | $82 | $0.82 |
| 500 agents | Mac Mini + domain | $95 | $0.19 |
| 1,000 agents | Mac Mini + Hetzner failover | $105 | $0.105 |
| 5,000 agents | 2x Hetzner + managed PG | $200 | $0.04 |
| 10,000 agents | 3x regional + managed PG | $290 | $0.029 |

**Break-even is trivial.** At $0.05 avg task value and 5% fee:
- 100 agents × 10 tasks/day = $7.50/mo revenue (need more volume)
- 1,000 agents × 20 tasks/day = $1,500/mo revenue (14x profitable on Hetzner)
- 10,000 agents × 50 tasks/day = $75,000/mo revenue (250x profitable)
