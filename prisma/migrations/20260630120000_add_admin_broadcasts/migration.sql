-- CreateTable
CREATE TABLE "AdminBroadcast" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminBroadcastDismissal" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminBroadcastDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminBroadcast_createdAt_idx" ON "AdminBroadcast"("createdAt");

-- CreateIndex
CREATE INDEX "AdminBroadcastDismissal_userId_idx" ON "AdminBroadcastDismissal"("userId");

-- CreateIndex
CREATE INDEX "AdminBroadcastDismissal_broadcastId_idx" ON "AdminBroadcastDismissal"("broadcastId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminBroadcastDismissal_broadcastId_userId_key" ON "AdminBroadcastDismissal"("broadcastId", "userId");

-- AddForeignKey
ALTER TABLE "AdminBroadcast" ADD CONSTRAINT "AdminBroadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminBroadcastDismissal" ADD CONSTRAINT "AdminBroadcastDismissal_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "AdminBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminBroadcastDismissal" ADD CONSTRAINT "AdminBroadcastDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
