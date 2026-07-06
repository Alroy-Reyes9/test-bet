CREATE UNIQUE INDEX one_running_round_per_user
  ON "CrashRound" ("userId") WHERE "status" = 'RUNNING';
