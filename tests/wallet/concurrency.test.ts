import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, escrow, autoTopUp, claimDailyBonus } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { findBalanceDrift } from "@/lib/wallet/reconcile"
import { STARTING_CHIPS, TOP_UP_TARGET } from "@/lib/wallet/config"
import { DailyBonusCooldownError } from "@/lib/wallet/errors"

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

    const availId = await getUserAccountId("u1", "AVAILABLE")
    const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
    expect(avail.balance >= 0n).toBe(true)
    expect(await findBalanceDrift()).toEqual([])
  })

  it("autoTopUp grants exactly once under concurrent calls on a broke wallet", async () => {
    await grantSignupBonus("u1")
    const availId = await getUserAccountId("u1", "AVAILABLE")
    await escrow("u1", STARTING_CHIPS, "drain:1") // AVAILABLE is now 0

    const attempts = 10
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => autoTopUp("u1")),
    )
    const granted = results.filter(
      (r) => r.status === "fulfilled" && r.value !== null,
    ).length

    expect(granted).toBe(1) // exactly one call actually funded the wallet

    const avail = await prisma.account.findUniqueOrThrow({ where: { id: availId } })
    expect(avail.balance).toBe(TOP_UP_TARGET)
    expect(await findBalanceDrift()).toEqual([])
  })

  it("claimDailyBonus grants exactly once under concurrent claims on a fresh wallet", async () => {
    await grantSignupBonus("u1")

    const attempts = 5
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => claimDailyBonus("u1")),
    )
    const granted = results.filter((r) => r.status === "fulfilled").length
    const cooldownRejections = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof DailyBonusCooldownError,
    ).length

    expect(granted).toBe(1)
    expect(cooldownRejections).toBe(attempts - 1)
    expect(await findBalanceDrift()).toEqual([])
  })
})
