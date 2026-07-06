import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { signSession, verifySession } from "@/lib/session"
import { requireUserId } from "@/lib/auth"

const OLD = { ...process.env }
beforeEach(() => { process.env.SESSION_SECRET = "test-secret"; delete process.env.TEST_AUTH })
afterEach(() => { process.env = { ...OLD } })

function reqWithCookie(v: string): Request {
  return new Request("http://test/api/wallet", { headers: { cookie: `session=${v}` } })
}

describe("dev session", () => {
  it("round-trips a signed session", () => {
    const token = signSession("alice")
    expect(verifySession(token)).toBe("alice")
  })

  it("rejects a tampered token", () => {
    const token = signSession("alice")
    expect(verifySession(token.replace("alice", "bob"))).toBeNull()
    expect(verifySession("garbage")).toBeNull()
    expect(verifySession(undefined)).toBeNull()
  })

  it("requireUserId accepts the cookie in dev", async () => {
    ;(process.env as { NODE_ENV: string }).NODE_ENV = "development"
    const uid = await requireUserId(reqWithCookie(signSession("alice")))
    expect(uid).toBe("alice")
  })

  it("fails closed in production", async () => {
    ;(process.env as { NODE_ENV: string }).NODE_ENV = "production"
    await expect(requireUserId(reqWithCookie(signSession("alice")))).rejects.toBeInstanceOf(Response)
  })
})
