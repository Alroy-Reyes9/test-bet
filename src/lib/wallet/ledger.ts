import { Prisma, Transaction, TransactionType } from "@prisma/client"
import { prisma } from "@/lib/db"
import { InsufficientBalanceError, LedgerImbalanceError, WalletError } from "./errors"

export type PostingInput = { accountId: string; amount: bigint }

export type LockedBalance = { id: string; type: string; balance: bigint }

export type PostTransactionGuardCtx = {
  tx: Prisma.TransactionClient
  balances: Map<string, LockedBalance>
}

export type PostTransactionInput = {
  type: TransactionType
  idempotencyKey: string
  metadata?: Prisma.InputJsonValue
  postings: PostingInput[]
  /**
   * Optional hook invoked INSIDE the transaction, after the involved account
   * rows are locked (`FOR UPDATE`) and the balances map is built, but before
   * the Transaction/postings are created. Return a WalletError to abort and
   * roll back the whole transaction; return null to proceed. When omitted,
   * behavior is identical to not having a guard at all.
   */
  guard?: (ctx: PostTransactionGuardCtx) => Promise<WalletError | null>
}

export async function postTransaction(input: PostTransactionInput): Promise<Transaction> {
  const { type, idempotencyKey, metadata, postings, guard } = input

  const sum = postings.reduce((acc, p) => acc + p.amount, 0n)
  if (sum !== 0n || postings.length < 2) {
    throw new LedgerImbalanceError(idempotencyKey, sum)
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey } })
      if (existing) return existing

      // Lock the involved account rows in a deterministic order (deadlock-safe).
      const accountIds = [...new Set(postings.map((p) => p.accountId))].sort()
      const locked = await tx.$queryRaw<{ id: string; type: string; balance: bigint }[]>(
        Prisma.sql`SELECT id, type, balance FROM "Account" WHERE id IN (${Prisma.join(
          accountIds,
        )}) ORDER BY id FOR UPDATE`,
      )
      const rows = new Map(locked.map((a) => [a.id, a]))

      if (guard) {
        const guardError = await guard({ tx, balances: rows })
        if (guardError) throw guardError
      }

      // Net delta per account.
      const deltas = new Map<string, bigint>()
      for (const p of postings) deltas.set(p.accountId, (deltas.get(p.accountId) ?? 0n) + p.amount)

      const created = await tx.transaction.create({
        data: { type, idempotencyKey, metadata: metadata ?? Prisma.JsonNull },
      })

      for (const [accountId, delta] of deltas) {
        const row = rows.get(accountId)
        if (!row) throw new Error(`Account ${accountId} missing or unlocked`)
        const next = row.balance + delta
        if ((row.type === "AVAILABLE" || row.type === "ESCROW") && next < 0n) {
          throw new InsufficientBalanceError(accountId, row.balance, -delta)
        }
        await tx.account.update({ where: { id: accountId }, data: { balance: next } })
      }

      await tx.posting.createMany({
        data: postings.map((p) => ({
          transactionId: created.id,
          accountId: p.accountId,
          amount: p.amount,
        })),
      })

      return created
    })
  } catch (e) {
    // Idempotency race: a concurrent caller inserted the same key first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } })
      if (existing) return existing
    }
    throw e
  }
}
