import { requireUserId } from "@/lib/auth"
import { placeBet, InvalidStakeError, InvalidAutoCashoutError, AlreadyInRoundError } from "@/lib/crash/rounds"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const body = await req.json().catch(() => ({}))
  let stake: bigint
  try { stake = BigInt(body.stake) } catch { return Response.json({ ok: false, error: "bad_stake" }, { status: 422 }) }
  // Only pass through a genuinely valid integer — never silently coerce a
  // fractional/non-numeric value into one; let placeBet's validation (or the
  // "no auto cashout" default) handle anything else.
  const autoCashout = typeof body.autoCashout === "number" && Number.isInteger(body.autoCashout)
    ? body.autoCashout
    : undefined
  const clientSeed = typeof body.clientSeed === "string" ? body.clientSeed : undefined
  try {
    const bet = await placeBet(userId, stake, { autoCashout, clientSeed })
    return Response.json({
      ok: true, roundId: bet.roundId, commitHash: bet.commitHash,
      startedAt: bet.startedAt.toISOString(), growthRate: bet.growthRate, autoCashout: bet.autoCashout,
    })
  } catch (e) {
    if (e instanceof InvalidAutoCashoutError) return Response.json({ ok: false, error: "invalid_auto_cashout" }, { status: 422 })
    if (e instanceof InvalidStakeError) return Response.json({ ok: false, error: "invalid_stake" }, { status: 422 })
    if (e instanceof AlreadyInRoundError) return Response.json({ ok: false, error: "already_in_round" }, { status: 409 })
    throw e
  }
}
