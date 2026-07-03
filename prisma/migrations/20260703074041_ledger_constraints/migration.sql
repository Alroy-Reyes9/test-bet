-- User accounts (AVAILABLE, ESCROW) may never go negative; system accounts may.
ALTER TABLE "Account"
  ADD CONSTRAINT user_balance_non_negative
  CHECK ("type" IN ('FAUCET', 'HOUSE') OR "balance" >= 0);

-- At most one system account per type (userId IS NULL rows are otherwise unconstrained by the composite unique).
CREATE UNIQUE INDEX one_system_account_per_type
  ON "Account" ("type") WHERE "userId" IS NULL;
