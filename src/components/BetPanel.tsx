"use client"

const QUICK = [
  { label: "+10", fn: (n: number) => n + 10 },
  { label: "+50", fn: (n: number) => n + 50 },
  { label: "+100", fn: (n: number) => n + 100 },
  { label: "1/2", fn: (n: number) => Math.max(1, Math.floor(n / 2)) },
]

export function BetPanel({ stake, setStake, auto, setAuto, live, mult, balance, onBet, onCashout, disabled }: {
  stake: string; setStake: (s: string) => void; auto: number | null; setAuto: (n: number | null) => void
  live: boolean; mult: number; balance: string; onBet: () => void; onCashout: () => void; disabled: boolean
}) {
  const n = Number(stake) || 0
  return (
    <div className="grid grid-cols-1 gap-6 rounded-xl border border-outline-variant bg-surface-container-low p-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Bet amount */}
      <div className="space-y-3">
        <label className="font-label-mono text-label-mono block uppercase tracking-wider text-on-surface-variant">Bet Amount</label>
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          <button
            type="button"
            onClick={() => setStake(String(Math.max(1, Math.floor(n / 2))))}
            className="flex h-10 w-10 items-center justify-center rounded bg-surface-container-high transition-colors hover:bg-primary hover:text-on-primary"
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          <input
            value={stake}
            inputMode="numeric"
            onChange={(e) => setStake(e.target.value.replace(/\D/g, ""))}
            className="font-label-mono min-w-0 flex-1 border-none bg-transparent text-center text-lg font-bold text-primary outline-none focus:ring-0"
          />
          <button
            type="button"
            onClick={() => setStake(String(n * 2))}
            className="flex h-10 w-10 items-center justify-center rounded bg-surface-container-high transition-colors hover:bg-primary hover:text-on-primary"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => setStake(String(q.fn(n)))}
              className="font-label-mono flex-1 rounded border border-outline-variant bg-surface-container-lowest py-1 text-[12px] transition-all hover:border-primary"
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStake(String(Math.max(1, Math.floor(Number(balance) || 0))))}
            className="font-label-mono flex-1 rounded border border-outline-variant bg-surface-container-lowest py-1 text-[12px] transition-all hover:border-primary"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Auto cash out */}
      <div className="space-y-3">
        <label className="font-label-mono text-label-mono block uppercase tracking-wider text-on-surface-variant">Auto Cash Out</label>
        <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
          <input
            disabled={auto == null}
            value={auto ? (auto / 100).toFixed(2) : ""}
            placeholder="—"
            onChange={(e) => setAuto(Math.round(Number(e.target.value) * 100))}
            className="font-label-mono min-w-0 flex-1 border-none bg-transparent text-center text-lg font-bold text-on-surface outline-none focus:ring-0 disabled:opacity-40"
          />
          <span className="font-label-mono pr-1 text-on-surface-variant">x</span>
          <label className="relative inline-flex cursor-pointer items-center px-3">
            <input type="checkbox" checked={auto != null} onChange={(e) => setAuto(e.target.checked ? 200 : null)} className="peer sr-only" />
            <div className="peer h-6 w-11 rounded-full bg-surface-container-highest transition-all after:absolute after:top-[2px] after:start-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-outline after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full" />
          </label>
        </div>
        <p className="font-label-mono text-[11px] text-on-surface-variant">System will automatically withdraw at this multiplier if reached.</p>
      </div>

      {/* Action */}
      <div className="flex flex-col justify-end">
        {live ? (
          <button
            type="button"
            onClick={onCashout}
            className="font-headline-md text-headline-md flex h-16 w-full flex-col items-center justify-center rounded-lg bg-tertiary-container leading-none text-on-tertiary-container shadow-[4px_4px_0px_0px_rgba(250,190,71,0.3)] transition-all hover:brightness-110 active:translate-x-1 active:translate-y-1"
          >
            <span className="uppercase">Cash Out</span>
            <span className="font-label-mono mt-1 text-sm">{(mult / 100).toFixed(2)}x</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onBet}
            disabled={disabled}
            className="font-headline-md text-headline-md flex h-16 w-full flex-col items-center justify-center rounded-lg bg-primary leading-none text-on-primary shadow-[4px_4px_0px_0px_rgba(97,255,184,0.3)] transition-all hover:brightness-110 active:translate-x-1 active:translate-y-1 disabled:opacity-50"
          >
            <span className="uppercase">Bet</span>
          </button>
        )}
      </div>
    </div>
  )
}
