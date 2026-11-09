-- CreateTable
CREATE TABLE "AppVersionConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "releaseNotes" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppVersionConfig_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row
INSERT INTO "AppVersionConfig" (
    "id",
    "releaseNotes",
    "updatedAt"
) VALUES (
    'default',
    '',
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "AppVersionConfig" ADD CONSTRAINT "AppVersionConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
