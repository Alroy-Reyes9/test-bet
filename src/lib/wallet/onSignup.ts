import { ensureUserAccounts } from "./accounts"
import { grantSignupBonus } from "./operations"

/**
 * Call from the auth provider's "user created" webhook/trigger.
 * Idempotent: safe under webhook re-delivery (grant is keyed `signup:{userId}`).
 */
export async function onUserCreated(userId: string): Promise<void> {
  await ensureUserAccounts(userId)
  await grantSignupBonus(userId)
}
