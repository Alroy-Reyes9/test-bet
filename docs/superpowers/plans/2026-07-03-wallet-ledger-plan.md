# Wallet & Ledger (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provably-correct, double-entry play-money wallet — the shared financial spine for test-bet's sports/casino/slots surfaces.

**Architecture:** Immutable double-entry ledger in PostgreSQL. Every chip movement is a `Transaction` grouping `Posting`s that sum to zero. A single low-level primitive (`postTransaction`) performs all writes inside one DB transaction with `SELECT … FOR UPDATE` row locks and an idempotency-key unique constraint. Six wallet operations are built on that primitive. A thin Next.js API exposes read + free-chip endpoints only.

**Tech Stack:** Next.js (App Router) + TypeScript, PostgreSQL, Prisma, Vitest against a real Postgres.

## Global Constraints

- **Chips are `BigInt` integers, never floats.** All amounts are `bigint` in TS and `BIGINT` in Postgres.
- **Money is never mutated directly** — only recorded as postings. `Account.balance` is a cache updated inside the same DB transaction as its postings.
- **All postings within one transaction sum to `0n`.** No transaction has fewer than 2 postings.
- **User accounts (`AVAILABLE`, `ESCROW`) may never go negative.** System accounts (`FAUCET`, `HOUSE`) may.
- **Every write operation is idempotent**, keyed by `Transaction.idempotency_key` (unique constraint).
- **Config values (verbatim):** `STARTING_CHIPS = 5000n`, `DAILY_BONUS = 1000n`, `TOP_UP_TARGET = 1000n`, `DAILY_COOLDOWN_MS = 86_400_000`, `TOP_UP_WINDOW_MS = 10_000`.
- **Tests run against a real Postgres** (no mocking the DB — locking is under test).

---

## File Structure

- `prisma/schema.prisma` — Account, Transaction, Posting models + enums.
- `prisma/migrations/…` — generated; plus a hand-added SQL migration for the non-negative check + system-account singleton index.
- `src/lib/db.ts` — Prisma client singleton.
- `src/lib/wallet/config.ts` — economy constants.
- `src/lib/wallet/errors.ts` — typed wallet errors.
- `src/lib/wallet/accounts.ts` — resolve/create user + system accounts.
- `src/lib/wallet/ledger.ts` — `postTransaction` primitive (the only writer).
- `src/lib/wallet/operations.ts` — the six wallet operations.
- `src/lib/wallet/reconcile.ts` — cached-balance-vs-ledger drift check.
- `src/lib/auth.ts` — `requireUserId(req)` from Supabase session.
- `src/app/api/wallet/route.ts` — GET balances.
- `src/app/api/wallet/history/route.ts` — GET paginated ledger.
- `src/app/api/wallet/daily-bonus/route.ts` — POST claim daily bonus.
- `src/app/api/wallet/top-up/route.ts` — POST auto-top-up.
- `tests/setup/testDb.ts` — reset + seed helpers for tests.
- `tests/wallet/*.test.ts` — the proof suite.

---

## Task 1: Project scaffold + real-Postgres test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `docker-compose.yml`, `.env.test`, `src/lib/db.ts`
- Create: `tests/setup/testDb.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `prisma` (default Prisma client from `src/lib/db.ts`); `resetDb()` and `seedSystemAccounts()` from `tests/setup/testDb.ts`.

- [ ] **Step 1: Initialize the Next.js + TypeScript + Prisma + Vitest project**

Run:
```bash
cd /Users/royal/Documents/GitHub/test-bet
npx create-next-app@latest . --typescript --app --no-tailwind --no-eslint --import-alias "@/*" --use-npm --yes
npm install prisma @prisma/client
npm install -D vitest @types/node dotenv
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Point tests at the local Homebrew Postgres**

Postgres 16 is already installed via Homebrew and running as a service (`brew services start postgresql@16`), with a `testbet` database that authenticates as the local macOS user `royal` (no password). The `psql`/`prisma` binaries live at `/opt/homebrew/opt/postgresql@16/bin` — ensure that's on PATH for commands in this plan (`export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"`).

Create `.env.test`:
```
DATABASE_URL="postgresql://royal@localhost:5432/testbet?schema=public"
```

Also create `.env` with the same value (Prisma migrate reads `.env`):
```
DATABASE_URL="postgresql://royal@localhost:5432/testbet?schema=public"
```

Verify: `psql -d testbet -c "select 1"` returns `1`.

- [ ] **Step 3: Configure Vitest to load `.env.test` and run serially**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config"
import { config } from "dotenv"

config({ path: ".env.test" })

export default defineConfig({
  test: {
    environment: "node",
    // The ledger's concurrency tests share one DB; run files serially so they don't collide.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
})
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create the Prisma client singleton**

Create `src/lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
```

- [ ] **Step 5: Write the test-db helpers (will be fleshed out after the schema exists)**

Create `tests/setup/testDb.ts`:
```ts
import { prisma } from "@/lib/db"

/** Wipe all ledger data between tests. Order respects FKs. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE "Posting", "Transaction", "Account" RESTART IDENTITY CASCADE`)
}

/** Create the singleton FAUCET and HOUSE system accounts. */
export async function seedSystemAccounts(): Promise<void> {
  await prisma.account.createMany({
    data: [
      { type: "FAUCET" },
      { type: "HOUSE" },
    ],
    skipDuplicates: true,
  })
}
```

- [ ] **Step 6: Write a smoke test proving the harness talks to real Postgres**

Create `tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"

