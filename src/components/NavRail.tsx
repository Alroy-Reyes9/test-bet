"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

type NavItem = { href: string; label: string; icon: string; real: boolean }

const items: NavItem[] = [
  { href: "/play", label: "Play", icon: "rocket_launch", real: true },
  { href: "/history", label: "History", icon: "history", real: true },
  { href: "#", label: "Leaderboard", icon: "leaderboard", real: false },
  { href: "#", label: "Rewards", icon: "redeem", real: false },
  { href: "#", label: "Support", icon: "support_agent", real: false },
]

const mobileItems: NavItem[] = [
  { href: "/play", label: "Play", icon: "rocket_launch", real: true },
  { href: "/history", label: "History", icon: "history", real: true },
  { href: "#", label: "Rank", icon: "leaderboard", real: false },
  { href: "#", label: "Account", icon: "account_circle", real: false },
]

export function NavRail() {
  const path = usePathname()

  return (
    <>
      {/* Desktop side rail */}
      <aside className="hidden lg:flex h-screen w-64 shrink-0 flex-col gap-1 border-r border-outline-variant bg-surface-container py-4">
        <div className="mb-8 px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-on-primary">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
            </span>
            <div>
              <h1 className="font-display-multiplier text-headline-md text-primary tracking-tighter">TEST-BET</h1>
              <p className="font-label-mono text-label-mono leading-tight text-on-surface-variant">Arcade Mode</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {items.map((it) => {
            const active = it.real && path === it.href
            const iconStyle = active ? { fontVariationSettings: "'FILL' 1" } : undefined
            const className = active
              ? "flex items-center gap-3 border-l-4 border-primary bg-primary-container px-4 py-3 font-bold text-on-primary-container transition-all"
              : "flex items-center gap-3 px-4 py-3 text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-primary active:scale-95"
            const content = (
              <>
                <span className="material-symbols-outlined" style={iconStyle}>{it.icon}</span>
                <span className="font-label-mono text-label-mono">{it.label}</span>
              </>
            )
            return it.real ? (
              <Link key={it.label} href={it.href} className={className}>{content}</Link>
            ) : (
              <span key={it.label} role="link" aria-disabled="true" className={`${className} cursor-not-allowed opacity-80`}>{content}</span>
            )
          })}
        </nav>
        <div className="mt-auto space-y-4 px-4">
          <button type="button" className="w-full rounded-lg bg-primary py-4 font-bold tracking-widest text-on-primary transition-all active:scale-95">
            DEPOSIT
          </button>
          <div className="space-y-1">
            <span role="link" aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 px-4 py-2 text-on-surface-variant transition-colors hover:text-primary">
              <span className="material-symbols-outlined">settings</span>
              <span className="font-label-mono text-label-mono">Settings</span>
            </span>
            <Link href="/fairness" className="flex items-center gap-3 px-4 py-2 text-on-surface-variant transition-colors hover:text-primary">
              <span className="material-symbols-outlined">verified_user</span>
              <span className="font-label-mono text-label-mono">Fairness</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-16 items-center justify-around border-t border-outline-variant bg-surface-container px-4 lg:hidden">
        {mobileItems.map((it) => {
          const active = it.real && path === it.href
          const cls = active ? "flex flex-col items-center gap-1 text-primary" : "flex flex-col items-center gap-1 text-on-surface-variant"
          const content = (
            <>
              <span className="material-symbols-outlined" style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}>{it.icon}</span>
              <span className="text-[10px] font-label-mono">{it.label}</span>
            </>
          )
          return it.real ? (
            <Link key={it.label} href={it.href} className={cls}>{content}</Link>
          ) : (
            <span key={it.label} role="link" aria-disabled="true" className={cls}>{content}</span>
          )
        })}
      </nav>
    </>
  )
}
