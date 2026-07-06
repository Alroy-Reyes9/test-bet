import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/db"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"

beforeEach(async () => { await resetDb(); await seedSystemAccounts() })

describe("CrashRound schema", () => {
  it("stores a running round with hundredths crash point", async () => {
    const r = await prisma.crashRound.create({
      data: {
        userId: "u1", stake: 100n, clientSeed: "c", serverSeed: "s",
        commitHash: "h", crashPoint: 247, status: "RUNNING",
      },
    })
    expect(r.status).toBe("RUNNING")
    expect(r.crashPoint).toBe(247)
    expect(r.stake).toBe(100n)
  })

  it("permits only one RUNNING round per user", async () => {
    const base = { userId: "u1", stake: 100n, clientSeed: "c", serverSeed: "s", commitHash: "h", crashPoint: 200, status: "RUNNING" as const }
    await prisma.crashRound.create({ data: base })
    await expect(prisma.crashRound.create({ data: base })).rejects.toThrow()
  })
})