describe("harness", () => {
  it("connects to a real Postgres", async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
    expect(rows[0].ok).toBe(1)
  })
})
```

- [ ] **Step 7: Run the smoke test to verify it fails (no DB pushed yet)**

Run: `npm test -- tests/smoke.test.ts`
Expected: FAIL — Prisma cannot connect / no schema. This confirms the test actually exercises the DB.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Prisma + Vitest with real-Postgres harness"
```

---

## Task 2: Ledger schema + constraints

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_ledger_constraints/migration.sql` (hand-added SQL, applied via `prisma migrate`)
- Create: `src/lib/wallet/config.ts`
- Test: `tests/wallet/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Account`, `Transaction`, `Posting`; enums `AccountType` (`AVAILABLE|ESCROW|FAUCET|HOUSE`), `TransactionType` (`SIGNUP|DAILY_BONUS|TOP_UP|ESCROW|SETTLE|REFUND`). Config constants from `src/lib/wallet/config.ts`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/wallet/schema.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("ledger schema", () => {
  it("rejects a duplicate idempotency key", async () => {
    await prisma.transaction.create({ data: { type: "SIGNUP", idempotencyKey: "k1" } })
    await expect(
      prisma.transaction.create({ data: { type: "SIGNUP", idempotencyKey: "k1" } }),
    ).rejects.toThrow()
  })

  it("forbids a negative balance on a user account", async () => {
    await expect(
      prisma.account.create({ data: { userId: "u1", type: "AVAILABLE", balance: -1n } }),
    ).rejects.toThrow()
  })

  it("allows a negative balance on FAUCET", async () => {
    await prisma.account.update({ where: { type_userId_null: undefined } as never, data: {} }).catch(() => {})
    const faucet = await prisma.account.findFirstOrThrow({ where: { type: "FAUCET" } })
    const updated = await prisma.account.update({ where: { id: faucet.id }, data: { balance: -500n } })
    expect(updated.balance).toBe(-500n)
  })

  it("permits only one FAUCET system account", async () => {
    await expect(prisma.account.create({ data: { type: "FAUCET" } })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/wallet/schema.test.ts`
Expected: FAIL — models/enums don't exist yet.

- [ ] **Step 3: Define the Prisma models**

Replace the model section of `prisma/schema.prisma` with:
```prisma
enum AccountType {
  AVAILABLE
  ESCROW
  FAUCET
  HOUSE
}

enum TransactionType {
  SIGNUP
  DAILY_BONUS
  TOP_UP
  ESCROW
  SETTLE
  REFUND
}

model Account {
  id        String      @id @default(uuid())
  userId    String?
  type      AccountType
  balance   BigInt      @default(0)
  createdAt DateTime    @default(now())
  postings  Posting[]

  @@unique([userId, type])
  @@index([userId])
}

model Transaction {
  id             String          @id @default(uuid())
  type           TransactionType
  idempotencyKey String          @unique
  metadata       Json?
  createdAt      DateTime        @default(now())
  postings       Posting[]
}

model Posting {
  id            String      @id @default(uuid())
  transactionId String
  accountId     String
  amount        BigInt
  createdAt     DateTime    @default(now())
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  account        Account     @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@index([transactionId])
}
```

- [ ] **Step 4: Create the initial migration**

Run: `npx prisma migrate dev --name init_ledger --skip-generate` (uses `.env`; ensure `DATABASE_URL` there points at the test DB on port 5433 for local dev, or export it inline)
Expected: migration created and applied; tables exist.

- [ ] **Step 5: Add the check constraint + system-account singleton index**

Create a new empty migration and edit its SQL:
Run: `npx prisma migrate dev --create-only --name ledger_constraints`
Then put in the generated `migration.sql`:
```sql
-- User accounts (AVAILABLE, ESCROW) may never go negative; system accounts may.
ALTER TABLE "Account"
  ADD CONSTRAINT user_balance_non_negative
  CHECK ("type" IN ('FAUCET', 'HOUSE') OR "balance" >= 0);

-- At most one system account per type (userId IS NULL rows are otherwise unconstrained by the composite unique).
CREATE UNIQUE INDEX one_system_account_per_type
  ON "Account" ("type") WHERE "userId" IS NULL;
```
Run: `npx prisma migrate dev` to apply, then `npx prisma generate`.

- [ ] **Step 6: Write the config constants**

Create `src/lib/wallet/config.ts`:
```ts
export const STARTING_CHIPS = 5000n
export const DAILY_BONUS = 1000n
export const TOP_UP_TARGET = 1000n
export const DAILY_COOLDOWN_MS = 86_400_000 // 24h
export const TOP_UP_WINDOW_MS = 10_000 // dedupe window for rapid top-up retries
```

- [ ] **Step 7: Fix the FAUCET-negative test to not reference a bogus where-clause**

Replace the third test body in `tests/wallet/schema.test.ts` with:
```ts
  it("allows a negative balance on FAUCET", async () => {
    const faucet = await prisma.account.findFirstOrThrow({ where: { type: "FAUCET" } })
    const updated = await prisma.account.update({ where: { id: faucet.id }, data: { balance: -500n } })
    expect(updated.balance).toBe(-500n)
  })
```

- [ ] **Step 8: Run the schema tests to verify they pass**

