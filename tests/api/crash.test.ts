import { describe, it, expect, beforeEach, beforeAll } from "vitest"
import { resetDb, seedSystemAccounts } from "@/../tests/setup/testDb"
import { grantSignupBonus } from "@/lib/wallet/operations"
import { POST as betRoute } from "@/../app/api/crash/bet/route"
import { GET as roundRoute } from "@/../app/api/crash/round/[id]/route"

beforeAll(() => { process.env.TEST_AUTH = "1" })
beforeEach(async () => { await resetDb(); await seedSystemAccounts(); await grantSignupBonus("alice") })

function post(path: string, body: unknown, user?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { method: "POST", headers, body: JSON.stringify(body) })
}
function get(path: string, user?: string): Request {
  const headers: Record<string, string> = {}
  if (user) headers["x-test-user"] = user
  return new Request(`http://test${path}`, { headers })
}

describe("crash API", () => {
  it("401s betting without a session", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100" }))
    expect(res.status).toBe(401)
  })

  it("bet returns a commit hash but never the crash point", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commitHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.crashPoint).toBeUndefined()
    expect(body.serverSeed).toBeUndefined()
  })

  it("round status hides crash point while running", async () => {
    const bet = await (await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))).json()
    const res = await roundRoute(get(`/api/crash/round/${bet.roundId}`, "alice"), { params: Promise.resolve({ id: bet.roundId }) })
    const body = await res.json()
    expect(body.status).toBe("RUNNING")
    expect(body.crashPoint).toBeNull()
  })

  it("rejects an oversized stake with 422", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "999999999" }, "alice"))
    expect(res.status).toBe(422)
  })

  it("FIX I-2: rejects an out-of-range autoCashout with 422", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100", autoCashout: -100 }, "alice"))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it("FIX I-2: accepts a valid autoCashout", async () => {
    const res = await betRoute(post("/api/crash/bet", { stake: "100", autoCashout: 200 }, "alice"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.autoCashout).toBe(200)
  })

  it("FIX M-6: a second concurrent bet while one is already running gets 409, not 500", async () => {
    const first = await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))
    expect(first.status).toBe(200)
    const second = await betRoute(post("/api/crash/bet", { stake: "100" }, "alice"))
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.ok).toBe(false)
  })
})
