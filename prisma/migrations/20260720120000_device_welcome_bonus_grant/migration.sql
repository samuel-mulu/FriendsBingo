-- AlterTable
ALTER TABLE "Wallet" ALTER COLUMN "bonusCartelaBalance" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "DeviceWelcomeBonusGrant" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "bonusAmount" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceWelcomeBonusGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceWelcomeBonusGrant_userId_key" ON "DeviceWelcomeBonusGrant"("userId");

-- CreateIndex
CREATE INDEX "DeviceWelcomeBonusGrant_deviceId_idx" ON "DeviceWelcomeBonusGrant"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceWelcomeBonusGrant_deviceId_userId_key" ON "DeviceWelcomeBonusGrant"("deviceId", "userId");

-- AddForeignKey
ALTER TABLE "DeviceWelcomeBonusGrant" ADD CONSTRAINT "DeviceWelcomeBonusGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
