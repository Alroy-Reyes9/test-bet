import { verifySession } from "@/lib/session"

/** Resolve the authenticated user id, or throw a 401 Response. */
export async function requireUserId(req: Request): Promise<string> {
  // Test path (Phase 0): explicit header, dev/test only.
  if (process.env.TEST_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const u = req.headers.get("x-test-user")
    if (u) return u
  }
  // Dev login: signed session cookie, never honored in production.
  if (process.env.NODE_ENV !== "production") {
    const cookie = req.headers.get("cookie") ?? ""
    const match = /(?:^|;\s*)session=([^;]+)/.exec(cookie)
    const uid = verifySession(match?.[1])
    if (uid) return uid
  }
  throw new Response("Unauthorized", { status: 401 })
}
