-- CreateTable
CREATE TABLE "PushDeliveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entityId" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDeliveryLog_userId_category_entityId_key" ON "PushDeliveryLog"("userId", "category", "entityId");

-- CreateIndex
CREATE INDEX "PushDeliveryLog_userId_sentAt_idx" ON "PushDeliveryLog"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "PushDeliveryLog_category_sentAt_idx" ON "PushDeliveryLog"("category", "sentAt");

-- AddForeignKey
ALTER TABLE "PushDeliveryLog" ADD CONSTRAINT "PushDeliveryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
