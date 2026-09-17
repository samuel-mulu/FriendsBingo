-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GamePushMode" AS ENUM ('ALWAYS', 'REGISTERED_ONLY', 'OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gamePushMode" "GamePushMode" NOT NULL DEFAULT 'ALWAYS';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_gamePushMode_idx" ON "User"("gamePushMode");
