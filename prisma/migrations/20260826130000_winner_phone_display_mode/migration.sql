-- CreateEnum
CREATE TYPE "WinnerPhoneDisplayMode" AS ENUM ('HIDDEN', 'FULL', 'MASKED');

-- AlterTable
ALTER TABLE "AppDisplayConfig" ADD COLUMN "winnerPhoneDisplayMode" "WinnerPhoneDisplayMode" NOT NULL DEFAULT 'HIDDEN';

UPDATE "AppDisplayConfig"
SET "winnerPhoneDisplayMode" = 'FULL'
WHERE "showWinnerPhoneNumber" = true;

ALTER TABLE "AppDisplayConfig" DROP COLUMN "showWinnerPhoneNumber";
