import { prisma } from "@/lib/db"

/** Wipe all ledger data between tests. Order respects FKs. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE "Posting", "Transaction", "Account", "CrashRound" RESTART IDENTITY CASCADE`)
}

/** Create the singleton FAUCET and HOUSE system accounts. */
export async function seedSystemAccounts(): Promise<void> {
  await prisma.account.createMany({
    data: [
      { type: "FAUCET" },
      { type: "HOUSE" },
    ],
    skipDuplicates: true,
  })
}
