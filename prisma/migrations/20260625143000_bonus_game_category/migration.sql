CREATE TYPE "GameCategory" AS ENUM ('NORMAL', 'BONUS');

ALTER TABLE "GameSlot"
ADD COLUMN "category" "GameCategory" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "fixedPrizeAmount" DECIMAL(12,2),
ADD COLUMN "maxCartelasPerPlayer" INTEGER,
ADD COLUMN "removeAfterFinish" BOOLEAN NOT NULL DEFAULT false;