Run: `npm test -- tests/wallet/schema.test.ts`
Expected: PASS (all four).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(wallet): ledger schema, constraints, and economy config"
```

---

## Task 3: `postTransaction` — the atomic ledger primitive

**Files:**
- Create: `src/lib/wallet/errors.ts`, `src/lib/wallet/ledger.ts`
- Test: `tests/wallet/ledger.test.ts`

**Interfaces:**
- Consumes: `prisma` (db.ts); models/enums (Task 2).
- Produces:
  - `class WalletError extends Error`
  - `class LedgerImbalanceError extends WalletError`
  - `class InsufficientBalanceError extends WalletError`
  - `class DailyBonusCooldownError extends WalletError { resetAt: Date }`
  - `type PostingInput = { accountId: string; amount: bigint }`
  - `postTransaction(input: { type: TransactionType; idempotencyKey: string; metadata?: object; postings: PostingInput[] }): Promise<Transaction>`

- [ ] **Step 1: Write the typed errors**

Create `src/lib/wallet/errors.ts`:
```ts
export class WalletError extends Error {}

export class LedgerImbalanceError extends WalletError {
  constructor(public idempotencyKey: string, public sum: bigint) {
    super(`Postings for "${idempotencyKey}" sum to ${sum}, not 0`)
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(public accountId: string, public balance: bigint, public debit: bigint) {
    super(`Account ${accountId} has ${balance}, cannot debit ${debit}`)
  }
}

export class DailyBonusCooldownError extends WalletError {
  constructor(public resetAt: Date) {
    super(`Daily bonus already claimed; resets at ${resetAt.toISOString()}`)
  }
}
```

- [ ] **Step 2: Write the failing ledger tests**

Create `tests/wallet/ledger.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { postTransaction } from "@/lib/wallet/ledger"
import { LedgerImbalanceError, InsufficientBalanceError } from "@/lib/wallet/errors"

async function makeUser(id: string, available: bigint) {
  const avail = await prisma.account.create({ data: { userId: id, type: "AVAILABLE", balance: available } })
  const escrow = await prisma.account.create({ data: { userId: id, type: "ESCROW", balance: 0n } })
  return { avail, escrow }
}

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("postTransaction", () => {
  it("moves chips and updates cached balances", async () => {
    const { avail, escrow } = await makeUser("u1", 100n)
    await postTransaction({
      type: "ESCROW",
      idempotencyKey: "bet:1:place",
      postings: [
        { accountId: avail.id, amount: -100n },
        { accountId: escrow.id, amount: 100n },
      ],
    })
    const a = await prisma.account.findUniqueOrThrow({ where: { id: avail.id } })
    const e = await prisma.account.findUniqueOrThrow({ where: { id: escrow.id } })
    expect(a.balance).toBe(0n)
    expect(e.balance).toBe(100n)
  })

  it("rejects postings that do not sum to zero", async () => {
    const { avail, escrow } = await makeUser("u1", 100n)
    await expect(
      postTransaction({
        type: "ESCROW",
        idempotencyKey: "bad:1",
        postings: [
          { accountId: avail.id, amount: -100n },
          { accountId: escrow.id, amount: 90n },
        ],
      }),
    ).rejects.toBeInstanceOf(LedgerImbalanceError)
  })

  it("rejects a debit that would make a user balance negative", async () => {
    const { avail, escrow } = await makeUser("u1", 50n)
    await expect(
      postTransaction({
        type: "ESCROW",
        idempotencyKey: "bet:2:place",
        postings: [
          { accountId: avail.id, amount: -100n },
          { accountId: escrow.id, amount: 100n },
        ],
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
    const a = await prisma.account.findUniqueOrThrow({ where: { id: avail.id } })
    expect(a.balance).toBe(50n) // unchanged — full rollback
  })

  it("is idempotent: same key returns the original and moves chips once", async () => {
    const { avail, escrow } = await makeUser("u1", 100n)
    const input = {
      type: "ESCROW" as const,
      idempotencyKey: "bet:3:place",
      postings: [
        { accountId: avail.id, amount: -40n },
        { accountId: escrow.id, amount: 40n },
      ],
    }
    const first = await postTransaction(input)
    const second = await postTransaction(input)
    expect(second.id).toBe(first.id)
    const a = await prisma.account.findUniqueOrThrow({ where: { id: avail.id } })
    expect(a.balance).toBe(60n) // debited once, not twice
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/wallet/ledger.test.ts`
Expected: FAIL — `postTransaction` not defined.

- [ ] **Step 4: Implement `postTransaction`**

Create `src/lib/wallet/ledger.ts`:
```ts
import { Prisma, Transaction, TransactionType } from "@prisma/client"
import { prisma } from "@/lib/db"
import { InsufficientBalanceError, LedgerImbalanceError } from "./errors"

export type PostingInput = { accountId: string; amount: bigint }

export type PostTransactionInput = {
  type: TransactionType
  idempotencyKey: string
  metadata?: Prisma.InputJsonValue
  postings: PostingInput[]
}

export async function postTransaction(input: PostTransactionInput): Promise<Transaction> {
  const { type, idempotencyKey, metadata, postings } = input

  const sum = postings.reduce((acc, p) => acc + p.amount, 0n)
  if (sum !== 0n || postings.length < 2) {
    throw new LedgerImbalanceError(idempotencyKey, sum)
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey } })
      if (existing) return existing

      // Lock the involved account rows in a deterministic order (deadlock-safe).
      const accountIds = [...new Set(postings.map((p) => p.accountId))].sort()
      const locked = await tx.$queryRaw<{ id: string; type: string; balance: bigint }[]>(
        Prisma.sql`SELECT id, type, balance FROM "Account" WHERE id IN (${Prisma.join(
          accountIds,
        )}) ORDER BY id FOR UPDATE`,
      )
      const rows = new Map(locked.map((a) => [a.id, a]))

      // Net delta per account.
      const deltas = new Map<string, bigint>()
      for (const p of postings) deltas.set(p.accountId, (deltas.get(p.accountId) ?? 0n) + p.amount)

      const created = await tx.transaction.create({
        data: { type, idempotencyKey, metadata: metadata ?? Prisma.JsonNull },
      })

      for (const [accountId, delta] of deltas) {
        const row = rows.get(accountId)
        if (!row) throw new Error(`Account ${accountId} missing or unlocked`)
        const next = row.balance + delta
        if ((row.type === "AVAILABLE" || row.type === "ESCROW") && next < 0n) {
          throw new InsufficientBalanceError(accountId, row.balance, -delta)
        }
        await tx.account.update({ where: { id: accountId }, data: { balance: next } })
      }

      await tx.posting.createMany({
        data: postings.map((p) => ({
          transactionId: created.id,
          accountId: p.accountId,
          amount: p.amount,
        })),
      })

      return created
    })
  } catch (e) {
    // Idempotency race: a concurrent caller inserted the same key first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } })
      if (existing) return existing
    }
    throw e
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/wallet/ledger.test.ts`
Expected: PASS (all four).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(wallet): atomic postTransaction primitive with locking + idempotency"
```

---

## Task 4: Wallet operations

**Files:**
- Create: `src/lib/wallet/accounts.ts`, `src/lib/wallet/operations.ts`
- Test: `tests/wallet/operations.test.ts`

**Interfaces:**
- Consumes: `postTransaction` (Task 3); config (Task 2); errors (Task 3).
- Produces (from `accounts.ts`):
  - `ensureUserAccounts(userId: string): Promise<void>`
  - `getUserAccountId(userId: string, type: "AVAILABLE" | "ESCROW"): Promise<string>`
  - `getSystemAccountId(type: "FAUCET" | "HOUSE"): Promise<string>`
- Produces (from `operations.ts`):
  - `grantSignupBonus(userId: string): Promise<Transaction>`
  - `claimDailyBonus(userId: string): Promise<Transaction>` (throws `DailyBonusCooldownError`)
  - `autoTopUp(userId: string): Promise<Transaction | null>`
  - `escrow(userId: string, amount: bigint, key: string): Promise<Transaction>`
  - `settle(userId: string, stake: bigint, payout: bigint, key: string): Promise<Transaction>`
  - `refund(userId: string, amount: bigint, key: string): Promise<Transaction>`

- [ ] **Step 1: Write the account resolver**

Create `src/lib/wallet/accounts.ts`:
```ts
import { prisma } from "@/lib/db"

export async function ensureUserAccounts(userId: string): Promise<void> {
  await prisma.account.createMany({
    data: [
      { userId, type: "AVAILABLE" },
      { userId, type: "ESCROW" },
    ],
    skipDuplicates: true,
  })
}

export async function getUserAccountId(
  userId: string,
  type: "AVAILABLE" | "ESCROW",
): Promise<string> {
  await ensureUserAccounts(userId)
  const acct = await prisma.account.findUniqueOrThrow({
    where: { userId_type: { userId, type } },
  })
  return acct.id
}

export async function getSystemAccountId(type: "FAUCET" | "HOUSE"): Promise<string> {
  const acct = await prisma.account.findFirstOrThrow({ where: { type, userId: null } })
  return acct.id
}
```

- [ ] **Step 2: Write the failing operations tests**

Create `tests/wallet/operations.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import {
  grantSignupBonus, claimDailyBonus, autoTopUp, escrow, settle, refund,
} from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { InsufficientBalanceError, DailyBonusCooldownError } from "@/lib/wallet/errors"
import { STARTING_CHIPS, DAILY_BONUS, TOP_UP_TARGET } from "@/lib/wallet/config"

async function available(userId: string): Promise<bigint> {
  const id = await getUserAccountId(userId, "AVAILABLE")
  return (await prisma.account.findUniqueOrThrow({ where: { id } })).balance
}
async function escrowed(userId: string): Promise<bigint> {
  const id = await getUserAccountId(userId, "ESCROW")
  return (await prisma.account.findUniqueOrThrow({ where: { id } })).balance
}

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("wallet operations", () => {
  it("grants the signup bonus exactly once", async () => {
    await grantSignupBonus("u1")
    await grantSignupBonus("u1") // idempotent by key
    expect(await available("u1")).toBe(STARTING_CHIPS)
  })

  it("claims the daily bonus, then blocks a second claim in the same window", async () => {
    await grantSignupBonus("u1")
    await claimDailyBonus("u1")
    expect(await available("u1")).toBe(STARTING_CHIPS + DAILY_BONUS)
    await expect(claimDailyBonus("u1")).rejects.toBeInstanceOf(DailyBonusCooldownError)
  })

  it("tops up a broke wallet up to the target, and no-ops when funded", async () => {
    await grantSignupBonus("u1")
    await escrow("u1", STARTING_CHIPS, "drain:1") // move everything to escrow
    expect(await available("u1")).toBe(0n)
    await autoTopUp("u1")
    expect(await available("u1")).toBe(TOP_UP_TARGET)
    const noop = await autoTopUp("u1")
    expect(noop).toBeNull()
  })

  it("escrows a stake and rejects an over-stake", async () => {
    await grantSignupBonus("u1")
    await escrow("u1", 100n, "bet:1:place")
    expect(await available("u1")).toBe(STARTING_CHIPS - 100n)
    expect(await escrowed("u1")).toBe(100n)
    await expect(escrow("u1", STARTING_CHIPS, "bet:2:place")).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    )
  })

  it("settles a win: stake returns + winnings from HOUSE", async () => {
    await grantSignupBonus("u1")
    await escrow("u1", 100n, "bet:1:place")
    await settle("u1", 100n, 200n, "bet:1:settle") // 2x payout
    expect(await escrowed("u1")).toBe(0n)
    expect(await available("u1")).toBe(STARTING_CHIPS - 100n + 200n)
  })

  it("settles a loss: stake goes to HOUSE", async () => {
    await grantSignupBonus("u1")
    await escrow("u1", 100n, "bet:2:place")
    await settle("u1", 100n, 0n, "bet:2:settle")
    expect(await escrowed("u1")).toBe(0n)
    expect(await available("u1")).toBe(STARTING_CHIPS - 100n)
  })

  it("refunds a voided bet", async () => {
    await grantSignupBonus("u1")
    await escrow("u1", 100n, "bet:3:place")
    await refund("u1", 100n, "bet:3:refund")
    expect(await escrowed("u1")).toBe(0n)
    expect(await available("u1")).toBe(STARTING_CHIPS)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/wallet/operations.test.ts`
Expected: FAIL — operations not defined.

- [ ] **Step 4: Implement the operations**

Create `src/lib/wallet/operations.ts`:
```ts
import { Transaction } from "@prisma/client"
import { prisma } from "@/lib/db"
import { postTransaction, PostingInput } from "./ledger"
import { getUserAccountId, getSystemAccountId } from "./accounts"
import { DailyBonusCooldownError } from "./errors"
import {
  STARTING_CHIPS, DAILY_BONUS, TOP_UP_TARGET, DAILY_COOLDOWN_MS, TOP_UP_WINDOW_MS,
} from "./config"

/** FAUCET → user's AVAILABLE. Idempotent by a fixed per-user key. */
export async function grantSignupBonus(userId: string): Promise<Transaction> {
  const faucet = await getSystemAccountId("FAUCET")
  const avail = await getUserAccountId(userId, "AVAILABLE")
  return postTransaction({
    type: "SIGNUP",
    idempotencyKey: `signup:${userId}`,
    metadata: { userId },
    postings: [
      { accountId: faucet, amount: -STARTING_CHIPS },
      { accountId: avail, amount: STARTING_CHIPS },
    ],
  })
}

/** FAUCET → AVAILABLE, at most once per 24h window (epoch-bucketed). */
export async function claimDailyBonus(userId: string): Promise<Transaction> {
  const bucket = Math.floor(Date.now() / DAILY_COOLDOWN_MS)
  const key = `daily:${userId}:${bucket}`
  const already = await prisma.transaction.findUnique({ where: { idempotencyKey: key } })
  if (already) {
    throw new DailyBonusCooldownError(new Date((bucket + 1) * DAILY_COOLDOWN_MS))
  }
  const faucet = await getSystemAccountId("FAUCET")
  const avail = await getUserAccountId(userId, "AVAILABLE")
  try {
    return await postTransaction({
      type: "DAILY_BONUS",
      idempotencyKey: key,
      metadata: { userId },
      postings: [
        { accountId: faucet, amount: -DAILY_BONUS },
        { accountId: avail, amount: DAILY_BONUS },
      ],
    })
  } catch (e) {
    // Lost a race for the same window.
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: key } })
    if (existing) throw new DailyBonusCooldownError(new Date((bucket + 1) * DAILY_COOLDOWN_MS))
    throw e
  }
}

/** FAUCET → AVAILABLE to reach TOP_UP_TARGET, only when AVAILABLE is 0. */
export async function autoTopUp(userId: string): Promise<Transaction | null> {
  const availId = await getUserAccountId(userId, "AVAILABLE")
  const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
  if (avail.balance > 0n) return null
  const faucet = await getSystemAccountId("FAUCET")
  const bucket = Math.floor(Date.now() / TOP_UP_WINDOW_MS)
  return postTransaction({
    type: "TOP_UP",
    idempotencyKey: `topup:${userId}:${bucket}`,
    metadata: { userId },
    postings: [
      { accountId: faucet, amount: -TOP_UP_TARGET },
      { accountId: availId, amount: TOP_UP_TARGET },
    ],
  })
}

/** AVAILABLE → ESCROW. */
export async function escrow(userId: string, amount: bigint, key: string): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  return postTransaction({
    type: "ESCROW",
    idempotencyKey: key,
    metadata: { userId, amount: amount.toString() },
    postings: [
      { accountId: avail, amount: -amount },
      { accountId: esc, amount: amount },
    ],
  })
}

/** ESCROW → AVAILABLE (payout) / HOUSE (net). Zero-amount legs are dropped. */
export async function settle(
  userId: string, stake: bigint, payout: bigint, key: string,
): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  const house = await getSystemAccountId("HOUSE")
  const houseNet = stake - payout // >0 on a loss, <0 on a win, 0 on a push
  const postings: PostingInput[] = [{ accountId: esc, amount: -stake }]
  if (payout !== 0n) postings.push({ accountId: avail, amount: payout })
  if (houseNet !== 0n) postings.push({ accountId: house, amount: houseNet })
  return postTransaction({
    type: "SETTLE",
    idempotencyKey: key,
    metadata: { userId, stake: stake.toString(), payout: payout.toString() },
    postings,
  })
}

/** ESCROW → AVAILABLE. */
export async function refund(userId: string, amount: bigint, key: string): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  return postTransaction({
    type: "REFUND",
    idempotencyKey: key,
    metadata: { userId, amount: amount.toString() },
    postings: [
      { accountId: esc, amount: -amount },
      { accountId: avail, amount: amount },
    ],
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/wallet/operations.test.ts`
Expected: PASS (all seven).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(wallet): signup/daily/top-up/escrow/settle/refund operations"
```

---

## Task 5: The proof suite — invariants, concurrency, idempotency, fuzz

**Files:**
- Create: `src/lib/wallet/reconcile.ts`
- Test: `tests/wallet/invariants.test.ts`, `tests/wallet/concurrency.test.ts`, `tests/wallet/property.test.ts`

**Interfaces:**
- Consumes: operations (Task 4); `postTransaction` (Task 3).
- Produces (from `reconcile.ts`):
  - `assertConservation(): Promise<void>` — throws if all postings don't sum to 0.
  - `findBalanceDrift(): Promise<{ accountId: string; cached: bigint; ledger: bigint }[]>` — accounts whose cached balance ≠ sum of postings.

- [ ] **Step 1: Write the reconciliation helpers**

Create `src/lib/wallet/reconcile.ts`:
```ts
import { prisma } from "@/lib/db"

export async function assertConservation(): Promise<void> {
  const [{ sum }] = await prisma.$queryRaw<{ sum: bigint | null }[]>`
    SELECT COALESCE(SUM(amount), 0) AS sum FROM "Posting"
  `
  if ((sum ?? 0n) !== 0n) throw new Error(`Ledger not conserved: total = ${sum}`)
}

export async function findBalanceDrift(): Promise<
  { accountId: string; cached: bigint; ledger: bigint }[]
> {
  const rows = await prisma.$queryRaw<{ accountId: string; cached: bigint; ledger: bigint }[]>`
    SELECT a.id AS "accountId", a.balance AS cached,
           COALESCE(SUM(p.amount), 0) AS ledger
    FROM "Account" a
    LEFT JOIN "Posting" p ON p."accountId" = a.id
    GROUP BY a.id, a.balance
    HAVING a.balance <> COALESCE(SUM(p.amount), 0)
  `
  return rows
}
```

- [ ] **Step 2: Write the invariant test**

Create `tests/wallet/invariants.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, escrow, settle, refund } from "@/lib/wallet/operations"
import { assertConservation, findBalanceDrift } from "@/lib/wallet/reconcile"

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("ledger invariants", () => {
  it("conserves chips and keeps caches in sync after a mixed sequence", async () => {
    await grantSignupBonus("u1")
    await grantSignupBonus("u2")
    await escrow("u1", 300n, "u1:b1:place")
    await settle("u1", 300n, 600n, "u1:b1:settle") // win
    await escrow("u2", 500n, "u2:b1:place")
    await settle("u2", 500n, 0n, "u2:b1:settle") // loss
    await escrow("u1", 200n, "u1:b2:place")
    await refund("u1", 200n, "u1:b2:refund")

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })
})
```

- [ ] **Step 3: Write the concurrency (double-spend) test**

Create `tests/wallet/concurrency.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, escrow } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { findBalanceDrift } from "@/lib/wallet/reconcile"
import { STARTING_CHIPS } from "@/lib/wallet/config"

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("concurrency", () => {
  it("never double-spends under parallel escrows", async () => {
    await grantSignupBonus("u1") // STARTING_CHIPS available
    const stake = STARTING_CHIPS // each attempt tries to escrow the ENTIRE balance
    const attempts = 20

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) => escrow("u1", stake, `race:${i}:place`)),
    )
    const ok = results.filter((r) => r.status === "fulfilled").length

    expect(ok).toBe(1) // exactly one full-balance escrow can win

    const availId = await getUserAccountId(u1AvailArg())
    const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
    expect(avail.balance >= 0n).toBe(true)
    expect(await findBalanceDrift()).toEqual([])
  })
})

