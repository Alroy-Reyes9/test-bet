export function WalletChip({ balance }: { balance: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-highest px-3 py-1.5">
      <span className="material-symbols-outlined text-tertiary">account_balance_wallet</span>
      <span className="font-label-mono text-label-mono font-bold text-primary tabular-nums">{Number(balance).toLocaleString()}</span>
    </div>
  )
}
