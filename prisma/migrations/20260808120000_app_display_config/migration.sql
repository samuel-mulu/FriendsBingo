-- CreateTable
CREATE TABLE "AppDisplayConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "showWinnerPhoneNumber" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppDisplayConfig_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row (phone hidden by default)
INSERT INTO "AppDisplayConfig" (
    "id",
    "showWinnerPhoneNumber",
    "updatedAt"
) VALUES (
    'default',
    false,
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "AppDisplayConfig" ADD CONSTRAINT "AppDisplayConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
