"use client"
import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/client/api"

export default function Login() {
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true)
    const r = await api.devLogin(username.trim())
    if ((r as { ok: boolean }).ok) router.push("/play"); else setBusy(false)
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form onSubmit={go} className="w-80 rounded-2xl border border-line bg-surface p-7">
        <div className="mb-1 text-center text-2xl font-extrabold tracking-widest">🚀 CRASH</div>
        <p className="mb-6 text-center text-sm text-muted">Enter a username to play with free chips.</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" pattern="[a-zA-Z0-9_-]{1,32}" required
          className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-3 font-mono outline-none focus:border-rise" />
        <button disabled={busy} className="w-full rounded-lg bg-rise py-3 font-bold text-black disabled:opacity-50">{busy ? "…" : "Play"}</button>
      </form>
    </main>
  )
}
