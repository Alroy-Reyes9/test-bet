import { prisma } from "@/lib/db"
import { requireUserId } from "@/lib/auth"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  const url = new URL(req.url)
  const raw = Number(url.searchParams.get("limit") ?? 50)
  const take = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50
  const cursor = url.searchParams.get("cursor") ?? undefined

  const txns = await prisma.transaction.findMany({
    where: { postings: { some: { account: { userId } } } },
    include: { postings: { where: { account: { userId } } } },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const items = txns.slice(0, take).map((t) => ({
    id: t.id,
    type: t.type,
    createdAt: t.createdAt.toISOString(),
    net: chips(t.postings.reduce((s, p) => s + p.amount, 0n)),
  }))
  const nextCursor = txns.length > take ? txns[take - 1].id : null
  return Response.json({ items, nextCursor })
}