function u1AvailArg(): [string, "AVAILABLE"] {
  return ["u1", "AVAILABLE"]
}
```

Note: the helper indirection above is a mistake to fix in Step 5; keep it for now so the test fails to compile/run first.

- [ ] **Step 4: Run the invariant + concurrency tests to verify they fail**

Run: `npm test -- tests/wallet/invariants.test.ts tests/wallet/concurrency.test.ts`
Expected: FAIL — `reconcile` maybe fine, but concurrency test references the broken `u1AvailArg()` spread; invariants should actually pass. Confirm concurrency fails.

- [ ] **Step 5: Fix the concurrency test to call `getUserAccountId` correctly**

Replace the two lines in `tests/wallet/concurrency.test.ts` that use `u1AvailArg()` and delete the helper:
```ts
    const availId = await getUserAccountId("u1", "AVAILABLE")
    const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
```
(delete the `function u1AvailArg()` block entirely.)

- [ ] **Step 6: Write the property-based fuzz test**

Create `tests/wallet/property.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, escrow, settle, refund } from "@/lib/wallet/operations"
import { assertConservation, findBalanceDrift } from "@/lib/wallet/reconcile"
import { prisma } from "@/lib/db"
import { getUserAccountId } from "@/lib/wallet/accounts"

// Deterministic PRNG (seeded) so the fuzz run is reproducible — no Math.random.
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("property: invariants hold under random valid sequences", () => {
  it("stays conserved and drift-free over many random operations", async () => {
    const rng = makeRng(42)
    const users = ["a", "b", "c"]
    for (const u of users) await grantSignupBonus(u)

    // Track open bets per user so we only settle/refund real escrow.
    const open: Record<string, { id: number; stake: bigint }[]> = { a: [], b: [], c: [] }
    let seq = 0

    for (let i = 0; i < 300; i++) {
      const u = users[Math.floor(rng() * users.length)]
      const roll = rng()
      if (roll < 0.5) {
        // place a bet for a random affordable stake
        const availId = await getUserAccountId(u, "AVAILABLE")
        const avail = (await prisma.account.findUniqueOrThrow({ where: { id: availId } })).balance
        if (avail <= 0n) continue
        const stake = BigInt(1 + Math.floor(rng() * Number(avail > 500n ? 500n : avail)))
        const id = seq++
        await escrow(u, stake, `f:${u}:${id}:place`)
        open[u].push({ id, stake })
      } else if (open[u].length > 0) {
        const bet = open[u].pop()!
        if (roll < 0.75) {
          // settle win/loss: payout in [0, 2*stake]
          const payout = BigInt(Math.floor(rng() * Number(2n * bet.stake + 1n)))
          await settle(u, bet.stake, payout, `f:${u}:${bet.id}:settle`)
        } else {
          await refund(u, bet.stake, `f:${u}:${bet.id}:refund`)
        }
      }
    }

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })
})
```

- [ ] **Step 7: Run the whole proof suite to verify it passes**

Run: `npm test -- tests/wallet/invariants.test.ts tests/wallet/concurrency.test.ts tests/wallet/property.test.ts`
Expected: PASS (all three). If the concurrency test's `ok` is not exactly 1, the row-locking in Task 3 is wrong — stop and fix `postTransaction`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(wallet): invariants, no-double-spend, and property/fuzz proof suite"
```

