-- CreateEnum
CREATE TYPE "BingoClaimReasonCode" AS ENUM (
  'INVALID_PATTERN',
  'INVALID_LATE_CLAIM',
  'ALREADY_BLOCKED',
  'ALREADY_WINNER'
);

-- AlterTable
ALTER TABLE "BingoClaim"
ADD COLUMN "reasonCode" "BingoClaimReasonCode";
