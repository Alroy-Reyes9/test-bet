# Phase 0 — Wallet & Ledger Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Project:** test-bet — a web-first, fake-money betting simulator combining sports betting, casino table games, and slots on a single shared wallet.

---

## Context & Goals

test-bet is a **real product for real users** built on a **closed play-money economy**: chips are granted for free (signup bonus, daily bonus, auto-top-up), can never be purchased or cashed out, and have no real-world value. This keeps the product clear of gambling regulation while preserving the full engineering surface.

The product has three game surfaces (sports betting, casino RNG games, slots) that all share **one wallet**. Phase 0 builds that wallet — the financial spine everything else plugs into. Nothing is bet on yet; the deliverable is a provably-correct ledger.

**Success criteria for Phase 0:**
- A double-entry ledger where chips are never created or destroyed outside the FAUCET.
- No user balance can ever go negative, under any sequence of concurrent operations.
- Every operation is idempotent and crash-safe (moves chips exactly once).
- All invariants proven by an automated test suite before any game is built on top.

## Non-Goals (Phase 0)

- Any actual game (sports markets, dice, slots) — later phases.
- Buying chips / cash-out / monetization — explicitly out of scope (closed economy).
- Real-time transport (sockets) — added when the first game needs it.

---

## Stack

- **Next.js + TypeScript** — full-stack, web-first.
- **PostgreSQL** — real transactions + row locking; the correctness foundation. Managed via Neon or Supabase.
- **Prisma** — type-safe ORM and schema management.
- **Supabase Auth** (or Auth.js) — email/password, magic-link, social login. Never roll our own auth.
- **Hosting** — Vercel + managed Postgres.
- **Testing** — Vitest against a real Postgres (Testcontainers or a throwaway test DB).

---

## Section 1 — Ledger Data Model

Core principle: **money is never mutated, only recorded.** We never write `balance = balance - 100`. We append immutable entries and derive balance from them.

### Tables

**`Account`** — a bucket that holds chips.
- Each user has two: `AVAILABLE` (spendable) and `ESCROW` (locked in active bets).
- System accounts (not tied to a user): `FAUCET` (infinite source of free chips) and `HOUSE` (sink/source for RNG game wins and losses).
- Columns: `id`, `user_id` (nullable for system accounts), `type` (`AVAILABLE` | `ESCROW` | `FAUCET` | `HOUSE`), `balance` (BIGINT, cached), `created_at`.
- Constraint: user account `balance >= 0` (check constraint).

**`Transaction`** — one atomic financial event ("Alice placed a 100-chip bet"). Groups 2+ postings.
- Columns: `id`, `type` (`SIGNUP` | `DAILY_BONUS` | `TOP_UP` | `ESCROW` | `SETTLE` | `REFUND`), `idempotency_key` (unique, not null), `metadata` (JSONB), `created_at`.
- **Unique constraint on `idempotency_key`** — the database itself refuses duplicates.

**`Posting`** — a single debit or credit.
- Columns: `id`, `transaction_id`, `account_id`, `amount` (BIGINT, signed), `created_at`.
- **Invariant: all postings within one transaction sum to zero.** Chips are only moved, never minted or burned.

### Hard rules

1. **Chips are integers, never floats.** BIGINT, whole chips. No floating-point money.
2. **User balances are always ≥ 0**, enforced by check constraint + the escrow-before-spend flow.
3. **The ledger (sum of postings) is the source of truth.** `Account.balance` is a cache, updated inside the same DB transaction as its postings, and reconciled periodically.

### Example chip flows

```
Signup:      FAUCET −5000,         Alice.AVAILABLE +5000
Place bet:   Alice.AVAILABLE −100, Alice.ESCROW +100
Win (2×):    Alice.ESCROW −100,    Alice.AVAILABLE +100   (stake back)
             HOUSE −100,           Alice.AVAILABLE +100   (winnings)
Lose:        Alice.ESCROW −100,    HOUSE +100
Refund/void: Alice.ESCROW −100,    Alice.AVAILABLE +100
```

Each block sums to zero.

---

## Section 2 — Wallet Operations, Idempotency & Concurrency

The wallet exposes a small set of **primitive operations**. All games (later phases) are built from these and never touch the tables directly.

### Operations

| Operation | Purpose | Postings |
|---|---|---|
| `grantSignupBonus(user)` | Starting chips for new accounts (one per account) | FAUCET → AVAILABLE |
| `claimDailyBonus(user)` | Once-per-24h free chips | FAUCET → AVAILABLE |
| `autoTopUp(user)` | Refill to a floor when AVAILABLE hits 0 | FAUCET → AVAILABLE |
| `escrow(user, amount, key)` | Lock a stake for a bet | AVAILABLE → ESCROW |
| `settle(user, stake, payout, key)` | Resolve a bet win/loss | ESCROW → AVAILABLE/HOUSE (+ HOUSE → AVAILABLE on win) |
| `refund(user, amount, key)` | Void a bet, return the stake | ESCROW → AVAILABLE |

