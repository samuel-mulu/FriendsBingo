-- Deduplicate any existing rows that share a deviceId (keep earliest grant).
DELETE FROM "DeviceWelcomeBonusGrant" AS grant_row
WHERE grant_row."id" IN (
  SELECT duplicate."id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "deviceId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS row_num
    FROM "DeviceWelcomeBonusGrant"
  ) AS duplicate
  WHERE duplicate.row_num > 1
);

-- Drop composite unique + non-unique device index, then enforce one grant per device.
DROP INDEX IF EXISTS "DeviceWelcomeBonusGrant_deviceId_userId_key";
DROP INDEX IF EXISTS "DeviceWelcomeBonusGrant_deviceId_idx";

CREATE UNIQUE INDEX "DeviceWelcomeBonusGrant_deviceId_key" ON "DeviceWelcomeBonusGrant"("deviceId");
