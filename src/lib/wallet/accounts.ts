import { prisma } from "@/lib/db"

export async function ensureUserAccounts(userId: string): Promise<void> {
  await prisma.account.createMany({
    data: [
      { userId, type: "AVAILABLE" },
      { userId, type: "ESCROW" },
    ],
    skipDuplicates: true,
  })
}

export async function getUserAccountId(
  userId: string,
  type: "AVAILABLE" | "ESCROW",
): Promise<string> {
  await ensureUserAccounts(userId)
  const acct = await prisma.account.findUniqueOrThrow({
    where: { userId_type: { userId, type } },
  })
  return acct.id
}

export async function getSystemAccountId(type: "FAUCET" | "HOUSE"): Promise<string> {
  const acct = await prisma.account.findFirstOrThrow({ where: { type, userId: null } })
  return acct.id
}
