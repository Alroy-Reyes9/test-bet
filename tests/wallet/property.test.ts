import { describe, it, expect, beforeEach } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, escrow, settle, refund } from "@/lib/wallet/operations"
import { assertConservation, findBalanceDrift } from "@/lib/wallet/reconcile"
import { prisma } from "@/lib/db"
import { getUserAccountId } from "@/lib/wallet/accounts"

// Deterministic PRNG (seeded) so the fuzz run is reproducible — no Math.random.
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

describe("property: invariants hold under random valid sequences", () => {
  it("stays conserved and drift-free over many random operations", async () => {
    const rng = makeRng(42)
    const users = ["a", "b", "c"]
    for (const u of users) await grantSignupBonus(u)

    // Track open bets per user so we only settle/refund real escrow.
    const open: Record<string, { id: number; stake: bigint }[]> = { a: [], b: [], c: [] }
    let seq = 0

    for (let i = 0; i < 300; i++) {
      const u = users[Math.floor(rng() * users.length)]
      const roll = rng()
      if (roll < 0.5) {
        // place a bet for a random affordable stake
        const availId = await getUserAccountId(u, "AVAILABLE")
        const avail = (await prisma.account.findUniqueOrThrow({ where: { id: availId } })).balance
        if (avail <= 0n) continue
        const stake = BigInt(1 + Math.floor(rng() * Number(avail > 500n ? 500n : avail)))
        const id = seq++
        await escrow(u, stake, `f:${u}:${id}:place`)
        open[u].push({ id, stake })
      } else if (open[u].length > 0) {
        const bet = open[u].pop()!
        if (roll < 0.75) {
          // settle win/loss: payout in [0, 2*stake]
          const payout = BigInt(Math.floor(rng() * Number(2n * bet.stake + 1n)))
          await settle(u, bet.stake, payout, `f:${u}:${bet.id}:settle`)
        } else {
          await refund(u, bet.stake, `f:${u}:${bet.id}:refund`)
        }
      }
    }

    await expect(assertConservation()).resolves.toBeUndefined()
    expect(await findBalanceDrift()).toEqual([])
  })
})
