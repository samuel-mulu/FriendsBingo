-- CreateTable
CREATE TABLE "NotificationConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row (push enabled by default)
INSERT INTO "NotificationConfig" (
    "id",
    "pushNotificationsEnabled",
    "updatedAt"
) VALUES (
    'default',
    true,
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "NotificationConfig" ADD CONSTRAINT "NotificationConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
