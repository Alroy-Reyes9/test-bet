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
