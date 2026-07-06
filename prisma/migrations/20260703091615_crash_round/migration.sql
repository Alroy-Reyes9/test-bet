-- CreateEnum
CREATE TYPE "CrashStatus" AS ENUM ('RUNNING', 'CASHED_OUT', 'BUSTED');

-- CreateTable
CREATE TABLE "CrashRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stake" BIGINT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "crashPoint" INTEGER NOT NULL,
    "autoCashout" INTEGER,
    "status" "CrashStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashoutMultiplier" INTEGER,
    "payout" BIGINT,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CrashRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrashRound_userId_startedAt_idx" ON "CrashRound"("userId", "startedAt");
