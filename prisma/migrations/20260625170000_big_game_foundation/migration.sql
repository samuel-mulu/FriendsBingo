ALTER TYPE "GameCategory" ADD VALUE 'BIG_GAME';

ALTER TABLE "GameSession"
ADD COLUMN "registrationOpensAt" TIMESTAMP(3);
