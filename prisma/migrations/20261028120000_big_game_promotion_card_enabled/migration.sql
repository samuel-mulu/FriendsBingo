ALTER TABLE "AppDisplayConfig"
ADD COLUMN IF NOT EXISTS "bigGamePromotionCardEnabled" BOOLEAN NOT NULL DEFAULT true;
