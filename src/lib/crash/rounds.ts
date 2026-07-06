import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { escrow, settle } from "@/lib/wallet/operations"
import { getUserAccountId } from "@/lib/wallet/accounts"
import { InsufficientBalanceError } from "@/lib/wallet/errors"
import { deriveRound } from "./fair"
import { multiplierAt, crashTimeMs, payoutFor } from "./math"
import { GROWTH_RATE, MIN_STAKE } from "./config"
import { randomBytes } from "node:crypto"
import type { CrashRound, CrashStatus } from "@prisma/client"

export class CrashError extends Error {}
export class InvalidStakeError extends CrashError {}
export class InvalidAutoCashoutError extends CrashError {}
export class AlreadyInRoundError extends CrashError {}
export class RoundNotFoundError extends CrashError {}
export class NoActiveRoundError extends CrashError {}

const MIN_AUTO_CASHOUT = 100
const MAX_AUTO_CASHOUT = 1_000_000

/** Idempotency key used for the escrow leg of a bet; also used to detect orphan rounds. */
function placeKey(roundId: string): string {
  return `crash:${roundId}:place`
}

export type CrashOutcome = {
  status: "CASHED_OUT" | "BUSTED"
  cashoutMultiplier: number | null
  crashPoint: number
  serverSeed: string
  payout: bigint
}

export async function placeBet(
  userId: string,
  stake: bigint,
  opts: { clientSeed?: string; autoCashout?: number } = {},
): Promise<{ roundId: string; commitHash: string; startedAt: Date; growthRate: number; autoCashout: number | null }> {
  if (stake < MIN_STAKE) throw new InvalidStakeError(`Stake ${stake} below minimum`)
  if (opts.autoCashout != null) {
    const a = opts.autoCashout
    if (!Number.isInteger(a) || a < MIN_AUTO_CASHOUT || a > MAX_AUTO_CASHOUT) {
      throw new InvalidAutoCashoutError(`autoCashout ${a} out of range [${MIN_AUTO_CASHOUT}, ${MAX_AUTO_CASHOUT}]`)
    }
  }
  const availId = await getUserAccountId(userId, "AVAILABLE")
  const balance = (await prisma.account.findUniqueOrThrow({ where: { id: availId } })).balance
  if (stake > balance) throw new InvalidStakeError(`Stake ${stake} exceeds balance ${balance}`)

  const clientSeed = opts.clientSeed ?? randomBytes(8).toString("hex")
  const { serverSeed, commitHash, crashPoint } = deriveRound(clientSeed)

  let round: CrashRound
  try {
    round = await prisma.crashRound.create({
      data: {
        userId, stake, clientSeed, serverSeed, commitHash, crashPoint,
        autoCashout: opts.autoCashout ?? null, status: "RUNNING",
      },
    })
  } catch (e) {
    // Concurrent bet raced past the pre-check and lost the
    // one_running_round_per_user unique index (P2002). No chips moved yet
    // (this create happens BEFORE escrow) — clean 409, not a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AlreadyInRoundError(userId)
    }
    throw e
  }

  // Escrow AFTER the round row exists so the idempotency key references a real id.
  try {
    await escrow(userId, stake, placeKey(round.id))
  } catch (e) {
    // Escrow failed (e.g. a concurrent drain made the pre-check stale and the
    // ledger's atomic balance guard rejected the debit). Compensate by
    // deleting the just-created round so nothing persists: no round, no
    // escrow, no orphan, no lockout via the one-running-round-per-user index.
    await prisma.crashRound.delete({ where: { id: round.id } }).catch(() => {})
    if (e instanceof InsufficientBalanceError) {
      throw new InvalidStakeError(`Stake ${stake} exceeds balance at escrow time`)
    }
    throw e
  }

  return {
    roundId: round.id,
    commitHash,
    startedAt: round.startedAt,
    growthRate: GROWTH_RATE,
    autoCashout: round.autoCashout,
  }
}

