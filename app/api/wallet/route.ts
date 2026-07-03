import { prisma } from "@/lib/db"
import { requireUserId } from "@/lib/auth"
import { ensureUserAccounts } from "@/lib/wallet/accounts"
import { chips } from "@/lib/serialize"

export async function GET(req: Request): Promise<Response> {
  let userId: string
  try { userId = await requireUserId(req) } catch (r) { return r as Response }
  await ensureUserAccounts(userId)
  const accts = await prisma.account.findMany({ where: { userId } })
  const available = accts.find((a) => a.type === "AVAILABLE")?.balance ?? 0n
  const escrow = accts.find((a) => a.type === "ESCROW")?.balance ?? 0n
  return Response.json({ available: chips(available), escrow: chips(escrow) })
}
