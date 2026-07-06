"use client"
import { useEffect, useState } from "react"
import { api } from "@/lib/client/api"
import { NavRail } from "@/components/NavRail"
import { FairnessCard } from "@/components/FairnessCard"

export default function Fairness() {
  const [lastId, setLastId] = useState<string | undefined>()
  useEffect(() => { api.history().then((r) => setLastId(r.items[0]?.id)) }, [])
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="flex-1 p-6">
        <h1 className="mb-4 text-lg font-bold tracking-widest">FAIRNESS</h1>
        <div className="max-w-md"><FairnessCard roundId={lastId} /></div>
      </div>
    </div>
  )
}
