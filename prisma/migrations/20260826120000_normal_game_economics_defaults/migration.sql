-- AlterTable
ALTER TABLE "GameTimingConfig"
ADD COLUMN "normalDefaultEntryFee" DECIMAL(12, 2) NOT NULL DEFAULT 10,
ADD COLUMN "normalDefaultCompanyFeePerCartela" DECIMAL(12, 2) NOT NULL DEFAULT 2;