---

## Task 6: Auth + wallet API endpoints

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/serialize.ts`
- Create: `src/app/api/wallet/route.ts`, `src/app/api/wallet/history/route.ts`, `src/app/api/wallet/daily-bonus/route.ts`, `src/app/api/wallet/top-up/route.ts`
- Test: `tests/api/wallet.test.ts`

**Interfaces:**
- Consumes: operations (Task 4); `prisma`.
- Produces: `requireUserId(req: Request): Promise<string>` (throws `Response` 401 if unauthenticated); route handlers `GET`/`POST`.

- [ ] **Step 1: Write the auth + serialize helpers**

Create `src/lib/auth.ts`:
```ts
// Phase 0: session is resolved from a verified Supabase JWT in production.
// For testability the handler reads the user id from a verified session helper
// that tests can stub via the `x-test-user` header when TEST_AUTH=1.
export async function requireUserId(req: Request): Promise<string> {
  if (process.env.TEST_AUTH === "1") {
    const u = req.headers.get("x-test-user")
    if (!u) throw new Response("Unauthorized", { status: 401 })
    return u
  }
  // Production: verify Supabase session cookie here and return its user id.
  // (Wired when Supabase Auth is added; intentionally not stubbed with a fake user.)
  throw new Response("Unauthorized", { status: 401 })
}
```

Create `src/lib/serialize.ts`:
```ts
// BigInt is not JSON-serializable; render chip amounts as strings.
export function chips(n: bigint): string {
  return n.toString()
}
```

- [ ] **Step 2: Write the failing API test**

Create `tests/api/wallet.test.ts`:
```ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { GET as getWallet } from "@/app/api/wallet/route"
import { POST as postDaily } from "@/app/api/wallet/daily-bonus/route"

