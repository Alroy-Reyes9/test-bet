import { requireUserId } from "@/lib/auth"
import { claimDailyBonus } from "@/lib/wallet/operations"
import { DailyBonusCooldownError } from "@/lib/wallet/errors"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  try {
    const txn = await claimDailyBonus(userId)
    return Response.json({ ok: true, transactionId: txn.id })
  } catch (e) {
    if (e instanceof DailyBonusCooldownError) {
      return Response.json(
        { ok: false, resetAt: e.resetAt.toISOString() },
        { status: 429 },
      )
    }
    throw e
  }
}
