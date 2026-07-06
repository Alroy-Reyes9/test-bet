import { WalletChip } from "@/components/WalletChip"

export function TopBar({ balance, onDailyBonus }: { balance: string; onDailyBonus: () => void }) {
  return (
    <header className="z-20 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-4 lg:px-8">
      <div className="flex items-center gap-4">
        <span className="font-display-multiplier text-headline-md italic uppercase tracking-tighter text-primary">CRASH</span>
      </div>
      <div className="flex items-center gap-4 lg:gap-6">
        <button
          type="button"
          onClick={onDailyBonus}
          className="flex items-center gap-2 rounded-lg bg-tertiary-container px-3 py-1.5 font-bold text-on-tertiary-container transition-all hover:brightness-110 active:translate-y-0.5"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
          <span className="font-label-mono text-label-mono hidden sm:inline">Bonus</span>
        </button>
        <WalletChip balance={balance} />
        <div className="flex items-center gap-3">
          <button type="button" className="material-symbols-outlined text-on-surface-variant transition-colors hover:text-primary">
            notifications
          </button>
          <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-outline-variant bg-surface-container-high text-on-surface-variant">
            <span className="material-symbols-outlined text-lg">person</span>
          </div>
        </div>
      </div>
    </header>
  )
}
