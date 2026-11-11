-- CreateEnum
CREATE TYPE "WithdrawalApprovalSource" AS ENUM ('MANUAL', 'LOCAL', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN "approvalSource" "WithdrawalApprovalSource",
ADD COLUMN "approvedById" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Withdrawal_approvalSource_idx" ON "Withdrawal"("approvalSource");
CREATE INDEX "Withdrawal_approvedById_idx" ON "Withdrawal"("approvedById");
CREATE INDEX "Withdrawal_approvedAt_idx" ON "Withdrawal"("approvedAt");

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the admin who approved, preferring the approve audit over mark-paid.
UPDATE "Withdrawal" AS w
SET
  "approvalSource" = 'MANUAL',
  "approvedById" = log."actorId",
  "approvedAt" = COALESCE(w."paidAt", log."createdAt")
FROM (
  SELECT DISTINCT ON ("entityId")
    "entityId",
    "actorId",
    "createdAt"
  FROM "AuditLog"
  WHERE "entity" = 'Withdrawal'
    AND "action" IN ('admin.withdrawal.approve', 'admin.withdrawal.mark_paid')
    AND "actorId" IS NOT NULL
  ORDER BY
    "entityId",
    CASE WHEN "action" = 'admin.withdrawal.approve' THEN 0 ELSE 1 END,
    "createdAt" ASC
) AS log
WHERE w."id" = log."entityId"
  AND w."approvalSource" IS NULL
  AND w."status" IN ('PAID', 'APPROVED');

-- Paid rows with no audit actor still keep an approval time.
UPDATE "Withdrawal"
SET "approvedAt" = "paidAt"
WHERE "approvedAt" IS NULL
  AND "paidAt" IS NOT NULL
  AND "status" IN ('PAID', 'APPROVED');
