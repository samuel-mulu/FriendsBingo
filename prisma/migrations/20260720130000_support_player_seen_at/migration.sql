-- AlterTable
ALTER TABLE "PlayerSupportMessage" ADD COLUMN "playerSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PlayerSupportMessage_userId_status_playerSeenAt_idx" ON "PlayerSupportMessage"("userId", "status", "playerSeenAt");
