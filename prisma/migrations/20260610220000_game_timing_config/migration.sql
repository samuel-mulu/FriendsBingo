-- CreateTable
CREATE TABLE "GameTimingConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "registrationDurationSeconds" INTEGER NOT NULL DEFAULT 60,
    "autoCallIntervalSeconds" INTEGER NOT NULL DEFAULT 7,
    "winnerWindowSeconds" INTEGER NOT NULL DEFAULT 15,
    "cartelaHoldSeconds" INTEGER NOT NULL DEFAULT 10,
    "finishedResultDisplaySeconds" INTEGER NOT NULL DEFAULT 3,
    "preparingDisplayMaxSeconds" INTEGER,
    "missedNumberAnimationMs" INTEGER NOT NULL DEFAULT 150,
    "missedNumberStaggerMaxBalls" INTEGER NOT NULL DEFAULT 10,
    "adminRefreshDebounceMs" INTEGER NOT NULL DEFAULT 2500,
    "adminFallbackPollingSeconds" INTEGER NOT NULL DEFAULT 5,
    "flutterRefetchDebounceMs" INTEGER NOT NULL DEFAULT 400,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "GameTimingConfig_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row with current production defaults
INSERT INTO "GameTimingConfig" (
    "id",
    "registrationDurationSeconds",
    "autoCallIntervalSeconds",
    "winnerWindowSeconds",
    "cartelaHoldSeconds",
    "finishedResultDisplaySeconds",
    "preparingDisplayMaxSeconds",
    "missedNumberAnimationMs",
    "missedNumberStaggerMaxBalls",
    "adminRefreshDebounceMs",
    "adminFallbackPollingSeconds",
    "flutterRefetchDebounceMs",
    "updatedAt"
) VALUES (
    'default',
    60,
    7,
    15,
    10,
    3,
    NULL,
    150,
    10,
    2500,
    5,
    400,
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "GameTimingConfig" ADD CONSTRAINT "GameTimingConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
