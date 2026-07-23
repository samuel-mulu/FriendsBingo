-- Allow multiple denial rows (bonusAmount = 0) on the same deviceId,
-- while still allowing only one positive welcome award per device.
DROP INDEX IF EXISTS "DeviceWelcomeBonusGrant_deviceId_key";

CREATE UNIQUE INDEX "DeviceWelcomeBonusGrant_deviceId_positive_key"
  ON "DeviceWelcomeBonusGrant"("deviceId")
  WHERE "bonusAmount" > 0;

CREATE INDEX IF NOT EXISTS "DeviceWelcomeBonusGrant_deviceId_idx"
  ON "DeviceWelcomeBonusGrant"("deviceId");

ALTER TABLE "DeviceWelcomeBonusGrant"
  ALTER COLUMN "bonusAmount" SET DEFAULT 0;

-- Close the loophole for users who already used a claimed device but never
-- received a denial grant (so a later login on a fresh install UUID could
-- still award 10). Record bonusAmount = 0 for those users permanently.
INSERT INTO "DeviceWelcomeBonusGrant" (
  id,
  "deviceId",
  "userId",
  "phoneNumber",
  "bonusAmount",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  linked.device_id,
  u.id,
  u."phoneNumber",
  0,
  NOW()
FROM (
  SELECT DISTINCT
    rt."userId" AS user_id,
    rt."deviceId" AS device_id
  FROM "RefreshToken" rt
  INNER JOIN "DeviceWelcomeBonusGrant" g
    ON g."deviceId" = rt."deviceId"
   AND g."bonusAmount" > 0
   AND g."userId" <> rt."userId"
  WHERE rt."deviceId" IS NOT NULL
    AND btrim(rt."deviceId") <> ''
) linked
INNER JOIN "User" u ON u.id = linked.user_id
WHERE NOT EXISTS (
  SELECT 1
  FROM "DeviceWelcomeBonusGrant" existing
  WHERE existing."userId" = u.id
);
