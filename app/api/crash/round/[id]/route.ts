import { requireUserId } from "@/lib/auth"
import { getRoundStatus, RoundNotFoundError } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { id } = await ctx.params
  try {
    const s = await getRoundStatus(userId, id)
    return Response.json({
      status: s.status, serverMultiplier: s.serverMultiplier, crashPoint: s.crashPoint,
      serverSeed: s.serverSeed, cashoutMultiplier: s.cashoutMultiplier,
      payout: s.payout == null ? null : chips(s.payout),
    })
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ error: "not_found" }, { status: 404 })
    throw e
  }
}
