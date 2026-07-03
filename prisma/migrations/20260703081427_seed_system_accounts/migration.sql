-- Idempotently seed the singleton FAUCET and HOUSE system accounts so a
-- freshly-migrated (production) database has them without a manual step.
INSERT INTO "Account" ("id","type","balance","createdAt")
SELECT gen_random_uuid()::text, 'FAUCET', 0, now()
WHERE NOT EXISTS (SELECT 1 FROM "Account" WHERE "type" = 'FAUCET' AND "userId" IS NULL);

INSERT INTO "Account" ("id","type","balance","createdAt")
SELECT gen_random_uuid()::text, 'HOUSE', 0, now()
WHERE NOT EXISTS (SELECT 1 FROM "Account" WHERE "type" = 'HOUSE' AND "userId" IS NULL);
