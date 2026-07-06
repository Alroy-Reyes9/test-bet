import { requireUserId } from "@/lib/auth"
import { getVerify, RoundNotFoundError } from "@/lib/crash/rounds"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const { id } = await ctx.params
  try {
    const v = await getVerify(userId, id)
    if (!v) return Response.json({ error: "not_settled" }, { status: 409 })
    return Response.json(v)
  } catch (e) {
    if (e instanceof RoundNotFoundError) return Response.json({ error: "not_found" }, { status: 404 })
    throw e
  }
}
