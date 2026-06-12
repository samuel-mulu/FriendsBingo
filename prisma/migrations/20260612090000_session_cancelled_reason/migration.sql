-- Track why a session was cancelled ('no_players' | 'admin_cancelled')
ALTER TABLE "GameSession" ADD COLUMN "cancelledReason" TEXT;
