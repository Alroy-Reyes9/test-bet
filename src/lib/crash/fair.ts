import { createHash, createHmac, randomBytes } from "node:crypto"
import { HOUSE_EDGE_DIVISOR } from "./config"

export function newServerSeed(): string {
  return randomBytes(32).toString("hex")
}

export function commitHash(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex")
}

/** Bustabit-style crash point in integer hundredths (>= 100). */
export function crashPointFromHash(serverSeed: string, clientSeed: string): number {
  const hmac = createHmac("sha256", serverSeed).update(clientSeed).digest("hex")
  // first 52 bits of the digest as an integer
  const h = BigInt("0x" + hmac.slice(0, 13))
  if (h % BigInt(HOUSE_EDGE_DIVISOR) === 0n) return 100 // instant bust — the house edge
  // Do the whole computation in BigInt: e = 2**52 and h (a 52-bit value, so
  // 0 <= h < e) both fit comfortably, but `100 * e` alone exceeds 2^53 and
  // loses integer precision in a plain `number` division. BigInt division
  // truncates toward zero, which is equivalent to Math.floor here since both
  // the numerator and denominator are positive (h < e).
  const e = 1n << 52n
  const result = (100n * e - h) / (e - h)
  return Number(result)
}

export function deriveRound(clientSeed: string): {
  serverSeed: string
  commitHash: string
  crashPoint: number
} {
  const serverSeed = newServerSeed()
  return {
    serverSeed,
    commitHash: commitHash(serverSeed),
    crashPoint: crashPointFromHash(serverSeed, clientSeed),
  }
}
