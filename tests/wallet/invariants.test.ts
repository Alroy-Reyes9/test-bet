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
