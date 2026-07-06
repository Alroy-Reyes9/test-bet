import { GROWTH_RATE } from "./config"

/** Multiplier at `elapsedMs` since round start, in integer hundredths, floored. */
export function multiplierAt(elapsedMs: number): number {
  const m = Math.exp(GROWTH_RATE * (elapsedMs / 1000))
  return Math.max(100, Math.floor(m * 100))
}

/** Milliseconds from round start until the multiplier reaches `crashHundredths`. */
export function crashTimeMs(crashHundredths: number): number {
  const x = crashHundredths / 100
  return Math.max(0, (Math.log(x) / GROWTH_RATE) * 1000)
}

/** Chips returned for a stake cashed out at `multHundredths` (floored to integer chips). */
export function payoutFor(stake: bigint, multHundredths: number): bigint {
  return (stake * BigInt(multHundredths)) / 100n
}
