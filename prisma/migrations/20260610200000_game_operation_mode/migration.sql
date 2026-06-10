-- CreateEnum
CREATE TYPE "GameOperationMode" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "GameSlot"
ADD COLUMN "operationMode" "GameOperationMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "registrationDurationSeconds" INTEGER,
ADD COLUMN "autoCallIntervalSeconds" INTEGER;

-- AlterTable
ALTER TABLE "GameSession"
ADD COLUMN "scheduledStartAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GameSession_status_scheduledStartAt_idx" ON "GameSession"("status", "scheduledStartAt");
