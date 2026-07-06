# Crash Game & UI (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a solo, provably-fair, server-authoritative Crash game on the Phase 0 wallet, with a dev login and the "Cyber-Arcade" UI.

**Architecture:** Server owns the crash point (hidden) and validates cash-out against its own clock; the client only animates and polls. Provably-fair via SHA-256 commit/reveal. All game logic is pure, tested TypeScript in `src/lib/crash/`; chips move only through the Phase 0 wallet primitives. UI is a Tailwind/React App Router front end.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Prisma 7 + Postgres, Tailwind CSS, Vitest against real Postgres, Node `crypto`.

## Global Constraints

- **Multipliers are integer hundredths** everywhere (2.47× → `247`). Chips remain `BigInt`.
- **`GROWTH_RATE = 0.155`**, **`HOUSE_EDGE_DIVISOR = 101`**, **`MIN_STAKE = 1n`**, **`STATUS_POLL_MS = 300`**.
- **Crash point and server seed are NEVER returned before a round is settled.**
- Chips move only via Phase 0 wallet: `escrow(userId, amount, key)`, `settle(userId, stake, payout, key)`; keys are `crash:{roundId}:place` and `crash:{roundId}:settle`.
- **Cash-out multiplier is computed from the server clock**, never trusted from the client.
- **Dev auth fails closed in production**: dev-login 403s and the dev cookie is ignored when `NODE_ENV === "production"`.
- Tests run against the real local Postgres (`postgresql://royal@localhost:5432/testbet`), `fileParallelism: false`.
- UI is dark single-theme "Cyber-Arcade"; palette bg `#0b0e11`, green `#24e39b`, red `#ff4c5e`, gold `#ffc24b`. Design reference: `docs/DESIGN-crash-cyber-arcade.md` and `stitch-crash.html` (in scratchpad). No "Deposit"/withdraw language; nav is Play / History / Fairness; Daily-bonus replaces Deposit.

---

## File Structure

- `src/lib/crash/config.ts` — game constants.
- `src/lib/crash/math.ts` — multiplier/time math + hundredths helpers.
- `src/lib/crash/fair.ts` — seed/commit/crash-point derivation (provably fair).
- `src/lib/crash/rounds.ts` — round lifecycle service (bet/cashout/status/sweep/history/verify).
- `src/lib/session.ts` — signed-cookie sign/verify.
- `src/lib/auth.ts` — extend `requireUserId` with the dev cookie (Phase 0 file).
- `prisma/schema.prisma` — `CrashRound` model + `CrashStatus` enum.
- `app/api/auth/dev-login/route.ts`, `app/api/auth/logout/route.ts`.
- `app/api/crash/{bet,cashout,history}/route.ts`, `app/api/crash/round/[id]/route.ts`, `app/api/crash/verify/[id]/route.ts`.
- Tailwind: `tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css`, `app/layout.tsx`.
- Pages: `app/login/page.tsx`, `app/play/page.tsx`, `app/history/page.tsx`, `app/fairness/page.tsx`.
- Components: `components/NavRail.tsx`, `WalletChip.tsx`, `CrashStage.tsx`, `MultiplierReadout.tsx`, `BetPanel.tsx`, `RecentRounds.tsx`, `FairnessCard.tsx`, `PlayClient.tsx`.
- Tests: `tests/crash/{math,fair,rounds,sweep}.test.ts`, `tests/api/crash.test.ts`, `tests/auth/dev-auth.test.ts`.

---

## Task 1: Crash config + math + provably-fair core

**Files:**
- Create: `src/lib/crash/config.ts`, `src/lib/crash/math.ts`, `src/lib/crash/fair.ts`
- Test: `tests/crash/math.test.ts`, `tests/crash/fair.test.ts`

**Interfaces:**
- Produces:
  - `config.ts`: `GROWTH_RATE=0.155`, `HOUSE_EDGE_DIVISOR=101`, `MIN_STAKE=1n`, `STATUS_POLL_MS=300`.
  - `math.ts`: `multiplierAt(elapsedMs: number): number` (hundredths, floored); `crashTimeMs(crashHundredths: number): number`; `payoutFor(stake: bigint, multHundredths: number): bigint`.
  - `fair.ts`: `newServerSeed(): string`; `commitHash(serverSeed: string): string`; `crashPointFromHash(serverSeed: string, clientSeed: string): number` (hundredths); `deriveRound(clientSeed: string): { serverSeed: string; commitHash: string; crashPoint: number }`.

- [ ] **Step 1: Write the config**

Create `src/lib/crash/config.ts`:
```ts
export const GROWTH_RATE = 0.155        // per second; ~2x at ~4.5s
export const HOUSE_EDGE_DIVISOR = 101   // ~1% instant-bust house edge
export const MIN_STAKE = 1n
export const STATUS_POLL_MS = 300
```

- [ ] **Step 2: Write the failing math tests**

Create `tests/crash/math.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { multiplierAt, crashTimeMs, payoutFor } from "@/lib/crash/math"
import { GROWTH_RATE } from "@/lib/crash/config"

describe("crash math", () => {
  it("starts at 1.00x and rises monotonically", () => {
    expect(multiplierAt(0)).toBe(100)
    expect(multiplierAt(1000)).toBeGreaterThan(100)
    expect(multiplierAt(2000)).toBeGreaterThan(multiplierAt(1000))
  })

  it("reaches ~2.00x near 4.5s", () => {
    const m = multiplierAt(Math.log(2) / GROWTH_RATE * 1000)
    expect(m).toBeGreaterThanOrEqual(199)
    expect(m).toBeLessThanOrEqual(201)
  })

  it("crashTimeMs is the inverse of multiplierAt", () => {
    const t = crashTimeMs(247) // 2.47x
    expect(multiplierAt(t)).toBeGreaterThanOrEqual(246)
    expect(multiplierAt(t)).toBeLessThanOrEqual(248)
  })

  it("payoutFor floors stake * multiplier / 100", () => {
    expect(payoutFor(100n, 247)).toBe(247n)
    expect(payoutFor(100n, 155)).toBe(155n)
    expect(payoutFor(3n, 150)).toBe(4n) // floor(3*1.5)=4
    expect(payoutFor(100n, 100)).toBe(100n)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/crash/math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the math**

Create `src/lib/crash/math.ts`:
```ts
import { GROWTH_RATE } from "./config"

/** Multiplier at `elapsedMs` since round start, in integer hundredths, floored. */
export function multiplierAt(elapsedMs: number): number {
  const m = Math.exp(GROWTH_RATE * (elapsedMs / 1000))
  return Math.max(100, Math.floor(m * 100))
}

/** Milliseconds from round start until the multiplier reaches `crashHundredths`. */
export function crashTimeMs(crashHundredths: number): number {
  const x = crashHundredths / 100
  return Math.max(0, (Math.log(x) / GROWTH_RATE) * 1000)
}

