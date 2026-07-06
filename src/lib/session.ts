import { createHmac, timingSafeEqual } from "node:crypto"

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error("SESSION_SECRET not set")
  return s
}

export function signSession(userId: string): string {
  const body = encodeURIComponent(userId)
  const sig = createHmac("sha256", secret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifySession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null
  // Signature is base64url (never contains "."), so split on the last dot to
  // tolerate a body that itself contains "." once decoded/encoded.
  const idx = cookieValue.lastIndexOf(".")
  if (idx < 0) return null
  const body = cookieValue.slice(0, idx)
  const sig = cookieValue.slice(idx + 1)
  if (!body || !sig) return null
  const expected = createHmac("sha256", secret()).update(body).digest("base64url")
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return decodeURIComponent(body)
}
