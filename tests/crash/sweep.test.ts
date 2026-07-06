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
