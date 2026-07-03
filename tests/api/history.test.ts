import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus, claimDailyBonus } from "@/lib/wallet/operations"
import { GET as getHistory } from "../../app/api/wallet/history/route"

beforeAll(() => { process.env.TEST_AUTH = "1" })
beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

function req(path: string, user?: string): Request {
  const headers: Record<string, string> = {}
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { headers })
}

describe("wallet history API", () => {
  it("returns a sane page (not a crash) when limit is not a number", async () => {
    await grantSignupBonus("u1")
    await claimDailyBonus("u1")
    const res = await getHistory(req("/api/wallet/history?limit=abc", "u1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(2) // falls back to the default page size (50)
  })

  it("clamps limit=0 to at least 1 (no negative/zero take)", async () => {
    await grantSignupBonus("u1")
    await claimDailyBonus("u1")
    const res = await getHistory(req("/api/wallet/history?limit=0", "u1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1)
  })

  it("clamps limit above 100 down to 100", async () => {
    await grantSignupBonus("u1")
    const res = await getHistory(req("/api/wallet/history?limit=99999", "u1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1) // only 1 txn exists; just proves no crash/overflow
  })
})