/** Chips returned for a stake cashed out at `multHundredths` (floored to integer chips). */
export function payoutFor(stake: bigint, multHundredths: number): bigint {
  return (stake * BigInt(multHundredths)) / 100n
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- tests/crash/math.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Write the failing provably-fair tests**

Create `tests/crash/fair.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { newServerSeed, commitHash, crashPointFromHash, deriveRound } from "@/lib/crash/fair"
import { HOUSE_EDGE_DIVISOR } from "@/lib/crash/config"

describe("provably fair", () => {
  it("commitHash is sha256(serverSeed) and verifiable", () => {
    const seed = newServerSeed()
    expect(commitHash(seed)).toBe(createHash("sha256").update(seed).digest("hex"))
    expect(seed).toMatch(/^[0-9a-f]{64}$/)
  })

  it("crashPointFromHash is deterministic and never below 1.00x", () => {
    const seed = "a".repeat(64)
    const a = crashPointFromHash(seed, "client-1")
    const b = crashPointFromHash(seed, "client-1")
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(100)
  })

  it("distribution: instant-bust rate ~1/divisor, median ~2x", () => {
    let bust = 0
    const points: number[] = []
    for (let i = 0; i < 5000; i++) {
      const p = crashPointFromHash("a".repeat(64), "c" + i)
      if (p === 100) bust++
      points.push(p)
    }
    const bustRate = bust / 5000
    expect(bustRate).toBeGreaterThan(1 / HOUSE_EDGE_DIVISOR / 2)
    expect(bustRate).toBeLessThan((1 / HOUSE_EDGE_DIVISOR) * 2.2)
    points.sort((x, y) => x - y)
    const median = points[Math.floor(points.length / 2)]
    expect(median).toBeGreaterThan(150) // ~2x, allow slack
    expect(median).toBeLessThan(260)
  })

  it("deriveRound ties seed, commit, and crash point together", () => {
    const r = deriveRound("client-x")
    expect(commitHash(r.serverSeed)).toBe(r.commitHash)
    expect(crashPointFromHash(r.serverSeed, "client-x")).toBe(r.crashPoint)
  })
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- tests/crash/fair.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement provably-fair**

Create `src/lib/crash/fair.ts`:
```ts
import { createHash, createHmac, randomBytes } from "node:crypto"
import { HOUSE_EDGE_DIVISOR } from "./config"

export function newServerSeed(): string {
  return randomBytes(32).toString("hex")
}

export function commitHash(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex")
}

/** Bustabit-style crash point in integer hundredths (>= 100). */
export function crashPointFromHash(serverSeed: string, clientSeed: string): number {
  const hmac = createHmac("sha256", serverSeed).update(clientSeed).digest("hex")
  // first 52 bits of the digest as an integer
  const h = Number(BigInt("0x" + hmac.slice(0, 13)))
  if (h % HOUSE_EDGE_DIVISOR === 0) return 100 // instant bust — the house edge
  const e = 2 ** 52
  return Math.floor((100 * e - h) / (e - h))
}

export function deriveRound(clientSeed: string): {
  serverSeed: string
  commitHash: string
  crashPoint: number
} {
  const serverSeed = newServerSeed()
  return {
    serverSeed,
    commitHash: commitHash(serverSeed),
    crashPoint: crashPointFromHash(serverSeed, clientSeed),
  }
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test -- tests/crash/fair.test.ts`
Expected: PASS (4).

- [ ] **Step 10: Commit**

```bash
git add src/lib/crash tests/crash/math.test.ts tests/crash/fair.test.ts
git commit -m "feat(crash): config, multiplier math, and provably-fair crash-point derivation"
```

---

## Task 2: CrashRound schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_crash_round/migration.sql` (models) + `<ts>_crash_active_unique/migration.sql` (partial unique index)
- Test: `tests/crash/schema.test.ts`

**Interfaces:**
- Produces: Prisma model `CrashRound`; enum `CrashStatus` (`RUNNING|CASHED_OUT|BUSTED`).

- [ ] **Step 1: Write the failing schema test**

Create `tests/crash/schema.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"

beforeEach(async () => { await resetDb(); await seedSystemAccounts() })

describe("CrashRound schema", () => {
  it("stores a running round with hundredths crash point", async () => {
    const r = await prisma.crashRound.create({
      data: {
        userId: "u1", stake: 100n, clientSeed: "c", serverSeed: "s",
        commitHash: "h", crashPoint: 247, status: "RUNNING",
      },
    })
    expect(r.status).toBe("RUNNING")
    expect(r.crashPoint).toBe(247)
    expect(r.stake).toBe(100n)
  })

  it("permits only one RUNNING round per user", async () => {
    const base = { userId: "u1", stake: 100n, clientSeed: "c", serverSeed: "s", commitHash: "h", crashPoint: 200, status: "RUNNING" as const }
    await prisma.crashRound.create({ data: base })
    await expect(prisma.crashRound.create({ data: base })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/crash/schema.test.ts`
Expected: FAIL — `crashRound` model missing.

- [ ] **Step 3: Add the model to `prisma/schema.prisma`**

Append:
```prisma
enum CrashStatus {
  RUNNING
  CASHED_OUT
  BUSTED
}

model CrashRound {
  id                String      @id @default(uuid())
  userId            String
  stake             BigInt
  clientSeed        String
  serverSeed        String
  commitHash        String
  crashPoint        Int         // hundredths, hidden from client until settled
  autoCashout       Int?        // hundredths
  status            CrashStatus @default(RUNNING)
  startedAt         DateTime    @default(now())
  cashoutMultiplier Int?        // hundredths
  payout            BigInt?
  settledAt         DateTime?

  @@index([userId, startedAt])
}
```

- [ ] **Step 4: Create + apply the model migration**

Run: `npx prisma migrate dev --name crash_round`
Expected: migration applied; `CrashRound` table exists.

- [ ] **Step 5: Add the single-active-round partial unique index**

Run: `npx prisma migrate dev --create-only --name crash_active_unique`
Edit the generated `migration.sql`:
```sql
CREATE UNIQUE INDEX one_running_round_per_user
  ON "CrashRound" ("userId") WHERE "status" = 'RUNNING';
```
Run: `npx prisma migrate dev` then `npx prisma generate`.

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- tests/crash/schema.test.ts`
Expected: PASS (2).

- [ ] **Step 7: Commit**

```bash
git add prisma tests/crash/schema.test.ts
git commit -m "feat(crash): CrashRound schema with single-active-round index"
```

---

## Task 3: Round service — bet & cash-out

**Files:**
- Create: `src/lib/crash/rounds.ts`
- Test: `tests/crash/rounds.test.ts`

**Interfaces:**
- Consumes: `deriveRound` (Task 1), `multiplierAt`/`crashTimeMs`/`payoutFor` (Task 1), wallet `escrow`/`settle` (Phase 0), `prisma`.
- Produces:
  - `placeBet(userId: string, stake: bigint, opts?: { clientSeed?: string; autoCashout?: number }): Promise<{ roundId: string; commitHash: string; startedAt: Date; growthRate: number; autoCashout: number | null }>`
  - `cashOut(userId: string, roundId: string): Promise<CrashOutcome>` where `CrashOutcome = { status: "CASHED_OUT" | "BUSTED"; cashoutMultiplier: number | null; crashPoint: number; serverSeed: string; payout: bigint }`
  - `CrashError` (extends `Error`) with subclasses `NoActiveRoundError`, `RoundNotFoundError`, `InvalidStakeError`.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `tests/crash/rounds.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { assertConservation, findBalanceDrift } from "@/lib/wallet/reconcile"
import { placeBet, cashOut, InvalidStakeError } from "@/lib/crash/rounds"
import { crashTimeMs } from "@/lib/crash/math"

async function avail(u: string) {
  const id = await getUserAccountId(u, "AVAILABLE")
  return (await prisma.account.findUniqueOrThrow({ where: { id } })).balance
}
async function setCrash(roundId: string, hundredths: number) {
  await prisma.crashRound.update({ where: { id: roundId }, data: { crashPoint: hundredths } })
}

beforeEach(async () => { await resetDb(); await seedSystemAccounts(); await grantSignupBonus("u1"); vi.useRealTimers() })
afterEach(() => vi.useRealTimers())

describe("crash rounds", () => {
  it("bet escrows the stake", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n)
    expect(await avail("u1")).toBe(before - 100n)
    expect(bet.commitHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects a stake above balance or below MIN_STAKE", async () => {
    await expect(placeBet("u1", 0n)).rejects.toBeInstanceOf(InvalidStakeError)
    await expect(placeBet("u1", 10n ** 9n)).rejects.toBeInstanceOf(InvalidStakeError)
  })

  it("cash-out before the crash pays floor(stake*m/100)", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n)
    await setCrash(bet.roundId, 1000)         // crash far away (10x)
    // 1s elapsed -> ~1.16x
    vi.useFakeTimers()
    vi.setSystemTime(bet.startedAt.getTime() + 1000)
    const out = await cashOut("u1", bet.roundId)
    expect(out.status).toBe("CASHED_OUT")
    expect(out.payout).toBe((100n * BigInt(out.cashoutMultiplier!)) / 100n)
    expect(await avail("u1")).toBe(before - 100n + out.payout)
    expect(out.serverSeed).toMatch(/^[0-9a-f]{64}$/) // revealed
  })

  it("cash-out after the crash busts (loss)", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n)
    await setCrash(bet.roundId, 150)          // crash at 1.50x
    vi.useFakeTimers()
    vi.setSystemTime(bet.startedAt.getTime() + crashTimeMs(150) + 1500)
    const out = await cashOut("u1", bet.roundId)
    expect(out.status).toBe("BUSTED")
    expect(out.payout).toBe(0n)
    expect(await avail("u1")).toBe(before - 100n)
  })

  it("double cash-out is idempotent and conserves chips", async () => {
    const bet = await placeBet("u1", 100n)
    await setCrash(bet.roundId, 1000)
    vi.useFakeTimers(); vi.setSystemTime(bet.startedAt.getTime() + 1000)
    const a = await cashOut("u1", bet.roundId)
    const b = await cashOut("u1", bet.roundId)
    expect(b.status).toBe(a.status)
    expect(b.payout).toBe(a.payout)
    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/crash/rounds.test.ts`
Expected: FAIL — `placeBet`/`cashOut` not defined.

- [ ] **Step 3: Implement bet & cash-out**

Create `src/lib/crash/rounds.ts`:
```ts
import { prisma } from "@/lib/db"
import { escrow, settle } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { deriveRound } from "./fair"
import { multiplierAt, crashTimeMs, payoutFor } from "./math"
import { GROWTH_RATE, MIN_STAKE } from "./config"
import { randomBytes } from "node:crypto"

export class CrashError extends Error {}
export class InvalidStakeError extends CrashError {}
export class RoundNotFoundError extends CrashError {}

export type CrashOutcome = {
  status: "CASHED_OUT" | "BUSTED"
  cashoutMultiplier: number | null
  crashPoint: number
  serverSeed: string
  payout: bigint
}

export async function placeBet(
  userId: string,
  stake: bigint,
  opts: { clientSeed?: string; autoCashout?: number } = {},
): Promise<{ roundId: string; commitHash: string; startedAt: Date; growthRate: number; autoCashout: number | null }> {
  if (stake < MIN_STAKE) throw new InvalidStakeError(`Stake ${stake} below minimum`)
  const availId = await getUserAccountId(userId, "AVAILABLE")
  const balance = (await prisma.account.findUniqueOrThrow({ where: { id: availId } })).balance
  if (stake > balance) throw new InvalidStakeError(`Stake ${stake} exceeds balance ${balance}`)

  const clientSeed = opts.clientSeed ?? randomBytes(8).toString("hex")
  const { serverSeed, commitHash, crashPoint } = deriveRound(clientSeed)

  const round = await prisma.crashRound.create({
    data: {
      userId, stake, clientSeed, serverSeed, commitHash, crashPoint,
      autoCashout: opts.autoCashout ?? null, status: "RUNNING",
    },
  })
  // Escrow AFTER the round row exists so the idempotency key references a real id.
  await escrow(userId, stake, `crash:${round.id}:place`)

  return {
    roundId: round.id,
    commitHash,
    startedAt: round.startedAt,
    growthRate: GROWTH_RATE,
    autoCashout: round.autoCashout,
  }
}

export async function cashOut(userId: string, roundId: string): Promise<CrashOutcome> {
  const round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)

  // Already settled — return the recorded outcome (idempotent).
  if (round.status !== "RUNNING") {
    return {
      status: round.status,
      cashoutMultiplier: round.cashoutMultiplier,
      crashPoint: round.crashPoint,
      serverSeed: round.serverSeed,
      payout: round.payout ?? 0n,
    }
  }

  const elapsed = Date.now() - round.startedAt.getTime()
  const serverMult = multiplierAt(elapsed)
  const busted = serverMult >= round.crashPoint

  const cashoutMultiplier = busted ? null : serverMult
  const payout = busted ? 0n : payoutFor(round.stake, serverMult)

  // Settle exactly once via the round-scoped key; then record game state.
  await settle(userId, round.stake, payout, `crash:${roundId}:settle`)
  const updated = await prisma.crashRound.update({
    where: { id: roundId },
    data: {
      status: busted ? "BUSTED" : "CASHED_OUT",
      cashoutMultiplier, payout, settledAt: new Date(),
    },
  })

  return {
    status: updated.status as "CASHED_OUT" | "BUSTED",
    cashoutMultiplier, crashPoint: round.crashPoint, serverSeed: round.serverSeed, payout,
  }
}
```

Note: `crashTimeMs` is imported for use by Task 4's sweep; keep the import even if unused here would be a lint error, so import it only where used — Task 4 adds its own import. Remove `crashTimeMs` from this file's imports if your linter flags it.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/crash/rounds.test.ts`
Expected: PASS (5). If the double-cash-out test drifts, the settle key is wrong — it must be `crash:{roundId}:settle` on both calls.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crash/rounds.ts tests/crash/rounds.test.ts
git commit -m "feat(crash): round service — bet escrow and server-authoritative cash-out"
```

---

## Task 4: Round service — status poll, auto-cashout, sweep, history, verify

**Files:**
- Modify: `src/lib/crash/rounds.ts`
- Test: `tests/crash/sweep.test.ts`

**Interfaces:**
- Consumes: everything from Task 3; `crashTimeMs` (Task 1).
- Produces (added to `rounds.ts`):
  - `getRoundStatus(userId: string, roundId: string): Promise<{ status: CrashStatus; serverMultiplier: number | null; crashPoint: number | null; serverSeed: string | null; cashoutMultiplier: number | null; payout: bigint | null }>` — lazily resolves expired/auto rounds first.
  - `resolveExpiredRounds(): Promise<number>` — busts every RUNNING round past its crash time (or auto-resolves auto-cashout wins); returns count resolved.
  - `getHistory(userId: string, limit?: number): Promise<CrashRound[]>`
  - `getVerify(userId: string, roundId: string): Promise<{ clientSeed: string; serverSeed: string; commitHash: string; crashPoint: number } | null>` (null while still RUNNING)

- [ ] **Step 1: Write the failing sweep/auto tests**

Create `tests/crash/sweep.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { findBalanceDrift } from "@/lib/wallet/reconcile"
import { placeBet, getRoundStatus, resolveExpiredRounds } from "@/lib/crash/rounds"
import { crashTimeMs } from "@/lib/crash/math"

async function avail(u: string) {
  const id = await getUserAccountId(u, "AVAILABLE")
  return (await prisma.account.findUniqueOrThrow({ where: { id } })).balance
}

beforeEach(async () => { await resetDb(); await seedSystemAccounts(); await grantSignupBonus("u1") })
afterEach(() => vi.useRealTimers())

describe("crash sweep & status", () => {
  it("status poll reveals nothing while running", async () => {
    const bet = await placeBet("u1", 100n)
    await prisma.crashRound.update({ where: { id: bet.roundId }, data: { crashPoint: 1000 } })
    vi.useFakeTimers(); vi.setSystemTime(bet.startedAt.getTime() + 500)
    const s = await getRoundStatus("u1", bet.roundId)
    expect(s.status).toBe("RUNNING")
    expect(s.serverMultiplier).toBeGreaterThan(100)
    expect(s.crashPoint).toBeNull()      // hidden
    expect(s.serverSeed).toBeNull()      // hidden
  })

  it("abandoned round is swept to a loss, releasing escrow", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n)
    await prisma.crashRound.update({ where: { id: bet.roundId }, data: { crashPoint: 150 } })
    vi.useFakeTimers(); vi.setSystemTime(bet.startedAt.getTime() + crashTimeMs(150) + 5000)
    const n = await resolveExpiredRounds()
    expect(n).toBe(1)
    const s = await getRoundStatus("u1", bet.roundId)
    expect(s.status).toBe("BUSTED")
    expect(s.crashPoint).toBe(150)       // revealed after settle
    expect(await avail("u1")).toBe(before - 100n)
    expect(await findBalanceDrift()).toEqual([])
  })

  it("auto-cashout wins deterministically when target < crash point", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n, { autoCashout: 180 }) // 1.80x target
    await prisma.crashRound.update({ where: { id: bet.roundId }, data: { crashPoint: 500 } })
    vi.useFakeTimers(); vi.setSystemTime(bet.startedAt.getTime() + crashTimeMs(180) + 200)
    await resolveExpiredRounds()
    const s = await getRoundStatus("u1", bet.roundId)
    expect(s.status).toBe("CASHED_OUT")
    expect(s.cashoutMultiplier).toBe(180)
    expect(await avail("u1")).toBe(before - 100n + 180n)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/crash/sweep.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement status, sweep, history, verify**

Append to `src/lib/crash/rounds.ts` (add `crashTimeMs` to the `./math` import, and `CrashRound`/`CrashStatus` types to the `@prisma/client` import):
```ts
import type { CrashRound, CrashStatus } from "@prisma/client"
// ensure math import includes crashTimeMs: import { multiplierAt, crashTimeMs, payoutFor } from "./math"

/** Settle a running round given the multiplier it should resolve at (win) or bust. */
async function settleRound(round: CrashRound, cashoutMultiplier: number | null): Promise<void> {
  const busted = cashoutMultiplier === null
  const payout = busted ? 0n : payoutFor(round.stake, cashoutMultiplier)
  await settle(round.userId, round.stake, payout, `crash:${round.id}:settle`)
  await prisma.crashRound.update({
    where: { id: round.id },
    data: { status: busted ? "BUSTED" : "CASHED_OUT", cashoutMultiplier, payout, settledAt: new Date() },
  })
}

/** Decide the resolution of a running round given elapsed server time; null if not yet resolvable. */
function autoResolution(round: CrashRound, now: number): number | null | "running" {
  const elapsed = now - round.startedAt.getTime()
  const serverMult = multiplierAt(elapsed)
  const crashReached = serverMult >= round.crashPoint
  const target = round.autoCashout
  if (target != null && target <= round.crashPoint && serverMult >= target) return target // auto win
  if (crashReached) return null // bust
  return "running"
}

export async function resolveExpiredRounds(): Promise<number> {
  const running = await prisma.crashRound.findMany({ where: { status: "RUNNING" } })
  const now = Date.now()
  let resolved = 0
  for (const round of running) {
    const r = autoResolution(round, now)
    if (r === "running") continue
    await settleRound(round, r)
    resolved++
  }
  return resolved
}

export async function getRoundStatus(userId: string, roundId: string) {
  let round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)
  if (round.status === "RUNNING") {
    const r = autoResolution(round, Date.now())
    if (r !== "running") { await settleRound(round, r); round = await prisma.crashRound.findUniqueOrThrow({ where: { id: roundId } }) }
  }
  const settled = round.status !== "RUNNING"
  return {
    status: round.status,
    serverMultiplier: settled ? null : multiplierAt(Date.now() - round.startedAt.getTime()),
    crashPoint: settled ? round.crashPoint : null,
    serverSeed: settled ? round.serverSeed : null,
    cashoutMultiplier: round.cashoutMultiplier,
    payout: round.payout,
  }
}

export async function getHistory(userId: string, limit = 20): Promise<CrashRound[]> {
  return prisma.crashRound.findMany({
    where: { userId, status: { not: "RUNNING" } },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(1, limit), 100),
  })
}

export async function getVerify(userId: string, roundId: string) {
  const round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)
  if (round.status === "RUNNING") return null
  return { clientSeed: round.clientSeed, serverSeed: round.serverSeed, commitHash: round.commitHash, crashPoint: round.crashPoint }
}
```

Also update `cashOut` (Task 3) to reuse `settleRound` if convenient, but leaving it as-is is fine — both settle with the same `crash:{roundId}:settle` key, so a race between `cashOut` and `resolveExpiredRounds` settles exactly once.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/crash/sweep.test.ts tests/crash/rounds.test.ts`
Expected: PASS (all). If a cash-out and a sweep disagree, confirm both use the `crash:{roundId}:settle` key so the wallet dedupes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crash/rounds.ts tests/crash/sweep.test.ts
git commit -m "feat(crash): status poll, auto-cashout, expired-round sweep, history, verify"
```

---

## Task 5: Dev auth — signed session + routes

**Files:**
- Create: `src/lib/session.ts`, `app/api/auth/dev-login/route.ts`, `app/api/auth/logout/route.ts`
- Modify: `src/lib/auth.ts`
- Create: `.env.local` addition (`SESSION_SECRET`)
- Test: `tests/auth/dev-auth.test.ts`

**Interfaces:**
- Consumes: `onUserCreated` (Phase 0).
- Produces:
  - `session.ts`: `signSession(userId: string): string`; `verifySession(cookieValue: string | undefined): string | null`.
  - `auth.ts`: `requireUserId(req: Request)` now also accepts the signed `session` cookie when `NODE_ENV !== "production"`.

- [ ] **Step 1: Write the failing session/auth tests**

Create `tests/auth/dev-auth.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { signSession, verifySession } from "@/lib/session"
import { requireUserId } from "@/lib/auth"

const OLD = { ...process.env }
beforeEach(() => { process.env.SESSION_SECRET = "test-secret"; delete process.env.TEST_AUTH })
afterEach(() => { process.env = { ...OLD } })

function reqWithCookie(v: string): Request {
  return new Request("http://test/api/wallet", { headers: { cookie: `session=${v}` } })
}

describe("dev session", () => {
  it("round-trips a signed session", () => {
    const token = signSession("alice")
    expect(verifySession(token)).toBe("alice")
  })

  it("rejects a tampered token", () => {
    const token = signSession("alice")
    expect(verifySession(token.replace("alice", "bob"))).toBeNull()
    expect(verifySession("garbage")).toBeNull()
    expect(verifySession(undefined)).toBeNull()
  })

  it("requireUserId accepts the cookie in dev", async () => {
    process.env.NODE_ENV = "development"
    const uid = await requireUserId(reqWithCookie(signSession("alice")))
    expect(uid).toBe("alice")
  })

  it("fails closed in production", async () => {
    process.env.NODE_ENV = "production"
    await expect(requireUserId(reqWithCookie(signSession("alice")))).rejects.toBeInstanceOf(Response)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/auth/dev-auth.test.ts`
Expected: FAIL — `session` module missing.

- [ ] **Step 3: Implement the signed session**

Create `src/lib/session.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto"

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error("SESSION_SECRET not set")
  return s
}

export function signSession(userId: string): string {
  const body = Buffer.from(userId, "utf8").toString("base64url")
  const sig = createHmac("sha256", secret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifySession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null
  const [body, sig] = cookieValue.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret()).update(body).digest("base64url")
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return Buffer.from(body, "base64url").toString("utf8")
}
```

- [ ] **Step 4: Extend `requireUserId` in `src/lib/auth.ts`**

Replace the file with:
```ts
import { verifySession } from "@/lib/session"

/** Resolve the authenticated user id, or throw a 401 Response. */
export async function requireUserId(req: Request): Promise<string> {
  // Test path (Phase 0): explicit header, dev/test only.
  if (process.env.TEST_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const u = req.headers.get("x-test-user")
    if (u) return u
  }
  // Dev login: signed session cookie, never honored in production.
  if (process.env.NODE_ENV !== "production") {
    const cookie = req.headers.get("cookie") ?? ""
    const match = /(?:^|;\s*)session=([^;]+)/.exec(cookie)
    const uid = verifySession(match?.[1])
    if (uid) return uid
  }
  throw new Response("Unauthorized", { status: 401 })
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- tests/auth/dev-auth.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Implement the dev-login/logout routes**

Create `app/api/auth/dev-login/route.ts`:
```ts
import { signSession } from "@/lib/session"
import { onUserCreated } from "@/lib/wallet/onSignup"

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Disabled", { status: 403 })
  const { username } = await req.json().catch(() => ({}))
  if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(username)) {
    return Response.json({ ok: false, error: "invalid_username" }, { status: 422 })
  }
  await onUserCreated(username)
  const token = signSession(username)
  return new Response(JSON.stringify({ ok: true, userId: username }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    },
  })
}
```

Create `app/api/auth/logout/route.ts`:
```ts
export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "session=; Path=/; HttpOnly; Max-Age=0" },
  })
}
```

- [ ] **Step 7: Add `SESSION_SECRET` to env files**

Append to `.env` and `.env.test`:
```
SESSION_SECRET="dev-only-change-me"
```

- [ ] **Step 8: Run the full auth + wallet suite**

Run: `TEST_AUTH=1 npm test -- tests/auth/dev-auth.test.ts tests/api/wallet.test.ts`
Expected: PASS (existing wallet API tests still green with the extended `requireUserId`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/session.ts src/lib/auth.ts app/api/auth tests/auth .env .env.test
git commit -m "feat(auth): signed dev-login session, fails closed in production"
```

