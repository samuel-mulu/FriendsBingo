-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'TELEGRAM_LINK';
ALTER TYPE "OtpPurpose" ADD VALUE 'SET_PASSWORD';

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "telegramId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramFirstName" TEXT;

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- AlterTable RefreshToken
ALTER TABLE "RefreshToken" ADD COLUMN "platform" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "deviceLabel" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable TelegramAuthChallenge
CREATE TABLE "TelegramAuthChallenge" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "ticketHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramAuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramAuthChallenge_ticketHash_key" ON "TelegramAuthChallenge"("ticketHash");
CREATE INDEX "TelegramAuthChallenge_telegramId_consumedAt_createdAt_idx" ON "TelegramAuthChallenge"("telegramId", "consumedAt", "createdAt");
CREATE INDEX "TelegramAuthChallenge_expiresAt_idx" ON "TelegramAuthChallenge"("expiresAt");
