import { signSession } from "@/lib/session"
import { onUserCreated } from "@/lib/wallet/onSignup"

export async function POST(req: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Disabled", { status: 403 })
  const { username } = await req.json().catch(() => ({}))
  if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(username)) {
    return Response.json({ ok: false, error: "invalid_username" }, { status: 422 })
  }
  await onUserCreated(username)
  const token = signSession(username)
  return new Response(JSON.stringify({ ok: true, userId: username }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    },
  })
}
