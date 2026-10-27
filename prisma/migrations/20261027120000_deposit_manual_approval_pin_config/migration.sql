-- CreateTable
CREATE TABLE "DepositManualApprovalPinConfig" (
    "id" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositManualApprovalPinConfig_pkey" PRIMARY KEY ("id")
);

-- Default manual deposit approval PIN (121921), bcrypt cost 10
INSERT INTO "DepositManualApprovalPinConfig" (
    "id",
    "pinHash",
    "updatedAt"
) VALUES (
    'default',
    '$2b$10$LTxy8lXxov0.GSvxsQnScO5EodhkjD5qlzj8P6MasJooowSNpOFH.',
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "DepositManualApprovalPinConfig" ADD CONSTRAINT "DepositManualApprovalPinConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
