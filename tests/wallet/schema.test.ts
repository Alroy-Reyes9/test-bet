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
    const faucet = await prisma.account.findFirstOrThrow({ where: { type: "FAUCET" } })
    const updated = await prisma.account.update({ where: { id: faucet.id }, data: { balance: -500n } })
    expect(updated.balance).toBe(-500n)
  })

  it("permits only one FAUCET system account", async () => {
    await expect(prisma.account.create({ data: { type: "FAUCET" } })).rejects.toThrow()
  })
})
