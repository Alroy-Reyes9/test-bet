"use client"
import { useEffect, useState } from "react"
import { api } from "@/lib/client/api"
import { NavRail } from "@/components/NavRail"

export default function History() {
  const [items, setItems] = useState<Array<{ id: string; stake: string; status: string; crashPoint: number; payout: string | null; startedAt: string }>>([])
  useEffect(() => { api.history().then((r) => setItems(r.items)) }, [])
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="flex-1 p-6">
        <h1 className="mb-4 text-lg font-bold tracking-widest">HISTORY</h1>
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr className="[&>th]:px-4 [&>th]:py-3"><th>When</th><th>Stake</th><th>Result</th><th>Crash</th><th>Payout</th></tr></thead>
            <tbody className="font-mono tabular-nums">
              {items.map((r) => (
                <tr key={r.id} className="border-t border-line [&>td]:px-4 [&>td]:py-2">
                  <td className="text-muted">{new Date(r.startedAt).toLocaleTimeString()}</td>
                  <td>{r.stake}</td>
                  <td className={r.status === "CASHED_OUT" ? "text-rise" : "text-bust"}>{r.status === "CASHED_OUT" ? "won" : "busted"}</td>
                  <td>{(r.crashPoint / 100).toFixed(2)}×</td>
                  <td className={r.payout && r.payout !== "0" ? "text-rise" : "text-muted"}>{r.payout ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
