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
