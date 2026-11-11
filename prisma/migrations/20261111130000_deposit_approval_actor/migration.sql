-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN "approvalSource" "WithdrawalApprovalSource",
ADD COLUMN "approvedById" TEXT;

-- CreateIndex
CREATE INDEX "Deposit_approvalSource_idx" ON "Deposit"("approvalSource");
CREATE INDEX "Deposit_approvedById_idx" ON "Deposit"("approvedById");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Manual approvals: the admin is the actor on the approve audit.
UPDATE "Deposit" AS d
SET
  "approvalSource" = 'MANUAL',
  "approvedById" = log."actorId"
FROM (
  SELECT DISTINCT ON ("entityId")
    "entityId",
    "actorId"
  FROM "AuditLog"
  WHERE "entity" = 'Deposit'
    AND "action" = 'admin.deposit.approve'
    AND "actorId" IS NOT NULL
  ORDER BY "entityId", "createdAt" ASC
) AS log
WHERE d."id" = log."entityId"
  AND d."approvalSource" IS NULL
  AND d."status" = 'APPROVED';

-- Remaining approved rows follow the stored verification source.
UPDATE "Deposit"
SET "approvalSource" = 'AUTOMATIC'
WHERE "approvalSource" IS NULL
  AND "status" = 'APPROVED'
  AND (
    "verifiedData"->>'verificationSource' = 'verify.et'
    OR "verifiedData"->>'approvalModeAtSubmit' = 'automatic'
  );

UPDATE "Deposit"
SET "approvalSource" = 'LOCAL'
WHERE "approvalSource" IS NULL
  AND "status" = 'APPROVED'
  AND (
    "verifiedData"->>'verificationSource' = 'telebirr.local'
    OR "verifiedData"->>'approvalModeAtSubmit' = 'local'
  );

UPDATE "Deposit"
SET "approvalSource" = 'MANUAL'
WHERE "approvalSource" IS NULL
  AND "status" = 'APPROVED'
  AND (
    "verifiedData"->>'verificationSource' = 'Manual admin approval'
    OR "verifiedData"->>'approvedByAdmin' = 'true'
  );