Games call `escrow`, then later `settle` or `refund`. That is the entire interface.

### Idempotency

Every operation takes a caller-generated **idempotency key** (e.g. `bet:{betId}:place`). Before creating a transaction, the operation checks whether a transaction with that key already exists; if so it returns the existing one and does nothing. Enforced by the **unique constraint on `Transaction.idempotency_key`**. Result: retries after timeouts and restarts after crashes move chips **exactly once**. This is the most important safety property in the product.

### Concurrency

The double-spend hazard: a user with 100 chips fires two 100-chip bets simultaneously; both read "balance = 100," both succeed, balance goes to −100.

Prevention: every operation runs inside **one PostgreSQL transaction** that:
1. Locks the affected account row(s) with `SELECT … FOR UPDATE`.
2. Checks balance sufficiency.
3. Inserts the `Transaction` (with idempotency key) and its `Posting`s.
4. Updates cached `balance`(s).

All four commit together or roll back together. The second concurrent bet blocks on the row lock until the first commits, then sees the updated balance and is correctly rejected. A crash between steps leaves the ledger fully consistent — there is no partial state.

---

## Section 3 — Auth, API Surface & Error Handling

### Auth

Supabase Auth (or Auth.js): email/password, magic-link, and Google/Apple social login. On **first successful signup**, a hook fires `grantSignupBonus`. Sessions are library-managed JWT cookies. The authenticated user ID always comes from the **verified session, never the request body** — otherwise anyone could top up anyone's wallet.

### API surface

A thin HTTP layer over the wallet service:

| Endpoint | Purpose |
|---|---|
| `GET /api/wallet` | Current AVAILABLE + ESCROW balances |
| `GET /api/wallet/history` | Paginated ledger of the user's transactions |
| `POST /api/wallet/daily-bonus` | Claim the daily bonus |
| `POST /api/wallet/top-up` | Trigger auto-top-up when broke |

There is deliberately **no generic "add chips" endpoint** — chips enter only through controlled, rate-limited paths. `escrow`/`settle`/`refund` are **not** public endpoints; later-phase game servers call them internally.

### Error handling

Guiding principle: **a failed operation always leaves the wallet exactly as it was.** Because every operation is one atomic DB transaction, we can honestly tell the user "if it errored, you weren't charged."

| Situation | Response | User sees |
|---|---|---|
| Insufficient balance | `422`, no chips move | "Not enough chips — claim your daily bonus or top up" |
| Duplicate request (idempotency hit) | `200`, returns original transaction | Success (chips moved exactly once) |
| Daily bonus already claimed | `429` + reset time | "Come back in 6h 20m" |
| Lock contention | Request waits, then resolves cleanly | Nothing — it just works |
| DB error mid-transaction | Full rollback, `500` | "Something went wrong, nothing was charged" |

### Rate limiting & anti-abuse

- Daily bonus and top-up rate-limited per user; signup grant is one-per-account.
- A reconciliation job flags any account whose cached `balance` drifts from its ledger sum (canary for bugs or tampering).

---

## Section 4 — Testing Strategy

Tests are the deliverable for a money system. Built test-first (TDD).

1. **Invariant tests** (highest value):
   - **Conservation:** all postings across the ledger sum to zero.
   - **No negative user balances:** after any operation sequence.
   - **Cached balance = ledger sum:** for every account (the reconciliation check as a test).
2. **Idempotency tests:** same key fired repeatedly / concurrently → chips move exactly once, same transaction returned.
3. **Concurrency tests:** N parallel bets against a wallet that can afford one → exactly one succeeds, balance never negative.
4. **Operation unit tests:** each primitive's happy path + every rejection.
5. **Property-based / fuzz test:** thousands of random valid operation sequences, then assert all Section-1 invariants still hold.

**Infrastructure:** real Postgres (locking behavior is under test — no mocks), via Testcontainers or a throwaway test DB. Vitest runner.

**Definition of done for Phase 0:** all invariant tests green, concurrency test proving no double-spend, idempotency proven. Only then does Phase 1 (first RNG game) begin.

---

## Roadmap (context only — not part of Phase 0)

- **Phase 0 — Wallet & ledger** ← this spec
- **Phase 1 — First RNG game** (Dice or Crash) to validate the wallet end-to-end
- **Phase 2 — Sports betting** (market state machine + pluggable manual→API resolver)
- **Phase 3 — Slots** (RNG with reel/payline/RTP math)

Each phase gets its own spec → plan → build cycle.
