"use client"
import { useState } from "react"

export function FairnessCard({ roundId, activeHash }: { roundId?: string; activeHash?: string }) {
  const [data, setData] = useState<{ clientSeed: string; serverSeed: string; commitHash: string; crashPoint: number } | null>(null)
  async function verify() {
    if (!roundId) return
    const res = await fetch(`/api/crash/verify/${roundId}`)
    if (res.ok) setData(await res.json())
  }
  const hash = activeHash ?? data?.commitHash
  return (
    <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-highest p-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>shield_with_heart</span>
        <h3 className="font-label-mono text-label-mono font-bold uppercase tracking-widest text-on-surface">Provably Fair</h3>
      </div>
      <div className="rounded border border-outline-variant bg-background/50 p-3">
        <p className="font-label-mono mb-1 text-[10px] uppercase text-on-surface-variant">Active Game Hash</p>
        <p className="font-label-mono break-all text-[11px] leading-tight text-on-surface">
          {hash ?? "Place a bet to generate a commit hash."}
        </p>
      </div>
      <button
        type="button"
        onClick={verify}
        disabled={!roundId}
        className="font-label-mono w-full rounded border border-outline-variant bg-surface-container-low py-2 text-xs uppercase transition-all hover:bg-surface-container-high active:scale-95 disabled:opacity-40"
      >
        Verify last round
      </button>
      {data && (
        <dl className="font-label-mono space-y-1 text-xs text-on-surface-variant">
          <div>seed: <span className="break-all text-on-surface">{data.serverSeed}</span></div>
          <div>client: <span className="text-on-surface">{data.clientSeed}</span></div>
          <div>crash: <span className="text-primary">{(data.crashPoint / 100).toFixed(2)}x</span></div>
        </dl>
      )}
    </div>
  )
}
