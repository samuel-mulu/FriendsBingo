-- CreateTable
CREATE TABLE "AdminExpense" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminExpense_expenseDate_idx" ON "AdminExpense"("expenseDate");

-- CreateIndex
CREATE INDEX "AdminExpense_createdById_idx" ON "AdminExpense"("createdById");

-- AddForeignKey
ALTER TABLE "AdminExpense" ADD CONSTRAINT "AdminExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