---

## Task 6: Crash API routes

**Files:**
- Create: `app/api/crash/bet/route.ts`, `app/api/crash/cashout/route.ts`, `app/api/crash/round/[id]/route.ts`, `app/api/crash/history/route.ts`, `app/api/crash/verify/[id]/route.ts`
- Test: `tests/api/crash.test.ts`

**Interfaces:**
- Consumes: `placeBet`/`cashOut`/`getRoundStatus`/`getHistory`/`getVerify` (Tasks 3–4), `requireUserId` (Task 5), `chips` serialize helper (Phase 0).
- Produces: HTTP routes returning JSON with chip amounts as strings and multipliers as integer hundredths.

- [ ] **Step 1: Write the failing route tests**

Create `tests/api/crash.test.ts`:
```ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { POST as betRoute } from "@/../app/api/crash/bet/route"
import { GET as roundRoute } from "@/../app/api/crash/round/[id]/route"

beforeAll(() => { process.env.TEST_AUTH = "1" })
beforeEach(async () => { await resetDb(); await seedSystemAccounts(); await grantSignupBonus("alice") })

function post(path: string, body: unknown, user?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { method: "POST", headers, body: JSON.stringify(body) })
}
function get(path: string, user?: string): Request {
  const headers: Record<string, string> = {}
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { headers })
}

describe("crash API", () => {
  it("401s betting without a session", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100" }))
    expect(res.status).toBe(401)
  })

  it("bet returns a commit hash but never the crash point", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commitHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.crashPoint).toBeUndefined()
    expect(body.serverSeed).toBeUndefined()
  })

  it("round status hides crash point while running", async () => {
    const bet = await (await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))).json()
    const res = await roundRoute(get(`/api/crash/round/${bet.roundId}`, "alice"), { params: Promise.resolve({ id: bet.roundId }) })
    const body = await res.json()
    expect(body.status).toBe("RUNNING")
    expect(body.crashPoint).toBeNull()
  })

  it("rejects an oversized stake with 422", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "999999999" }, "alice"))
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_AUTH=1 npm test -- tests/api/crash.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement the bet route**

Create `app/api/crash/bet/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { placeBet, InvalidStakeError } from "@/lib/crash/rounds"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const body = await req.json().catch(() => ({}))
  let stake: bigint
  try { stake = BigInt(body.stake) } catch { return Response.json({ ok: false, error: "bad_stake" }, { status: 422 }) }
  const autoCashout = typeof body.autoCashout === "number" ? Math.floor(body.autoCashout) : undefined
  const clientSeed = typeof body.clientSeed === "string" ? body.clientSeed : undefined
  try {
    const bet = await placeBet(userId, stake, { autoCashout, clientSeed })
    return Response.json({
      ok: true, roundId: bet.roundId, commitHash: bet.commitHash,
      startedAt: bet.startedAt.toISOString(), growthRate: bet.growthRate, autoCashout: bet.autoCashout,
    })
  } catch (e) {
    if (e instanceof InvalidStakeError) return Response.json({ ok: false, error: "invalid_stake" }, { status: 422 })
    throw e
  }
}
```

- [ ] **Step 4: Implement the cashout route**

Create `app/api/crash/cashout/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { cashOut, RoundNotFoundError } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { roundId } = await req.json().catch(() => ({}))
  if (!roundId) return Response.json({ ok: false, error: "missing_round" }, { status: 422 })
  try {
    const out = await cashOut(userId, roundId)
    return Response.json({
      ok: true, status: out.status, cashoutMultiplier: out.cashoutMultiplier,
      crashPoint: out.crashPoint, serverSeed: out.serverSeed, payout: chips(out.payout),
    })
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ ok: false, error: "not_found" }, { status: 404 })
    throw e
  }
}
```

- [ ] **Step 5: Implement the round-status route**

Create `app/api/crash/round/[id]/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { getRoundStatus, RoundNotFoundError } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { id } = await ctx.params
  try {
    const s = await getRoundStatus(userId, id)
    return Response.json({
      status: s.status, serverMultiplier: s.serverMultiplier, crashPoint: s.crashPoint,
      serverSeed: s.serverSeed, cashoutMultiplier: s.cashoutMultiplier,
      payout: s.payout == null ? null : chips(s.payout),
    })
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ error: "not_found" }, { status: 404 })
    throw e
  }
}
```

- [ ] **Step 6: Implement the history + verify routes**

Create `app/api/crash/history/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { getHistory } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20)
  const rows = await getHistory(userId, Number.isFinite(limit) ? limit : 20)
  return Response.json({
    items: rows.map((r) => ({
      id: r.id, stake: chips(r.stake), status: r.status, crashPoint: r.crashPoint,
      cashoutMultiplier: r.cashoutMultiplier, payout: r.payout == null ? null : chips(r.payout),
      startedAt: r.startedAt.toISOString(),
    })),
  })
}
```

Create `app/api/crash/verify/[id]/route.ts`:
```ts
import { requireUserId } from "@/lib/auth"
import { getVerify, RoundNotFoundError } from "@/lib/crash/rounds"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { id } = await ctx.params
  try {
    const v = await getVerify(userId, id)
    if (!v) return Response.json({ error: "not_settled" }, { status: 409 })
    return Response.json(v)
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ error: "not_found" }, { status: 404 })
    throw e
  }
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `TEST_AUTH=1 npm test -- tests/api/crash.test.ts`
Expected: PASS (4). Then full suite: `TEST_AUTH=1 npm test` → all green.

