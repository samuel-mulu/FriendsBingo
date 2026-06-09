-- CreateEnum
CREATE TYPE "GameCartelaReservationStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GameCartelaReservation" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "cartelaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "GameCartelaReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameCartelaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameCartelaReservation_gameSessionId_idx" ON "GameCartelaReservation"("gameSessionId");

-- CreateIndex
CREATE INDEX "GameCartelaReservation_cartelaId_idx" ON "GameCartelaReservation"("cartelaId");

-- CreateIndex
CREATE INDEX "GameCartelaReservation_userId_idx" ON "GameCartelaReservation"("userId");

-- CreateIndex
CREATE INDEX "GameCartelaReservation_status_expiresAt_idx" ON "GameCartelaReservation"("status", "expiresAt");

-- One ACTIVE reservation per cartela per session
CREATE UNIQUE INDEX "GameCartelaReservation_active_session_cartela_key"
ON "GameCartelaReservation"("gameSessionId", "cartelaId")
WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "GameCartelaReservation" ADD CONSTRAINT "GameCartelaReservation_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCartelaReservation" ADD CONSTRAINT "GameCartelaReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCartelaReservation" ADD CONSTRAINT "GameCartelaReservation_cartelaId_fkey" FOREIGN KEY ("cartelaId") REFERENCES "Cartela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
