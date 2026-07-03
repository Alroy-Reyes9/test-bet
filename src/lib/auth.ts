// Phase 0: session is resolved from a verified Supabase JWT in production.
// For testability the handler reads the user id from a verified session helper
// that tests can stub via the `x-test-user` header when TEST_AUTH=1.
export async function requireUserId(req: Request): Promise<string> {
  if (process.env.TEST_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const u = req.headers.get("x-test-user")
    if (!u) throw new Response("Unauthorized", { status: 401 })
    return u
  }
  // Production: verify Supabase session cookie here and return its user id.
  // (Wired when Supabase Auth is added; intentionally not stubbed with a fake user.)
  throw new Response("Unauthorized", { status: 401 })
}
