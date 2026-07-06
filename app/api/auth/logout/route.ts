export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "session=; Path=/; HttpOnly; Max-Age=0" },
  })
}
