export function RecentRounds({ rounds }: { rounds: Array<{ id: string; status: string; crashPoint: number; cashoutMultiplier: number | null; payout: string | null; stake: string }> }) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-outline-variant bg-surface-container-high">
      <div className="flex items-center justify-between border-b border-outline-variant p-4">
        <h3 className="font-label-mono text-label-mono font-bold uppercase tracking-widest text-primary">Recent Rounds</h3>
        <span className="material-symbols-outlined text-sm text-on-surface-variant">history</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {rounds.length === 0 && <div className="font-label-mono px-1 py-2 text-sm text-on-surface-variant">No rounds yet.</div>}
        {rounds.map((r) => {
          const win = r.status === "CASHED_OUT"
          // Wins show the multiplier the player locked in (matches the center
          // readout); busts show where the round crashed.
          const shown = win && r.cashoutMultiplier != null ? r.cashoutMultiplier : r.crashPoint
          return (
            <div
              key={r.id}
              className={`flex items-center justify-between rounded border-l-4 bg-surface-container p-3 ${win ? "border-primary" : "border-error"}`}
            >
              <span className="font-label-mono text-sm text-on-surface">#{r.id.slice(0, 7)}</span>
              <span className={`font-label-mono rounded px-3 py-1 font-bold ${win ? "bg-primary/20 text-primary" : "bg-error/20 text-error"}`}>
                {(shown / 100).toFixed(2)}x
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
