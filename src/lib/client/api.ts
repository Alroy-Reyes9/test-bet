async function j<T>(res: Response): Promise<T> { if (!res.ok && res.status >= 500) throw new Error(await res.text()); return res.json() }

export const api = {
  devLogin: (username: string) => fetch("/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) }).then(j),
  walletBalance: () => fetch("/api/wallet").then(j) as Promise<{ available: string; escrow: string }>,
  claimDaily: () => fetch("/api/wallet/daily-bonus", { method: "POST" }).then(j),
  bet: (stake: string, autoCashout?: number) => fetch("/api/crash/bet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stake, autoCashout }) }).then(j) as Promise<{ ok: boolean; roundId: string; commitHash: string; startedAt: string; growthRate: number; autoCashout: number | null; error?: string }>,
  cashout: (roundId: string) => fetch("/api/crash/cashout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roundId }) }).then(j) as Promise<{ status: string; cashoutMultiplier: number | null; crashPoint: number; serverSeed: string; payout: string }>,
  roundStatus: (id: string) => fetch(`/api/crash/round/${id}`).then(j) as Promise<{ status: string; serverMultiplier: number | null; crashPoint: number | null; serverSeed: string | null; cashoutMultiplier: number | null; payout: string | null }>,
  history: () => fetch("/api/crash/history").then(j) as Promise<{ items: Array<{ id: string; stake: string; status: string; crashPoint: number; cashoutMultiplier: number | null; payout: string | null; startedAt: string }> }>,
}
