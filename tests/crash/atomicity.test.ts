import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import * as walletOps from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { InsufficientBalanceError } from "@/lib/wallet/errors"
import { assertConservation, findBalanceDrift } from "@/lib/wallet/reconcile"
import {
  placeBet, resolveExpiredRounds,
  InvalidStakeError, InvalidAutoCashoutError,
} from "@/lib/crash/rounds"
import { crashTimeMs } from "@/lib/crash/math"

async function avail(u: string) {
  const id = await getUserAccountId(u, "AVAILABLE")
  return (await prisma.account.findUniqueOrThrow({ where: { id } })).balance
}
async function runningRounds(u: string) {
  return prisma.crashRound.findMany({ where: { userId: u, status: "RUNNING" } })
}

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
  await grantSignupBonus("u1")
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe("FIX I-1: placeBet atomicity", () => {
  it("compensates a failed escrow: no leftover round, InvalidStakeError, user not locked out", async () => {
    const before = await avail("u1")

    // Force the escrow leg to fail as if a concurrent drain made the
    // pre-check stale and the ledger's atomic balance guard rejected it.
    const spy = vi.spyOn(walletOps, "escrow").mockRejectedValueOnce(
      new InsufficientBalanceError("acct", 0n, 100n),
    )

    await expect(placeBet("u1", 100n)).rejects.toBeInstanceOf(InvalidStakeError)

    // Nothing persisted: no RUNNING round, balance untouched.
    expect(await runningRounds("u1")).toEqual([])
    expect(await avail("u1")).toBe(before)

    spy.mockRestore()

    // Not locked out by one_running_round_per_user — a normal bet succeeds.
    const bet = await placeBet("u1", 100n)
    expect(bet.roundId).toBeTruthy()
    expect(await avail("u1")).toBe(before - 100n)

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })

  it("orphan cleanup: a RUNNING round with no place transaction is deleted by the sweep, not settled", async () => {
    const before = await avail("u1")

    // Simulate the failure mode I-1 describes: a round row exists but the
    // escrow leg never ran (no `crash:{id}:place` Transaction).
    const orphan = await prisma.crashRound.create({
      data: {
        userId: "u1", stake: 100n, clientSeed: "c", serverSeed: "s",
        commitHash: "h", crashPoint: 9999, status: "RUNNING",
      },
    })
    const placeTx = await prisma.transaction.findUnique({ where: { idempotencyKey: `crash:${orphan.id}:place` } })
    expect(placeTx).toBeNull()

    const n = await resolveExpiredRounds()
    expect(n).toBe(0) // nothing was actually settled — the orphan was deleted, not resolved

    expect(await prisma.crashRound.findUnique({ where: { id: orphan.id } })).toBeNull()
    expect(await avail("u1")).toBe(before) // no chips were ever locked for the orphan

    // The one_running_round_per_user index no longer blocks this user.
    const bet = await placeBet("u1", 50n)
    expect(bet.roundId).toBeTruthy()

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })

  it("resolveExpiredRounds settles valid rounds even when an orphan round is present", async () => {
    const before = await avail("u1")

    // A real, properly-escrowed bet that should resolve to a bust.
    const bet = await placeBet("u1", 100n)
    await prisma.crashRound.update({ where: { id: bet.roundId }, data: { crashPoint: 150 } })

    // An orphan for a different user sitting alongside it (no escrow, no
    // wallet accounts needed — it must be cleaned up, not settled).
    const orphan = await prisma.crashRound.create({
      data: {
        userId: "u2", stake: 100n, clientSeed: "c", serverSeed: "s",
        commitHash: "h", crashPoint: 9999, status: "RUNNING",
      },
    })

    vi.useFakeTimers()
    vi.setSystemTime(bet.startedAt.getTime() + crashTimeMs(150) + 5000)

    const n = await resolveExpiredRounds()
    expect(n).toBe(1) // only the real round counts as "settled"

    const settled = await prisma.crashRound.findUniqueOrThrow({ where: { id: bet.roundId } })
    expect(settled.status).toBe("BUSTED")
    expect(await prisma.crashRound.findUnique({ where: { id: orphan.id } })).toBeNull()
    expect(await avail("u1")).toBe(before - 100n)

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })

  it("one failing round in the sweep does not abort resolution of the others", async () => {
    // A valid round that should bust.
    const bet1 = await placeBet("u1", 100n)
    await prisma.crashRound.update({ where: { id: bet1.roundId }, data: { crashPoint: 150 } })

    // A "poisoned" round for another user: RUNNING, past its crash point,
    // WITH a place transaction (so it's not treated as an orphan) but its
    // ESCROW account has since been drained to 0, so settle() will throw
    // InsufficientBalanceError when the sweep tries to debit it.
    await grantSignupBonus("u2")
    const escId = await getUserAccountId("u2", "ESCROW")
    const bet2Round = await prisma.crashRound.create({
      data: {
        userId: "u2", stake: 100n, clientSeed: "c", serverSeed: "s",
        commitHash: "h", crashPoint: 150, status: "RUNNING",
      },
    })
    await prisma.transaction.create({
      data: { type: "ESCROW", idempotencyKey: `crash:${bet2Round.id}:place`, metadata: {} },
    })
    // ESCROW account balance left at 0 (never actually credited) — settling
    // this round would attempt to debit ESCROW below 0 and throw.
    void escId

    vi.useFakeTimers()
    vi.setSystemTime(bet1.startedAt.getTime() + crashTimeMs(150) + 5000)

    const n = await resolveExpiredRounds()
    expect(n).toBe(1) // bet1 resolved despite bet2's poisoned settle attempt

    const settled1 = await prisma.crashRound.findUniqueOrThrow({ where: { id: bet1.roundId } })
    expect(settled1.status).toBe("BUSTED")

    // The poisoned round is left RUNNING (untouched) — it didn't abort the loop.
    const stillRunning2 = await prisma.crashRound.findUniqueOrThrow({ where: { id: bet2Round.id } })
    expect(stillRunning2.status).toBe("RUNNING")
  })
})

describe("FIX I-2: autoCashout validation", () => {
  it("rejects a negative autoCashout", async () => {
    await expect(placeBet("u1", 100n, { autoCashout: -100 })).rejects.toBeInstanceOf(InvalidAutoCashoutError)
    expect(await runningRounds("u1")).toEqual([])
  })

  it("rejects an autoCashout below 100 (below break-even)", async () => {
    await expect(placeBet("u1", 100n, { autoCashout: 50 })).rejects.toBeInstanceOf(InvalidAutoCashoutError)
    expect(await runningRounds("u1")).toEqual([])
  })

  it("rejects a non-integer autoCashout", async () => {
    await expect(placeBet("u1", 100n, { autoCashout: 150.5 })).rejects.toBeInstanceOf(InvalidAutoCashoutError)
  })

  it("rejects an autoCashout above the max", async () => {
    await expect(placeBet("u1", 100n, { autoCashout: 1_000_001 })).rejects.toBeInstanceOf(InvalidAutoCashoutError)
  })

  it("accepts a valid autoCashout", async () => {
    const bet = await placeBet("u1", 100n, { autoCashout: 200 })
    expect(bet.autoCashout).toBe(200)
  })
})
