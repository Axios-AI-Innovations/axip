# AXIP Credit System Implementation Log

> Date: 2026-03-22
> Week: 3 of AXIP implementation plan
> Status: COMPLETE ✓

---

## Summary

Implemented the PostgreSQL-backed credit ledger and payment infrastructure for AXIP. All settlements are now atomic with a 5% platform fee, tracked in the `axip_marketplace` schema in the shared `hive_brain` PostgreSQL database.

---

## What Was Built

### PAY-1: PostgreSQL Credit Ledger (Schema + Module)

**Schema** — `axip_marketplace` schema in `hive_brain`:
- `accounts` — agent credit balances with totals (deposited, earned, spent) and optional spending limits
- `transactions` — immutable audit trail of all settlements with platform fee tracking
- `deposits` — Stripe deposit/withdrawal tracking (skeleton for Stripe Connect integration)

**Module** — `packages/relay/src/pg-ledger.js`:
- `initPgLedger()` — connects pool, ensures platform account exists
- `initAccount(agentId, initialBalance?)` — create account with $1.00 free credits
- `getBalance(agentId)` — returns balance + totals
- `settle(taskId, from, to, amount)` — atomic settlement with 5% platform fee
- `checkSpendingLimit(agentId)` — checks 24h spend vs. limit
- `setSpendingLimit(agentId, limitUsd)` — configure per-agent spending limits
- `getTransactionHistory(agentId, limit)` — paginated history
- `getPlatformEarnings()` — admin view of platform revenue

### PAY-5: Relay Settlement Integration

- `packages/relay/src/ledger.js` updated to use PostgreSQL as primary, SQLite as fallback
- `settle()` and `getBalance()` are now async (Promise-returning)
- `taskManager.handleTaskVerify()` made async to support await on settle
- `taskManager.handleTaskAccept()` made async to check spending limits before work starts
- `server.js` updated to use `.then()` for the two async task handlers

### PAY-6: Balance API Endpoints (port 4201)

Three new endpoints added to the dashboard server:
- `GET /api/credits/balance/:agentId` — balance + totals
- `GET /api/credits/transactions/:agentId?limit=50` — recent transactions (max 200)
- `GET /api/credits/platform` — platform earnings (admin)

All return 503 if PostgreSQL is unavailable.

### PAY-8: Spending Limits

- Spending limit check in `settle()`: if `spent_24h + gross_amount > limit` → reject with `SPENDING_LIMIT_EXCEEDED`
- Pre-flight check in `handleTaskAccept()`: if agent is already at/over their limit, reject before work starts and return error to requester WebSocket
- `setSpendingLimit(agentId, null)` removes the limit

---

## Settlement Fee Math

| Component | Calculation | Example ($0.05 task) |
|-----------|-------------|---------------------|
| Gross amount | Full task price | $0.05000 |
| Platform fee | 5% of gross | $0.00250 |
| Net to provider | Gross − fee | $0.04750 |
| Requester debited | Gross | −$0.05000 |

---

## Test Results

```
✓ Schema created: axip_marketplace.{accounts, transactions, deposits}
✓ Settlement: $0.05 task → requester −$0.05, provider +$0.0475, platform +$0.0025
✓ 5% fee correctly calculated and credited to axip-platform account
✓ Insufficient balance: rejected with 'insufficient_balance'
✓ Spending limit: $0.05+$0.05 blocked against $0.06 daily limit (SPENDING_LIMIT_EXCEEDED)
✓ Transaction history: 1 record with correct gross/fee/net amounts
✓ Platform earnings API: returns balance_usd=0.0025, total_earned=0.0025
```

---

## What's Next

### Stripe Connect (requires manual setup)
The `deposits` table is ready. Integration needs:
1. Create Stripe account → get secret key
2. `stripe.paymentIntents.create()` → record in deposits table
3. Webhook on `payment_intent.succeeded` → call `initAccount` / credit balance
4. Stripe Connect for provider payouts (not in initial scope)

### Future Enhancements
- `POST /api/credits/limit/:agentId` — API to set spending limits (currently code-only)
- Deposit flow webhook handler
- On-chain settlement option (Solana/Base) from business model doc

---

## Files Changed

| File | Change |
|------|--------|
| `packages/relay/src/pg-ledger.js` | **NEW** — PostgreSQL credit ledger module |
| `packages/relay/src/ledger.js` | Updated to use PG primary + SQLite fallback |
| `packages/relay/src/taskManager.js` | Made handleTaskVerify and handleTaskAccept async |
| `packages/relay/src/server.js` | Updated task_accept/task_verify to handle Promises |
| `packages/relay/src/dashboard/server.js` | Added 3 credit API endpoints |
