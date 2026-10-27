# Database Schema Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 critical schema and data integrity vulnerabilities across deposits, wallet concurrency, and withdrawal ledger reconciliation.

**Architecture:** 
1. Deploy PostgreSQL partial unique index on `Deposit("provider", "transactionRef") WHERE "status" IN ('PENDING', 'APPROVED')` to prevent cross-user and duplicate receipt credits globally.
2. Deploy PostgreSQL partial unique index on `DepositVerificationAttempt("provider", "transactionRef") WHERE "status" IN ('SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS')` to prevent concurrent in-flight verification attempts.
3. Deploy PostgreSQL table CHECK constraints `balance >= 0` and `lockedBalance >= 0` on `Wallet`, combined with pessimistic row locking (`SELECT id FROM "Wallet" WHERE "userId" = $1 FOR UPDATE`) in `WalletService` to eliminate balance race conditions.
4. Add `walletTransactionId` to `Withdrawal` model, select queries, and link ledger transaction IDs at creation, payout approval, and refund.
5. Update mobile `WithdrawalModel` to reflect the new field.

**Tech Stack:** NestJS, TypeScript, Prisma ORM, PostgreSQL, Flutter / Dart.

## Global Constraints
- Preserve all existing tests and behavior.
- Every migration must be idempotent and safe.
- All balance mutations must go through pessimistic row locking before balance computation.
- Evidence before assertions: compile and test gate commands must run and pass.

---

### Task 1: Prisma Schema & SQL Migration Creation
**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261026160000_schema_integrity_hardening/migration.sql`

- [ ] **Step 1: Update `prisma/schema.prisma`**
  - Add `walletTransactionId String?` and `@@index([walletTransactionId])` to `model Withdrawal`.
  - Document partial unique indexes and check constraints in `Deposit`, `DepositVerificationAttempt`, and `Wallet`.

- [ ] **Step 2: Create SQL migration `prisma/migrations/20261026160000_schema_integrity_hardening/migration.sql`**
  - Partial unique index on active `Deposit` (`PENDING`, `APPROVED`).
  - Partial unique index on active `DepositVerificationAttempt` (`SUBMITTING`, `AWAITING_PROVIDER`, `AMBIGUOUS`).
  - CHECK constraints on `Wallet.balance >= 0` and `Wallet.lockedBalance >= 0`.
  - `walletTransactionId` column on `Withdrawal` with index.

- [ ] **Step 3: Run `npx prisma generate`**
  - Generate updated Prisma client types.

---

### Task 2: Implement Row Locking and Ledger Output in `WalletService`
**Files:**
- Modify: `src/wallet/wallet.service.ts`

- [ ] **Step 1: Add row locking `lockWallet` helper and pessimistic lock in `applyWalletMutation`**
  - Before modifying balances, execute `SELECT id FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`.
- [ ] **Step 2: Update `moveBalanceToLocked`, `consumeLockedFunds`, `releaseLockedFunds` to expose `ledgerId`**
  - Return `{ ...serializedWallet, wallet: serializedWallet, ledgerId: result.ledgerId }` for seamless type and caller compatibility.

---

### Task 3: Link `walletTransactionId` in `WithdrawalsService`
**Files:**
- Modify: `src/withdrawals/withdrawals.select.ts`
- Modify: `src/withdrawals/withdrawals.service.ts`

- [ ] **Step 1: Add `walletTransactionId: true` to `withdrawalSelect`**
- [ ] **Step 2: Link `walletTransactionId` upon withdrawal creation in `createWithdrawal`**
  - Record the `WITHDRAW_REQUEST` transaction id on the withdrawal.
- [ ] **Step 3: Update `walletTransactionId` upon payout approval (`approveWithdrawal`) and marking paid (`markWithdrawalPaid`)**
  - Record the `WITHDRAW_PAID` transaction id on the withdrawal for instant reconciliation.
- [ ] **Step 4: Update `walletTransactionId` upon rejection (`rejectWithdrawal`)**
  - Record the `WITHDRAW_REFUND` transaction id on the withdrawal.

---

### Task 4: Update Mobile `WithdrawalModel`
**Files:**
- Modify: `d:/FILES/SELF/BINGO/friends-bingo-mobile/lib/src/features/wallet/withdrawals/data/models/withdrawal_model.dart`

- [ ] **Step 1: Add `walletTransactionId` field to `WithdrawalModel`**
- [ ] **Step 2: Parse `walletTransactionId` in `WithdrawalModel.fromJson`**
- [ ] **Step 3: Verify with `flutter analyze`**

---

### Task 5: Verification Gates
- [ ] **Step 1: Run `npm run build` in `FriendsBingo-backend`**
- [ ] **Step 2: Run `npm test -- src/deposits src/withdrawals` in `FriendsBingo-backend`**
- [ ] **Step 3: Run `flutter test test/features/wallet` in `friends-bingo-mobile`**