export async function cashOut(userId: string, roundId: string): Promise<CrashOutcome> {
  const round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)

  // Already settled — return the recorded outcome (idempotent).
  if (round.status !== "RUNNING") {
    return {
      status: round.status as "CASHED_OUT" | "BUSTED",
      cashoutMultiplier: round.cashoutMultiplier,
      crashPoint: round.crashPoint,
      serverSeed: round.serverSeed,
      payout: round.payout ?? 0n,
    }
  }

  const elapsed = Date.now() - round.startedAt.getTime()
  const serverMult = multiplierAt(elapsed)
  const busted = serverMult >= round.crashPoint

  // The auto target is a ceiling on the manual cash-out multiplier too: if the
  // player set one, they've already agreed to stop there. (Bust logic above
  // is unaffected — it still compares the uncapped serverMult to crashPoint.)
  const cashoutMultiplier = busted
    ? null
    : round.autoCashout != null
      ? Math.min(serverMult, round.autoCashout)
      : serverMult
  const payout = busted ? 0n : payoutFor(round.stake, cashoutMultiplier!)

  // Settle exactly once via the round-scoped key; then record game state.
  await settle(userId, round.stake, payout, `crash:${roundId}:settle`)
  const updated = await prisma.crashRound.update({
    where: { id: roundId },
    data: {
      status: busted ? "BUSTED" : "CASHED_OUT",
      cashoutMultiplier, payout, settledAt: new Date(),
    },
  })

  return {
    status: updated.status as "CASHED_OUT" | "BUSTED",
    cashoutMultiplier, crashPoint: round.crashPoint, serverSeed: round.serverSeed, payout,
  }
}

/** Settle a running round given the multiplier it should resolve at (win) or bust. */
async function settleRound(round: CrashRound, cashoutMultiplier: number | null): Promise<void> {
  const busted = cashoutMultiplier === null
  const payout = busted ? 0n : payoutFor(round.stake, cashoutMultiplier)
  await settle(round.userId, round.stake, payout, `crash:${round.id}:settle`)
  await prisma.crashRound.update({
    where: { id: round.id },
    data: { status: busted ? "BUSTED" : "CASHED_OUT", cashoutMultiplier, payout, settledAt: new Date() },
  })
}

/** Decide the resolution of a running round given elapsed server time; null if not yet resolvable. */
function autoResolution(round: CrashRound, now: number): number | null | "running" {
  const elapsed = now - round.startedAt.getTime()
  const serverMult = multiplierAt(elapsed)
  const crashReached = serverMult >= round.crashPoint
  const target = round.autoCashout
  if (target != null && target <= round.crashPoint && serverMult >= target) return target // auto win
  if (crashReached) return null // bust
  return "running"
}

export async function resolveExpiredRounds(): Promise<number> {
  const running = await prisma.crashRound.findMany({ where: { status: "RUNNING" } })
  const now = Date.now()
  let resolved = 0
  for (const round of running) {
    try {
      // Orphan detection: escrow never happened for this round (the create
      // succeeded but a subsequent crash/restart lost the escrow call, or an
      // older bug left one behind). No chips are locked for it — delete it
      // rather than trying to settle, which would debit ESCROW below 0.
      const placeTx = await prisma.transaction.findUnique({ where: { idempotencyKey: placeKey(round.id) } })
      if (!placeTx) {
        await prisma.crashRound.delete({ where: { id: round.id } })
        continue
      }

      const r = autoResolution(round, now)
      if (r === "running") continue
      await settleRound(round, r)
      resolved++
    } catch {
      // One poisoned round must not abort the sweep for everyone else.
      continue
    }
  }
  return resolved
}

export async function getRoundStatus(userId: string, roundId: string) {
  let round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)
  if (round.status === "RUNNING") {
    const r = autoResolution(round, Date.now())
    if (r !== "running") {
      try {
        await settleRound(round, r)
        round = await prisma.crashRound.findUniqueOrThrow({ where: { id: roundId } })
      } catch {
        // Best-effort lazy settle (e.g. an orphan round with no escrow to
        // settle). Return the round as-is (RUNNING); the sweep will clean it.
      }
    }
  }
  const settled = round.status !== "RUNNING"
  return {
    status: round.status,
    serverMultiplier: settled ? null : multiplierAt(Date.now() - round.startedAt.getTime()),
    crashPoint: settled ? round.crashPoint : null,
    serverSeed: settled ? round.serverSeed : null,
    cashoutMultiplier: round.cashoutMultiplier,
    payout: round.payout,
  }
}

export async function getHistory(userId: string, limit = 20): Promise<CrashRound[]> {
  return prisma.crashRound.findMany({
    where: { userId, status: { not: "RUNNING" } },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(1, limit), 100),
  })
}

export async function getVerify(userId: string, roundId: string) {
  const round = await prisma.crashRound.findUnique({ where: { id: roundId } })
  if (!round || round.userId !== userId) throw new RoundNotFoundError(roundId)
  if (round.status === "RUNNING") return null
  return { clientSeed: round.clientSeed, serverSeed: round.serverSeed, commitHash: round.commitHash, crashPoint: round.crashPoint }
}
