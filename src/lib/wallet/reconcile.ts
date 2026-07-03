import { prisma } from "@/lib/db"

export async function assertConservation(): Promise<void> {
  // Postgres SUM(bigint) yields NUMERIC, which the pg driver parses as a
  // Decimal object rather than bigint — cast explicitly so comparisons below
  // are against a real bigint (see task-5-report.md for the empirical repro).
  const [{ sum }] = await prisma.$queryRaw<{ sum: bigint | null }[]>`
    SELECT COALESCE(SUM(amount), 0)::bigint AS sum FROM "Posting"
  `
  if ((sum ?? 0n) !== 0n) throw new Error(`Ledger not conserved: total = ${sum}`)
}

export async function findBalanceDrift(): Promise<
  { accountId: string; cached: bigint; ledger: bigint }[]
> {
  const rows = await prisma.$queryRaw<{ accountId: string; cached: bigint; ledger: bigint }[]>`
    SELECT a.id AS "accountId", a.balance AS cached,
           COALESCE(SUM(p.amount), 0)::bigint AS ledger
    FROM "Account" a
    LEFT JOIN "Posting" p ON p."accountId" = a.id
    GROUP BY a.id, a.balance
    HAVING a.balance <> COALESCE(SUM(p.amount), 0)
  `
  return rows
}
