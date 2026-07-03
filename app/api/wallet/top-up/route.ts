import { requireUserId } from "@/lib/auth"
import { autoTopUp } from "@/lib/wallet/operations"

export async function POST(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const txn = await autoTopUp(userId)
  if (!txn) return Response.json({ ok: false, reason: "not_broke" }, { status: 422 })
  return Response.json({ ok: true, transactionId: txn.id })
}