beforeAll(() => { process.env.TEST_AUTH = "1" })
beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

function req(path: string, user?: string, method = "GET"): Request {
  const headers: Record<string, string> = {}
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { method, headers })
}

describe("wallet API", () => {
  it("401s without a session", async () => {
    const res = await getWallet(req("/api/wallet"))
    expect(res.status).toBe(401)
  })

  it("returns balances for the authed user", async () => {
    await grantSignupBonus("u1")
    const res = await getWallet(req("/api/wallet", "u1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toBe("5000")
    expect(body.escrow).toBe("0")
  })

  it("claims the daily bonus then 429s the second time", async () => {
    await grantSignupBonus("u1")
    const ok = await postDaily(req("/api/wallet/daily-bonus", "u1", "POST"))
    expect(ok.status).toBe(200)
    const again = await postDaily(req("/api/wallet/daily-bonus", "u1", "POST"))
    expect(again.status).toBe(429)
  })
})
```

- [ ] **Step 3: Run the API test to verify it fails**

Run: `TEST_AUTH=1 npm test -- tests/api/wallet.test.ts`
Expected: FAIL — route modules don't exist.

- [ ] **Step 4: Implement the balances route**

Create `src/app/api/wallet/route.ts`:
```ts
import { prisma } from "@/lib/db"
import { requireUserId } from "@/lib/auth"
import { ensureUserAccounts } from "@/lib/wallet/accounts"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  await ensureUserAccounts(userId)
  const accts = await prisma.account.findMany({ where: { userId } })
  const available = accts.find((a) => a.type === "AVAILABLE")?.balance ?? 0n
  const escrow = accts.find((a) => a.type === "ESCROW")?.balance ?? 0n
  return Response.json({ available: chips(available), escrow: chips(escrow) })
}
```

- [ ] **Step 5: Implement the history route**

Create `src/app/api/wallet/history/route.ts`:
```ts
import { prisma } from "@/lib/db"
import { requireUserId } from "@/lib/auth"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const url = new URL(req.url)
  const take = Math.min(Number(url.searchParams.get("limit") ?? 50), 100)
  const cursor = url.searchParams.get("cursor") ?? undefined

  const txns = await prisma.transaction.findMany({
    where: { postings: { some: { account: { userId } } } },
    include: { postings: { where: { account: { userId } } } },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const items = txns.slice(0, take).map((t) => ({
    id: t.id,
    type: t.type,
    createdAt: t.createdAt.toISOString(),
    net: chips(t.postings.reduce((s, p) => s + p.amount, 0n)),
  }))
  const nextCursor = txns.length > take ? txns[take - 1].id : null
  return Response.json({ items, nextCursor })
}
```

- [ ] **Step 6: Implement the daily-bonus route**

Create `src/app/api/wallet/daily-bonus/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { claimDailyBonus } from "@/lib/wallet/operations"
import { DailyBonusCooldownError } from "@/lib/wallet/errors"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  try {
    const txn = await claimDailyBonus(userId)
    return Response.json({ ok: true, transactionId: txn.id })
  } catch (e) {
    if (e instanceof DailyBonusCooldownError) {
      return Response.json(
        { ok: false, resetAt: e.resetAt.toISOString() },
        { status: 429 },
      )
    }
    throw e
  }
}
```

- [ ] **Step 7: Implement the top-up route**

Create `src/app/api/wallet/top-up/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { autoTopUp } from "@/lib/wallet/operations"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const txn = await autoTopUp(userId)
  if (!txn) return Response.json({ ok: false, reason: "not_broke" }, { status: 422 })
  return Response.json({ ok: true, transactionId: txn.id })
}
```

- [ ] **Step 8: Run the API test to verify it passes**

Run: `TEST_AUTH=1 npm test -- tests/api/wallet.test.ts`
Expected: PASS (all three).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): wallet balances, history, daily-bonus, and top-up endpoints"
```

