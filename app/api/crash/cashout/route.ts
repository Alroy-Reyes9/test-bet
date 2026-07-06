import { requireUserId } from "@/lib/auth"
import { cashOut, RoundNotFoundError } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { roundId } = await req.json().catch(() => ({}))
  if (!roundId) return Response.json({ ok: false, error: "missing_round" }, { status: 422 })
  try {
    const out = await cashOut(userId, roundId)
    return Response.json({
      ok: true, status: out.status, cashoutMultiplier: out.cashoutMultiplier,
      crashPoint: out.crashPoint, serverSeed: out.serverSeed, payout: chips(out.payout),
    })
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ ok: false, error: "not_found" }, { status: 404 })
    throw e
  }
}
