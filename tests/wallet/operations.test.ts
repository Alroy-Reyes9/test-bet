import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import {
  grantSignupBonus, claimDailyBonus, autoTopUp, escrow, settle, refund,
} from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { InsufficientBalanceError, DailyBonusCooldownError } from "@/lib/wallet/errors"
import { STARTING_CHIPS, DAILY_BONUS, TOP_UP_TARGET, DAILY_COOLDOWN_MS } from "@/lib/wallet/config"

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

  it("enforces a true rolling 24h cooldown: a claim 24h+ after the last one succeeds", async () => {
    await grantSignupBonus("u1")
    const first = await claimDailyBonus("u1")
    expect(await available("u1")).toBe(STARTING_CHIPS + DAILY_BONUS)

    // Simulate 24h+ passing by back-dating the last DAILY_BONUS transaction.
    await prisma.transaction.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - (DAILY_COOLDOWN_MS + 1000)) },
    })

    await claimDailyBonus("u1") // should now succeed
    expect(await available("u1")).toBe(STARTING_CHIPS + DAILY_BONUS * 2n)
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
