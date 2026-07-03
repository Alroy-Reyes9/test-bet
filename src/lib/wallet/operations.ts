import { Transaction } from "@prisma/client"
import { prisma } from "@/lib/db"
import { postTransaction, PostingInput } from "./ledger"
import { getUserAccountId, getSystemAccountId } from "./accounts"
import { AlreadyFundedError, DailyBonusCooldownError } from "./errors"
import {
  STARTING_CHIPS, DAILY_BONUS, TOP_UP_TARGET, DAILY_COOLDOWN_MS,
} from "./config"

/** FAUCET → user's AVAILABLE. Idempotent by a fixed per-user key. */
export async function grantSignupBonus(userId: string): Promise<Transaction> {
  const faucet = await getSystemAccountId("FAUCET")
  const avail = await getUserAccountId(userId, "AVAILABLE")
  return postTransaction({
    type: "SIGNUP",
    idempotencyKey: `signup:${userId}`,
    metadata: { userId },
    postings: [
      { accountId: faucet, amount: -STARTING_CHIPS },
      { accountId: avail, amount: STARTING_CHIPS },
    ],
  })
}

/**
 * FAUCET → AVAILABLE, enforcing a true rolling 24h cooldown.
 *
 * The cooldown is enforced by a post-lock guard (not the idempotency key):
 * under the AVAILABLE-account lock, the guard looks up the user's most
 * recent DAILY_BONUS transaction and rejects if it was created less than
 * DAILY_COOLDOWN_MS ago. The lock serializes concurrent claims so exactly
 * one wins. The idempotency key is unique per attempt (includes Date.now())
 * since it no longer carries the once-per-window semantics.
 */
export async function claimDailyBonus(userId: string): Promise<Transaction> {
  const faucet = await getSystemAccountId("FAUCET")
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const now = Date.now()
  return postTransaction({
    type: "DAILY_BONUS",
    idempotencyKey: `daily:${userId}:${now}:${Math.random().toString(36).slice(2)}`,
    metadata: { userId },
    postings: [
      { accountId: faucet, amount: -DAILY_BONUS },
      { accountId: avail, amount: DAILY_BONUS },
    ],
    guard: async ({ tx }) => {
      const last = await tx.transaction.findFirst({
        where: { type: "DAILY_BONUS", postings: { some: { account: { userId } } } },
        orderBy: { createdAt: "desc" },
      })
      if (last && now - last.createdAt.getTime() < DAILY_COOLDOWN_MS) {
        return new DailyBonusCooldownError(
          new Date(last.createdAt.getTime() + DAILY_COOLDOWN_MS),
        )
      }
      return null
    },
  })
}

/**
 * FAUCET → AVAILABLE to reach TOP_UP_TARGET, only when AVAILABLE is 0.
 *
 * Exactly-once via a post-lock guard: under the AVAILABLE-account lock, the
 * guard re-reads the committed balance and aborts (AlreadyFundedError) if
 * it's already > 0. This makes N concurrent/rapid calls on a broke wallet
 * grant exactly once.
 *
 * The idempotency key is unique per call attempt (not wall-clock-bucketed):
 * a shared bucket key would let the ledger's own idempotency short-circuit
 * (which runs BEFORE the lock/guard) hand back a stale non-null transaction
 * to a caller whose wallet is already funded, defeating the guard. Making
 * the guard the sole arbiter is what makes "returns null once funded" hold
 * for every caller, not just the ones outside the previous request's bucket.
 */
export async function autoTopUp(userId: string): Promise<Transaction | null> {
  const availId = await getUserAccountId(userId, "AVAILABLE")
  const faucet = await getSystemAccountId("FAUCET")
  try {
    return await postTransaction({
      type: "TOP_UP",
      idempotencyKey: `topup:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      metadata: { userId },
      postings: [
        { accountId: faucet, amount: -TOP_UP_TARGET },
        { accountId: availId, amount: TOP_UP_TARGET },
      ],
      guard: async ({ balances }) => {
        const row = balances.get(availId)
        if (row && row.balance > 0n) return new AlreadyFundedError()
        return null
      },
    })
  } catch (e) {
    if (e instanceof AlreadyFundedError) return null
    throw e
  }
}

/** AVAILABLE → ESCROW. */
export async function escrow(userId: string, amount: bigint, key: string): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  return postTransaction({
    type: "ESCROW",
    idempotencyKey: key,
    metadata: { userId, amount: amount.toString() },
    postings: [
      { accountId: avail, amount: -amount },
      { accountId: esc, amount: amount },
    ],
  })
}

/** ESCROW → AVAILABLE (payout) / HOUSE (net). Zero-amount legs are dropped. */
export async function settle(
  userId: string, stake: bigint, payout: bigint, key: string,
): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  const house = await getSystemAccountId("HOUSE")
  const houseNet = stake - payout // >0 on a loss, <0 on a win, 0 on a push
  const postings: PostingInput[] = [{ accountId: esc, amount: -stake }]
  if (payout !== 0n) postings.push({ accountId: avail, amount: payout })
  if (houseNet !== 0n) postings.push({ accountId: house, amount: houseNet })
  return postTransaction({
    type: "SETTLE",
    idempotencyKey: key,
    metadata: { userId, stake: stake.toString(), payout: payout.toString() },
    postings,
  })
}

/** ESCROW → AVAILABLE. */
export async function refund(userId: string, amount: bigint, key: string): Promise<Transaction> {
  const avail = await getUserAccountId(userId, "AVAILABLE")
  const esc = await getUserAccountId(userId, "ESCROW")
  return postTransaction({
    type: "REFUND",
    idempotencyKey: key,
    metadata: { userId, amount: amount.toString() },
    postings: [
      { accountId: esc, amount: -amount },
      { accountId: avail, amount: amount },
    ],
  })
}
