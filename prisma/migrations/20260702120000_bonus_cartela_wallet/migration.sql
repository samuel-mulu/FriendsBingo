-- CreateEnum
CREATE TYPE "CartelaPaymentSource" AS ENUM ('MONEY_WALLET', 'BONUS_CARTELA');

-- CreateEnum
CREATE TYPE "CompanyFeeSource" AS ENUM ('MONEY', 'BONUS');

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "bonusCartelaBalance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GameCartela" ADD COLUMN "paymentSource" "CartelaPaymentSource",
ADD COLUMN "entryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "prizeContributionCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "companyFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "companyFeeSource" "CompanyFeeSource";