- [ ] **Step 8: Commit**

```bash
git add app/api/crash tests/api/crash.test.ts
git commit -m "feat(crash): bet/cashout/round/history/verify API routes"
```

---

## Task 7: Tailwind + Cyber-Arcade theme + app shell

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.mjs`
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `components/NavRail.tsx`, `components/WalletChip.tsx`, `lib/client/api.ts`
- Test: manual visual check + `npm run build`

**Interfaces:**
- Produces: Tailwind configured with Cyber-Arcade tokens; `NavRail` (Play/History/Fairness + Daily-bonus + logout), `WalletChip` (balance), `api` client helpers (`bet`, `cashout`, `roundStatus`, `history`, `walletBalance`, `claimDaily`, `devLogin`).

- [ ] **Step 1: Install Tailwind**

Run: `npm install -D tailwindcss @tailwindcss/postcss postcss`
(Next 16 uses the Tailwind v4 PostCSS plugin.)

- [ ] **Step 2: Configure PostCSS + tokens**

Create `postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } }
```

Replace `app/globals.css` with the Cyber-Arcade tokens (values from `docs/DESIGN-crash-cyber-arcade.md`):
```css
@import "tailwindcss";

@theme {
  --color-bg: #0b0e11;
  --color-surface: #111417;
  --color-surface-2: #171b20;
  --color-line: rgba(255,255,255,0.08);
  --color-rise: #24e39b;
  --color-bust: #ff4c5e;
  --color-gold: #ffc24b;
  --color-text: #eaf1f8;
  --color-muted: #7e8da1;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

:root { color-scheme: dark; }
body { background: var(--color-bg); color: var(--color-text); }
```

- [ ] **Step 3: Set up the root layout**

Replace `app/layout.tsx`:
```tsx
import "./globals.css"
import type { ReactNode } from "react"

export const metadata = { title: "test-bet · Crash", description: "Play-money Crash" }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Client API helpers**

Create `lib/client/api.ts`:
```ts
async function j<T>(res: Response): Promise<T> { if (!res.ok && res.status >= 500) throw new Error(await res.text()); return res.json() }

export const api = {
  devLogin: (username: string) => fetch("/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) }).then(j),
  walletBalance: () => fetch("/api/wallet").then(j) as Promise<{ available: string; escrow: string }>,
  claimDaily: () => fetch("/api/wallet/daily-bonus", { method: "POST" }).then(j),
  bet: (stake: string, autoCashout?: number) => fetch("/api/crash/bet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stake, autoCashout }) }).then(j) as Promise<{ ok: boolean; roundId: string; commitHash: string; startedAt: string; growthRate: number; autoCashout: number | null; error?: string }>,
  cashout: (roundId: string) => fetch("/api/crash/cashout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roundId }) }).then(j) as Promise<{ status: string; cashoutMultiplier: number | null; crashPoint: number; serverSeed: string; payout: string }>,
  roundStatus: (id: string) => fetch(`/api/crash/round/${id}`).then(j) as Promise<{ status: string; serverMultiplier: number | null; crashPoint: number | null; serverSeed: string | null; cashoutMultiplier: number | null; payout: string | null }>,
  history: () => fetch("/api/crash/history").then(j) as Promise<{ items: Array<{ id: string; stake: string; status: string; crashPoint: number; cashoutMultiplier: number | null; payout: string | null; startedAt: string }> }>,
}
```

- [ ] **Step 5: Build the NavRail + WalletChip**

Create `components/WalletChip.tsx`:
```tsx
export function WalletChip({ balance }: { balance: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-sm font-semibold">
      <span>🪙</span>
      <span className="font-mono tabular-nums text-gold">{Number(balance).toLocaleString()}</span>
    </div>
  )
}
```

Create `components/NavRail.tsx`:
```tsx
"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

const items = [
  { href: "/play", label: "Play", icon: "🚀" },
  { href: "/history", label: "History", icon: "🕑" },
  { href: "/fairness", label: "Fairness", icon: "🛡️" },
]

export function NavRail({ onDailyBonus }: { onDailyBonus?: () => void }) {
  const path = usePathname()
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface p-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-rise text-black">🚀</span>
        <div><b className="tracking-widest text-sm">TEST-BET</b><div className="text-xs text-muted">Arcade Node</div></div>
      </div>
      {items.map((it) => (
        <Link key={it.href} href={it.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ${path === it.href ? "bg-rise/15 text-rise" : "text-muted hover:text-text"}`}>
          <span>{it.icon}</span>{it.label}
        </Link>
      ))}
      <button onClick={onDailyBonus} className="mt-auto rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm font-bold text-gold">🎁 Daily bonus</button>
    </aside>
  )
}
```

- [ ] **Step 6: Verify the build compiles with Tailwind**

Run: `npm run build`
Expected: build succeeds; Tailwind classes compile. (If Next 16 flags the app dir, confirm `app/globals.css` is imported in `app/layout.tsx`.)

- [ ] **Step 7: Commit**

```bash
git add tailwind.config.ts postcss.config.mjs app/globals.css app/layout.tsx components/NavRail.tsx components/WalletChip.tsx lib/client/api.ts package.json
git commit -m "feat(ui): Tailwind Cyber-Arcade theme, nav rail, wallet chip, api client"
```

---

## Task 8: Login + Play (the Crash screen)

**Files:**
- Create: `app/login/page.tsx`, `app/play/page.tsx`, `components/PlayClient.tsx`, `components/CrashStage.tsx`, `components/MultiplierReadout.tsx`, `components/BetPanel.tsx`, `components/RecentRounds.tsx`
- Test: manual (drive the flow) + `npm run build`

**Interfaces:**
- Consumes: `api` (Task 7), `NavRail`/`WalletChip` (Task 7), `multiplierAt`-equivalent growth on the client (recompute from `growthRate` + `startedAt`).
- Produces: a working `/login` → `/play` flow: bet, live-animated multiplier, cash-out or bust, recent rounds.

- [ ] **Step 1: Build the login page**

Create `app/login/page.tsx`:
```tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/../lib/client/api"

