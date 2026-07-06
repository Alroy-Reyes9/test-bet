import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { newServerSeed, commitHash, crashPointFromHash, deriveRound } from "@/lib/crash/fair"

describe("provably fair", () => {
  it("commitHash is sha256(serverSeed) and verifiable", () => {
    const seed = newServerSeed()
    expect(commitHash(seed)).toBe(createHash("sha256").update(seed).digest("hex"))
    expect(seed).toMatch(/^[0-9a-f]{64}$/)
  })

  it("crashPointFromHash is deterministic and never below 1.00x", () => {
    const seed = "a".repeat(64)
    const a = crashPointFromHash(seed, "client-1")
    const b = crashPointFromHash(seed, "client-1")
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(100)
  })

  it("distribution: instant-bust rate ~1/divisor, median ~2x", () => {
    // Two independent sources land a round at exactly 1.00x:
    //  (a) the house-edge modulo instant-bust  → ~1/HOUSE_EDGE_DIVISOR ≈ 0.99%
    //  (b) the base formula flooring low rounds → h < e/100 ≈ 1.00%
    // So the observed 1.00x rate is ~2%, NOT 1/101. Use a band around 2% with
    // enough samples that sampling variance can't push it out (20k → 3σ ≈ ±0.3%).
    const N = 20000
    let onePointZero = 0
    const points: number[] = []
    for (let i = 0; i < N; i++) {
      const p = crashPointFromHash("a".repeat(64), "c" + i)
      if (p === 100) onePointZero++
      points.push(p)
    }
    const rate = onePointZero / N
    expect(rate).toBeGreaterThan(0.012)
    expect(rate).toBeLessThan(0.028)
    points.sort((x, y) => x - y)
    const median = points[Math.floor(points.length / 2)]
    expect(median).toBeGreaterThan(150) // ~2x, allow slack
    expect(median).toBeLessThan(260)
  })

  it("deriveRound ties seed, commit, and crash point together", () => {
    const r = deriveRound("client-x")
    expect(commitHash(r.serverSeed)).toBe(r.commitHash)
    expect(crashPointFromHash(r.serverSeed, "client-x")).toBe(r.crashPoint)
  })
})
