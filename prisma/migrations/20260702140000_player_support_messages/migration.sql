-- CreateEnum
CREATE TYPE "PlayerSupportCategory" AS ENUM ('FEEDBACK', 'COMPLAINT', 'ADVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlayerSupportStatus" AS ENUM ('OPEN', 'REPLIED', 'CLOSED');

-- CreateTable
CREATE TABLE "PlayerSupportMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "PlayerSupportCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "PlayerSupportStatus" NOT NULL DEFAULT 'OPEN',
    "adminReply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerSupportMessage_status_createdAt_idx" ON "PlayerSupportMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlayerSupportMessage_userId_createdAt_idx" ON "PlayerSupportMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlayerSupportMessage" ADD CONSTRAINT "PlayerSupportMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSupportMessage" ADD CONSTRAINT "PlayerSupportMessage_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
