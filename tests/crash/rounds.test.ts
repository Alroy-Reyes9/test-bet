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

  it("FIX M-4: manual cash-out is capped at the auto target when the server multiplier has run past it", async () => {
    const before = await avail("u1")
    const bet = await placeBet("u1", 100n, { autoCashout: 180 }) // 1.80x target
    await setCrash(bet.roundId, 1000)          // crash far away — this cash-out is a genuine win, not a bust
    vi.useFakeTimers()
    // Let the server multiplier run well past the 1.80x auto target (~3x+).
    vi.setSystemTime(bet.startedAt.getTime() + crashTimeMs(300) + 200)
    const out = await cashOut("u1", bet.roundId)
    expect(out.status).toBe("CASHED_OUT")
    expect(out.cashoutMultiplier).toBe(180) // capped at the auto target, not the (higher) server multiplier
    expect(out.payout).toBe(180n) // floor(100 * 180 / 100)
    expect(await avail("u1")).toBe(before - 100n + 180n)
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
