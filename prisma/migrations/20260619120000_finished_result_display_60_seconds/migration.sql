-- Align post-game review hold with 60-second registration delay grace.
ALTER TABLE "GameTimingConfig" ALTER COLUMN "finishedResultDisplaySeconds" SET DEFAULT 60;

UPDATE "GameTimingConfig"
SET "finishedResultDisplaySeconds" = 60
WHERE "finishedResultDisplaySeconds" < 60;
