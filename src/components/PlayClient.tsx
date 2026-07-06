"use client"
import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/client/api"
import { NavRail } from "@/components/NavRail"
import { TopBar } from "@/components/TopBar"
import { CrashStage } from "@/components/CrashStage"
import { MultiplierReadout } from "@/components/MultiplierReadout"
import { BetPanel } from "@/components/BetPanel"
import { RecentRounds } from "@/components/RecentRounds"
import { FairnessCard } from "@/components/FairnessCard"

type Round = { id: string; status: string; crashPoint: number; cashoutMultiplier: number | null; payout: string | null; stake: string }

export function PlayClient() {
  const [balance, setBalance] = useState("0")
  const [stake, setStake] = useState("100")
  const [auto, setAuto] = useState<number | null>(null)
  const [mult, setMult] = useState(100)
  const [live, setLive] = useState(false)
  const [busted, setBusted] = useState(false)
  const [rounds, setRounds] = useState<Round[]>([])
  const [commitHash, setCommitHash] = useState<string | undefined>(undefined)
  const round = useRef<{ id: string; startedAt: number; growthRate: number } | null>(null)
  const raf = useRef(0); const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() { setBalance((await api.walletBalance()).available); setRounds((await api.history()).items as Round[]) }
  useEffect(() => { refresh() }, [])

  function stop() { cancelAnimationFrame(raf.current); if (poll.current) clearInterval(poll.current); poll.current = null }
  // Clear the RAF loop and the 300ms poll interval on unmount — otherwise
  // both keep firing (and touching state) after the component is gone.
  // `stop` is a hoisted function declaration, so it's safe to reference here
  // regardless of textual order.
  useEffect(() => stop, [])

  async function onBet() {
    setBusted(false)
    const r = await api.bet(stake, auto ?? undefined)
    if (!r.ok) { await refresh(); return }
    setCommitHash(r.commitHash)
    round.current = { id: r.roundId, startedAt: new Date(r.startedAt).getTime(), growthRate: r.growthRate }
    setLive(true); setBalance((b) => String(Number(b) - Number(stake)))
    const tick = () => {
      const el = Date.now() - round.current!.startedAt
      setMult(Math.max(100, Math.floor(Math.exp(round.current!.growthRate * (el / 1000)) * 100)))
      raf.current = requestAnimationFrame(tick)
    }
    tick()
    poll.current = setInterval(async () => {
      const s = await api.roundStatus(round.current!.id)
      if (s.status !== "RUNNING") { stop(); setBusted(s.status === "BUSTED"); if (s.crashPoint) setMult(s.crashPoint); setLive(false); setTimeout(refresh, 400) }
    }, 300)
  }

  async function onCashout() {
    if (!round.current) return
    const out = await api.cashout(round.current.id)
    // `j()` only throws on 5xx — an error body (e.g. 404 not_found) still
    // resolves here with no `status` field. Treat that as a no-op/refresh
    // instead of falling into the win branch below.
    if (!out.status) { await refresh(); return }
    stop(); setLive(false)
    if (out.status === "BUSTED") { setBusted(true); setMult(out.crashPoint) } else setMult(out.cashoutMultiplier ?? mult)
    setTimeout(refresh, 300)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-background">
      <NavRail />
      <main className="relative flex min-w-0 flex-1 flex-col bg-background">
        <TopBar balance={balance} onDailyBonus={async () => { await api.claimDaily(); refresh() }} />
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 pb-20 lg:p-8 lg:pb-8">
          <div className="flex flex-col gap-6 lg:h-full lg:min-h-0 lg:flex-row">
            <div className="flex flex-col gap-6 lg:min-h-0 lg:flex-[2]">
              <CrashStage hundredths={mult} busted={busted}>
                <MultiplierReadout
                  hundredths={mult}
                  busted={busted}
                  live={live}
                  hint={live ? `Cash out to win ${Math.floor((Number(stake) * mult) / 100).toLocaleString()} chips` : busted ? "Round over · seed revealed" : "Place a bet to start"}
                />
              </CrashStage>
              <BetPanel
                stake={stake}
                setStake={setStake}
                auto={auto}
                setAuto={setAuto}
                live={live}
                mult={mult}
                balance={balance}
                onBet={onBet}
                onCashout={onCashout}
                disabled={Number(stake) < 1}
              />
            </div>
            <aside className="flex flex-col gap-6 lg:min-h-0 lg:w-80 lg:flex-none">
              <RecentRounds rounds={rounds} />
              <FairnessCard roundId={rounds[0]?.id} activeHash={commitHash} />
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}