---

## Task 7: Signup hook wiring (documentation + integration point)

**Files:**
- Create: `src/lib/wallet/onSignup.ts`
- Test: `tests/wallet/onSignup.test.ts`

**Interfaces:**
- Consumes: `grantSignupBonus` (Task 4), `ensureUserAccounts` (Task 4).
- Produces: `onUserCreated(userId: string): Promise<void>` — the single function the auth provider's "user created" webhook/trigger calls.

- [ ] **Step 1: Write the failing test**

Create `tests/wallet/onSignup.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { onUserCreated } from "@/lib/wallet/onSignup"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { prisma } from "@/lib/db"
import { STARTING_CHIPS } from "@/lib/wallet/config"

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("onUserCreated", () => {
  it("provisions accounts and grants the signup bonus exactly once", async () => {
    await onUserCreated("u1")
    await onUserCreated("u1") // webhook re-delivery must be safe
    const availId = await getUserAccountId("u1", "AVAILABLE")
    const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
    expect(avail.balance).toBe(STARTING_CHIPS)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/wallet/onSignup.test.ts`
Expected: FAIL — `onUserCreated` not defined.

- [ ] **Step 3: Implement the hook**

Create `src/lib/wallet/onSignup.ts`:
```ts
import { ensureUserAccounts, } from "./accounts"
import { grantSignupBonus } from "./operations"

/**
 * Call from the auth provider's "user created" webhook/trigger.
 * Idempotent: safe under webhook re-delivery (grant is keyed `signup:{userId}`).
 */
export async function onUserCreated(userId: string): Promise<void> {
  await ensureUserAccounts(userId)
  await grantSignupBonus(userId)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/wallet/onSignup.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: ALL green — schema, ledger, operations, invariants, concurrency, property, api, onSignup.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(wallet): idempotent onUserCreated signup hook"
```

