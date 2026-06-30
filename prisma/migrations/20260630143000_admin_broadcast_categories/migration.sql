-- CreateEnum
CREATE TYPE "AdminBroadcastCategory" AS ENUM ('DISMISSIBLE', 'PERSISTENT', 'FORCED');

-- AlterTable
ALTER TABLE "AdminBroadcast" ADD COLUMN "category" "AdminBroadcastCategory" NOT NULL DEFAULT 'DISMISSIBLE';

-- CreateIndex
CREATE INDEX "AdminBroadcast_category_idx" ON "AdminBroadcast"("category");
