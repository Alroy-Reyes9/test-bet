import { describe, it, expect } from "vitest"
import { prisma } from "@/lib/db"

describe("harness", () => {
  it("connects to a real Postgres", async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
    expect(rows[0].ok).toBe(1)
  })
})