export default function Login() {
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const r = await api.devLogin(username.trim())
    if ((r as { ok: boolean }).ok) router.push("/play"); else setBusy(false)
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form onSubmit={go} className="w-80 rounded-2xl border border-line bg-surface p-7">
        <div className="mb-1 text-center text-2xl font-extrabold tracking-widest">🚀 CRASH</div>
        <p className="mb-6 text-center text-sm text-muted">Enter a username to play with free chips.</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" pattern="[a-zA-Z0-9_-]{1,32}" required
          className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-3 font-mono outline-none focus:border-rise" />
        <button disabled={busy} className="w-full rounded-lg bg-rise py-3 font-bold text-black disabled:opacity-50">{busy ? "…" : "Play"}</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 2: Build the multiplier readout + crash stage (canvas)**

Create `components/MultiplierReadout.tsx`:
```tsx
export function MultiplierReadout({ hundredths, busted, hint }: { hundredths: number; busted: boolean; hint?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div className={`font-mono text-7xl font-bold tabular-nums ${busted ? "text-bust" : "text-rise"}`}
        style={{ textShadow: busted ? "0 0 34px rgba(255,76,94,.5)" : "0 0 34px rgba(36,227,155,.45)" }}>
        {(hundredths / 100).toFixed(2)}×
      </div>
      {hint && <div className="mt-3 rounded-full border border-line bg-white/5 px-3 py-1 text-sm">{hint}</div>}
    </div>
  )
}
```

Create `components/CrashStage.tsx`:
```tsx
"use client"
import { useEffect, useRef } from "react"

/** Draws the rising curve up to `hundredths`; turns red when busted. Cosmetic only. */
export function CrashStage({ hundredths, busted }: { hundredths: number; busted: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!
    const dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr
    const W = cv.width, H = cv.height, padB = 40 * dpr
    ctx.clearRect(0, 0, W, H)
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = dpr
    for (let i = 1; i < 5; i++) { const y = (H / 5) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    const x = hundredths / 100
    const topM = Math.max(2.2, x * 1.1)
    const k = Math.log(x) || 0.0001
    const steps = 100
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) {
      const f = i / steps, mm = Math.exp(k * f)
      const xx = f * W, yy = H - padB - ((mm - 1) / (topM - 1)) * (H - padB - 20 * dpr)
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy)
    }
    ctx.strokeStyle = busted ? "#ff4c5e" : "#24e39b"; ctx.lineWidth = 3.5 * dpr; ctx.lineJoin = "round"
    ctx.shadowColor = busted ? "rgba(255,76,94,.6)" : "rgba(36,227,155,.55)"; ctx.shadowBlur = 16 * dpr
    ctx.stroke()
  }, [hundredths, busted])
  return <canvas ref={ref} className="h-[340px] w-full" />
}
```

- [ ] **Step 3: Build the bet panel + recent rounds**

Create `components/BetPanel.tsx`:
```tsx
"use client"
export function BetPanel({ stake, setStake, auto, setAuto, live, mult, onBet, onCashout, disabled }:{
  stake: string; setStake: (s: string) => void; auto: number | null; setAuto: (n: number | null) => void;
  live: boolean; mult: number; onBet: () => void; onCashout: () => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">Bet amount</label>
        <div className="flex h-13 items-center overflow-hidden rounded-xl border border-line bg-bg">
          <button onClick={() => setStake(String(Math.max(1, Math.floor(Number(stake) / 2))))} className="w-11 text-muted">−</button>
          <input value={stake} onChange={(e) => setStake(e.target.value.replace(/\D/g, ""))} className="min-w-0 flex-1 bg-transparent text-center font-mono text-xl font-bold outline-none" />
          <button onClick={() => setStake(String(Number(stake) * 2))} className="w-11 text-muted">+</button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={auto != null} onChange={(e) => setAuto(e.target.checked ? 200 : null)} />
          Auto cash out at
          <input disabled={auto == null} value={auto ? (auto / 100).toFixed(2) : ""} onChange={(e) => setAuto(Math.round(Number(e.target.value) * 100))}
            className="w-16 rounded bg-bg px-2 py-1 font-mono disabled:opacity-40" />×
        </label>
      </div>
      {live
        ? <button onClick={onCashout} className="flex h-27 min-w-48 flex-col items-center justify-center rounded-2xl bg-gold font-extrabold text-black">CASH OUT<span className="font-mono text-sm">{(mult / 100).toFixed(2)}×</span></button>
        : <button onClick={onBet} disabled={disabled} className="flex h-27 min-w-48 items-center justify-center rounded-2xl bg-rise font-extrabold text-black disabled:opacity-50">BET</button>}
    </div>
  )
}
```

Create `components/RecentRounds.tsx`:
```tsx
export function RecentRounds({ rounds }: { rounds: Array<{ id: string; status: string; crashPoint: number; payout: string | null; stake: string }> }) {
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-muted">Recent rounds</div>
      <div className="p-3">
        {rounds.length === 0 && <div className="px-1 py-2 text-sm text-muted">No rounds yet.</div>}
        {rounds.map((r) => {
          const win = r.status === "CASHED_OUT"
          return (
            <div key={r.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/5 py-2 last:border-0">
              <span className={`rounded px-2 py-1 font-mono text-sm font-bold ${win ? "bg-rise/15 text-rise" : "bg-bust/15 text-bust"}`}>{(r.crashPoint / 100).toFixed(2)}×</span>
              <span className="text-xs text-muted">{win ? "cashed out" : "busted"}</span>
              <span className={`font-mono text-sm font-bold ${win ? "text-rise" : "text-muted"}`}>{win ? "+" + r.payout : "−" + r.stake}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build the Play client controller**

Create `components/PlayClient.tsx`:
```tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { api } from "@/../lib/client/api"
import { NavRail } from "@/components/NavRail"
import { WalletChip } from "@/components/WalletChip"
import { CrashStage } from "@/components/CrashStage"
import { MultiplierReadout } from "@/components/MultiplierReadout"
import { BetPanel } from "@/components/BetPanel"
import { RecentRounds } from "@/components/RecentRounds"

type Round = { id: string; status: string; crashPoint: number; payout: string | null; stake: string }

export function PlayClient() {
  const [balance, setBalance] = useState("0")
  const [stake, setStake] = useState("100")
  const [auto, setAuto] = useState<number | null>(null)
  const [mult, setMult] = useState(100)
  const [live, setLive] = useState(false)
  const [busted, setBusted] = useState(false)
  const [rounds, setRounds] = useState<Round[]>([])
  const round = useRef<{ id: string; startedAt: number; growthRate: number } | null>(null)
  const raf = useRef(0); const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() { setBalance((await api.walletBalance()).available); setRounds((await api.history()).items as Round[]) }
  useEffect(() => { refresh() }, [])

  function stop() { cancelAnimationFrame(raf.current); if (poll.current) clearInterval(poll.current); poll.current = null }

  async function onBet() {
    setBusted(false)
    const r = await api.bet(stake, auto ?? undefined)
    if (!r.ok) { await refresh(); return }
    round.current = { id: r.roundId, startedAt: new Date(r.startedAt).getTime(), growthRate: r.growthRate }
    setLive(true); setBalance((b) => String(Number(b) - Number(stake)))
    const tick = () => {
      const el = Date.now() - round.current!.startedAt
      setMult(Math.max(100, Math.floor(Math.exp(round.current!.growthRate * (el / 1000)) * 100)))
      raf.current = requestAnimationFrame(tick)
    }
    tick()
    poll.current = setInterval(async () => {
      const s = await api.roundStatus(round.current!.id)
      if (s.status !== "RUNNING") { stop(); setBusted(s.status === "BUSTED"); if (s.crashPoint) setMult(s.crashPoint); setLive(false); setTimeout(refresh, 400) }
    }, 300)
  }

  async function onCashout() {
    if (!round.current) return
    const out = await api.cashout(round.current.id)
    stop(); setLive(false)
    if (out.status === "BUSTED") { setBusted(true); setMult(out.crashPoint) } else setMult(out.cashoutMultiplier ?? mult)
    setTimeout(refresh, 300)
  }

  return (
    <div className="flex min-h-screen">
      <NavRail onDailyBonus={async () => { await api.claimDaily(); refresh() }} />
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <b className="tracking-widest text-lg">CRASH</b>
          <WalletChip balance={balance} />
        </div>
        <div className="grid grid-cols-[1.7fr_1fr] gap-4 max-[860px]:grid-cols-1">
          <div className="flex flex-col gap-4">
            <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
              <CrashStage hundredths={mult} busted={busted} />
              <MultiplierReadout hundredths={mult} busted={busted}
                hint={live ? `Cash out to win ${Math.floor(Number(stake) * mult / 100).toLocaleString()} 🪙` : busted ? "Round over · seed revealed" : "Place a bet"} />
            </div>
            <BetPanel stake={stake} setStake={setStake} auto={auto} setAuto={setAuto} live={live} mult={mult} onBet={onBet} onCashout={onCashout} disabled={Number(stake) < 1} />
          </div>
          <RecentRounds rounds={rounds} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the Play page**

Create `app/play/page.tsx`:
```tsx
import { PlayClient } from "@/components/PlayClient"
export default function Play() { return <PlayClient /> }
```

- [ ] **Step 6: Verify build + drive the flow**

Run: `npm run build` → expect success.
Then manually: `SESSION_SECRET=dev TEST_AUTH= npm run dev`, open `/login`, enter a username, place a bet, watch it rise, cash out, confirm the balance and Recent Rounds update, and that a "let it ride" bet busts.

- [ ] **Step 7: Commit**

```bash
git add app/login app/play components lib
git commit -m "feat(ui): login + Crash play screen with live multiplier, bet, cash-out"
```

---

## Task 9: History + Fairness pages

**Files:**
- Create: `app/history/page.tsx`, `app/fairness/page.tsx`, `components/FairnessCard.tsx`
- Test: manual + `npm run build`

**Interfaces:**
- Consumes: `api.history` (Task 7), `getVerify` route (Task 6), `NavRail` (Task 7).
- Produces: a history table and a fairness/verify view.

- [ ] **Step 1: Build the FairnessCard**

Create `components/FairnessCard.tsx`:
```tsx
"use client"
import { useState } from "react"

export function FairnessCard({ roundId }: { roundId?: string }) {
  const [data, setData] = useState<{ clientSeed: string; serverSeed: string; commitHash: string; crashPoint: number } | null>(null)
  async function verify() {
    if (!roundId) return
    const res = await fetch(`/api/crash/verify/${roundId}`)
    if (res.ok) setData(await res.json())
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 text-xs font-extrabold uppercase tracking-wider text-muted">Provably fair</div>
      <p className="mb-3 text-sm text-muted">Each round commits <span className="font-mono">sha256(serverSeed)</span> before you bet; the seed is revealed after so you can re-derive the crash point.</p>
      <button onClick={verify} className="w-full rounded-lg border border-rise/30 bg-rise/10 py-2 text-sm font-bold text-rise">🔍 Verify last round</button>
      {data && (
        <dl className="mt-3 space-y-1 font-mono text-xs text-muted">
          <div>commit: <span className="break-all text-text">{data.commitHash}</span></div>
          <div>seed: <span className="break-all text-text">{data.serverSeed}</span></div>
          <div>client: <span className="text-text">{data.clientSeed}</span></div>
          <div>crash: <span className="text-rise">{(data.crashPoint / 100).toFixed(2)}×</span></div>
        </dl>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build the History page**

Create `app/history/page.tsx`:
```tsx
"use client"
import { useEffect, useState } from "react"
import { api } from "@/../lib/client/api"
import { NavRail } from "@/components/NavRail"

export default function History() {
  const [items, setItems] = useState<Array<{ id: string; stake: string; status: string; crashPoint: number; payout: string | null; startedAt: string }>>([])
  useEffect(() => { api.history().then((r) => setItems(r.items)) }, [])
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="flex-1 p-6">
        <h1 className="mb-4 text-lg font-bold tracking-widest">HISTORY</h1>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr className="[&>th]:px-4 [&>th]:py-3"><th>When</th><th>Stake</th><th>Result</th><th>Crash</th><th>Payout</th></tr></thead>
            <tbody className="font-mono tabular-nums">
              {items.map((r) => (
                <tr key={r.id} className="border-t border-line [&>td]:px-4 [&>td]:py-2">
                  <td className="text-muted">{new Date(r.startedAt).toLocaleTimeString()}</td>
                  <td>{r.stake}</td>
                  <td className={r.status === "CASHED_OUT" ? "text-rise" : "text-bust"}>{r.status === "CASHED_OUT" ? "won" : "busted"}</td>
                  <td>{(r.crashPoint / 100).toFixed(2)}×</td>
                  <td className={r.payout && r.payout !== "0" ? "text-rise" : "text-muted"}>{r.payout ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build the Fairness page**

Create `app/fairness/page.tsx`:
```tsx
"use client"
import { useEffect, useState } from "react"
import { api } from "@/../lib/client/api"
import { NavRail } from "@/components/NavRail"
import { FairnessCard } from "@/components/FairnessCard"

export default function Fairness() {
  const [lastId, setLastId] = useState<string | undefined>()
  useEffect(() => { api.history().then((r) => setLastId(r.items[0]?.id)) }, [])
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="flex-1 p-6">
        <h1 className="mb-4 text-lg font-bold tracking-widest">FAIRNESS</h1>
        <div className="max-w-md"><FairnessCard roundId={lastId} /></div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify build + full test suite**

Run: `npm run build` → success.
Run: `TEST_AUTH=1 npm test` → all backend tests still green (UI adds no server tests but must not break the suite or the build).

- [ ] **Step 5: Commit**

```bash
git add app/history app/fairness components/FairnessCard.tsx
git commit -m "feat(ui): history table and provably-fair verify pages"
```

---

## Self-Review Notes

**Spec coverage:**
- Section 1 (game model, cheat-proofing, sweep, single-active-round) → Tasks 2–4, 6.
- Section 2 (provably-fair math, growth, house edge, payout) → Task 1.
- Section 3 (CrashRound data model, lifecycle, wallet keys) → Tasks 2–4.
- Section 4 (dev auth, fails closed in prod) → Task 5.
- Section 5 (UI, Cyber-Arcade, closed-economy adjustments, pages, components, client game logic) → Tasks 7–9.
- Section 6 (API surface) → Tasks 5–6.
- Section 7 (testing: math, lifecycle, server authority, dev auth, routes) → Tasks 1, 3, 4, 5, 6.

**Server authority** is asserted in Tasks 3 (cash-out uses `Date.now()` vs `startedAt`, tested with fake timers) and 6 (crash point absent until settled). **Idempotency/no-drift** asserted in Tasks 3–4 (`assertConservation` + `findBalanceDrift`).

**Known deliberate choices (not gaps):**
- `resolveExpiredRounds()` is invoked lazily from `getRoundStatus` and by `placeBet` before a new bet; a scheduled cron is a later ops task (the function is tested standalone).
- UI has no automated tests by design (spec §7) — correctness lives in tested server code; UI tasks gate on `npm run build` + a manual drive.

**Type consistency:** multipliers are integer hundredths across every layer (`crashPoint`, `cashoutMultiplier`, `serverMultiplier`, `autoCashout`, client `mult`); chips are `bigint` server-side and strings over HTTP via `chips()`; `crash:{roundId}:place` / `crash:{roundId}:settle` keys are identical in `placeBet`, `cashOut`, and `settleRound`.
