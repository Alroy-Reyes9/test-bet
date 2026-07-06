import { describe, it, expect } from "vitest"
import { multiplierAt, crashTimeMs, payoutFor } from "@/lib/crash/math"
import { GROWTH_RATE } from "@/lib/crash/config"

describe("crash math", () => {
  it("starts at 1.00x and rises monotonically", () => {
    expect(multiplierAt(0)).toBe(100)
    expect(multiplierAt(1000)).toBeGreaterThan(100)
    expect(multiplierAt(2000)).toBeGreaterThan(multiplierAt(1000))
  })

  it("reaches ~2.00x near 4.5s", () => {
    const m = multiplierAt(Math.log(2) / GROWTH_RATE * 1000)
    expect(m).toBeGreaterThanOrEqual(199)
    expect(m).toBeLessThanOrEqual(201)
  })

  it("crashTimeMs is the inverse of multiplierAt", () => {
    const t = crashTimeMs(247) // 2.47x
    expect(multiplierAt(t)).toBeGreaterThanOrEqual(246)
    expect(multiplierAt(t)).toBeLessThanOrEqual(248)
  })

  it("payoutFor floors stake * multiplier / 100", () => {
    expect(payoutFor(100n, 247)).toBe(247n)
    expect(payoutFor(100n, 155)).toBe(155n)
    expect(payoutFor(3n, 150)).toBe(4n) // floor(3*1.5)=4
    expect(payoutFor(100n, 100)).toBe(100n)
  })
})