---

## Self-Review Notes

**Spec coverage:**
- Section 1 (data model) → Task 2. Integer chips, non-negative check, cached balance, sum-to-zero → Tasks 2–3.
- Section 2 (operations, idempotency, concurrency) → Tasks 3–4; proven in Task 5.
- Section 3 (auth, API, error handling) → Task 6 (422 insufficient, 429 cooldown, 401 unauth). Rate-limit/anti-abuse: daily/top-up are window-bucketed (Task 4); drift canary → `findBalanceDrift` (Task 5).
- Section 4 (testing) → Task 5 covers invariants, idempotency (also Task 3), concurrency, property/fuzz.

**Known follow-ups (out of Phase 0 scope, noted not silently dropped):**
- `requireUserId` production branch is intentionally a 401 stub until Supabase Auth is wired — no fake user is minted. Wiring is a Phase-0.5 task once an auth provider is chosen.
- Daily-bonus/top-up use epoch-window buckets (simple + race-safe) rather than a rolling cooldown from the exact last-claim instant; acceptable for launch, documented here.
- A scheduled reconciliation job (calling `assertConservation` + `findBalanceDrift` on a cron) is wired at deploy time; the functions exist and are tested.

**Type consistency:** `getUserAccountId(userId, "AVAILABLE"|"ESCROW")`, `getSystemAccountId("FAUCET"|"HOUSE")`, `postTransaction({type, idempotencyKey, metadata?, postings})`, and the six operation signatures are used identically across tasks and tests.
