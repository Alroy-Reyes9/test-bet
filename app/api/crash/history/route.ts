import { requireUserId } from "@/lib/auth"
import { getHistory } from "@/lib/crash/rounds"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20)
  const rows = await getHistory(userId, Number.isFinite(limit) ? limit : 20)
  return Response.json({
    items: rows.map((r) => ({
      id: r.id, stake: chips(r.stake), status: r.status, crashPoint: r.crashPoint,
      cashoutMultiplier: r.cashoutMultiplier, payout: r.payout == null ? null : chips(r.payout),
      startedAt: r.startedAt.toISOString(),
    })),
  })
}
