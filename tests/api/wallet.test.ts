import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { GET as getWallet } from "../../app/api/wallet/route"
import { POST as postDaily } from "../../app/api/wallet/daily-bonus/route"

beforeAll(() => { process.env.TEST_AUTH = "1" })
beforeEach(async () => {
  await resetDb()
  await seedSystemAccounts()
})

function req(path: string, user?: string, method = "GET"): Request {
  const headers: Record<string, string> = {}
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { method, headers })
}

describe("wallet API", () => {
  it("401s without a session", async () => {
    const res = await getWallet(req("/api/wallet"))
    expect(res.status).toBe(401)
  })

  it("returns balances for the authed user", async () => {
    await grantSignupBonus("u1")
    const res = await getWallet(req("/api/wallet", "u1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toBe("5000")
    expect(body.escrow).toBe("0")
  })

  it("claims the daily bonus then 429s the second time", async () => {
    await grantSignupBonus("u1")
    const ok = await postDaily(req("/api/wallet/daily-bonus", "u1", "POST"))
    expect(ok.status).toBe(200)
    const again = await postDaily(req("/api/wallet/daily-bonus", "u1", "POST"))
    expect(again.status).toBe(429)
  })

  it("fails closed in production even if TEST_AUTH leaks into the env", async () => {
    const env = process.env as { NODE_ENV: string }
    const original = env.NODE_ENV
    try {
      env.NODE_ENV = "production"
      await grantSignupBonus("u1")
      const res = await getWallet(req("/api/wallet", "u1"))
      expect(res.status).toBe(401)
    } finally {
      env.NODE_ENV = original
    }
  })
})
