-- Drop redundant indexes covered by composite unique constraints or left-prefix indexes
DROP INDEX IF EXISTS "CalledNumber_gameSessionId_idx";
DROP INDEX IF EXISTS "WalletTransaction_userId_idx";
DROP INDEX IF EXISTS "RegistrationCashbackAccrual_gameSessionId_idx";
DROP INDEX IF EXISTS "RegistrationCashbackGrant_userId_idx";
DROP INDEX IF EXISTS "AdminBroadcastDismissal_broadcastId_idx";
DROP INDEX IF EXISTS "Notification_userId_idx";

-- Create composite index for Notification query optimization
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- Create missing foreign key indexes
CREATE INDEX IF NOT EXISTS "PlayerSupportMessage_repliedById_idx" ON "PlayerSupportMessage"("repliedById");
CREATE INDEX IF NOT EXISTS "User_blockedById_idx" ON "User"("blockedById");
