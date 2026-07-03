export class WalletError extends Error {}

export class LedgerImbalanceError extends WalletError {
  constructor(public idempotencyKey: string, public sum: bigint) {
    super(`Postings for "${idempotencyKey}" sum to ${sum}, not 0`)
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(public accountId: string, public balance: bigint, public debit: bigint) {
    super(`Account ${accountId} has ${balance}, cannot debit ${debit}`)
  }
}

export class DailyBonusCooldownError extends WalletError {
  constructor(public resetAt: Date) {
    super(`Daily bonus already claimed; resets at ${resetAt.toISOString()}`)
  }
}

/** Internal sentinel: guard-detected that the wallet is already funded. */
export class AlreadyFundedError extends WalletError {
  constructor() {
    super("Wallet already funded; top-up aborted")
  }
}
