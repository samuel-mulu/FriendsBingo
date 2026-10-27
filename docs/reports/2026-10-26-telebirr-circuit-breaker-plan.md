# Telebirr Local-to-Automatic Fallback Circuit Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a configurable circuit breaker for Telebirr deposits: give priority to Local receipt verification, and upon reaching configurable failure thresholds (e.g. rate limit HTTP 429 / timeouts), automatically fall back to Verify.ET (Automatic) for a configurable duration (default 30 min), self-healing back to Local afterwards, with full Admin Dashboard controls and an in-flight mobile retry banner.

**Architecture:**
1. **Backend (`FriendsBingo-backend`):**
   - Extend `DepositApprovalConfig` schema with circuit breaker fields (`fallbackThreshold`, `fallbackWindowMinutes`, `fallbackDurationMinutes`, `fallbackUntil`, `fallbackReason`).
   - Add `LOCAL_WITH_FALLBACK` to `DepositApprovalMode` enum.
   - Implement `CircuitBreaker` logic in `DepositApprovalConfigService`: rolling window failure count, auto-tripping, self-healing time check, manual force reset, and admin realtime broadcast.
   - Expose client failure reporting endpoint `POST /deposits/telebirr-lookup-failure` and admin reset endpoint `POST /admin/deposit-config/telebirr/reset-fallback`.
2. **Admin Dashboard (`friends_bingo_Admin`):**
   - Update TypeScript API definitions for approval modes and circuit breaker config.
   - In `DepositConfigManagement`, add `Local (Auto-Fallback to Verify.ET)` dropdown option.
   - Display 3 numeric inputs: Failure Threshold (failures), Failure Window (minutes), Fallback Duration (minutes).
   - Render live countdown banner when fallback is active with `[Force Reset to Local Now]` button.
3. **Mobile Client (`friends-bingo-mobile`):**
   - Update deposit config model to recognize `local_with_fallback`.
   - Update preview service to tag HTTP 429 rate limits and connection timeouts.
   - When preview encounters rate limit/timeout, report failure to backend, display inline warning banner, and update submit button to "Verify Automatically Now" to verify via Verify.ET in one tap.

**Tech Stack:** NestJS, Prisma ORM, PostgreSQL, Next.js / React / Tailwind (Admin), Flutter / Riverpod / Dio (Mobile).

---

### Task 1: Backend Database Schema & Migration
**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261026170000_telebirr_auto_fallback/migration.sql`

- [ ] **Step 1: Update `prisma/schema.prisma`**
  - Add `LOCAL_WITH_FALLBACK` to `enum DepositApprovalMode`.
  - Add `fallbackThreshold Int @default(2)`, `fallbackWindowMinutes Int @default(3)`, `fallbackDurationMinutes Int @default(30)`, `fallbackUntil DateTime?`, `fallbackReason String?` to `model DepositApprovalConfig`.
- [ ] **Step 2: Create SQL migration `20261026170000_telebirr_auto_fallback/migration.sql`**
  - Add `LOCAL_WITH_FALLBACK` value to `DepositApprovalMode` enum.
  - Add columns with `IF NOT EXISTS` to `DepositApprovalConfig`.
- [ ] **Step 3: Run `npx prisma generate`**
  - Update Prisma Client.

---

### Task 2: Backend Circuit Breaker Engine & API Endpoints
**Files:**
- Modify: `src/deposit-approval-config/deposit-approval-config.types.ts`
- Modify: `src/deposit-approval-config/deposit-approval-config.service.ts`
- Modify: `src/deposit-approval-config/dto/update-deposit-approval-config.dto.ts`
- Modify: `src/deposits/deposits.controller.ts`
- Modify: `src/deposits/deposits.service.ts`
- Modify: `src/admin/admin.controller.ts`
- Create: `src/deposit-approval-config/deposit-approval-config.service.spec.ts`

- [ ] **Step 1: Update types and DTOs with circuit breaker fields**
- [ ] **Step 2: Implement circuit breaker logic in `DepositApprovalConfigService`**
  - `getMode`: If `LOCAL_WITH_FALLBACK` and `now < fallbackUntil`, return `AUTOMATIC`; else return `LOCAL`.
  - `recordLookupFailure`: Record failure in rolling window; trip fallback if threshold reached.
  - `forceResetFallback`: Clear `fallbackUntil` and restore `LOCAL`.
- [ ] **Step 3: Add failure reporting endpoint in `deposits.controller.ts` and reset endpoint in `admin.controller.ts`**
- [ ] **Step 4: Write unit tests in `deposit-approval-config.service.spec.ts`**
- [ ] **Step 5: Run tests and verify build (`npm test`, `npm run build`)**

---

### Task 3: Admin Dashboard UI & Controls (`friends_bingo_Admin`)
**Files:**
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/lib/api/types.ts`
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/lib/api/admin.ts`
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/components/admin/deposit-config-management.tsx`

- [ ] **Step 1: Update `types.ts` to include `local_with_fallback` and circuit breaker fields**
- [ ] **Step 2: Add `resetTelebirrFallback` in `admin.ts`**
- [ ] **Step 3: Update `deposit-config-management.tsx`**
  - Add mode label: `local_with_fallback: "Local (Auto-Fallback to Verify.ET)"`.
  - Render 3 inputs when `local_with_fallback` is selected.
  - Render active fallback banner with live countdown and reset button.

---

### Task 4: Mobile App Inline Fallback & Retry Experience (`friends-bingo-mobile`)
**Files:**
- Modify: `lib/src/features/wallet/deposits/data/models/deposit_config_model.dart`
- Modify: `lib/src/features/wallet/deposits/data/services/telebirr_receipt_preview_service.dart`
- Modify: `lib/src/features/wallet/deposits/data/repositories/deposits_repository.dart`
- Modify: `lib/src/features/wallet/deposits/domain/utils/deposit_submission_preparer.dart`
- Modify: `lib/src/features/wallet/deposits/application/controllers/deposit_controller.dart`
- Modify: `lib/src/features/wallet/deposits/presentation/widgets/deposit_sections.dart`

- [ ] **Step 1: Update `deposit_config_model.dart` to support `local_with_fallback`**
- [ ] **Step 2: Enhance `telebirr_receipt_preview_service.dart` to detect HTTP 429 and timeouts**
- [ ] **Step 3: Add `reportLookupFailure` in `deposits_repository.dart`**
- [ ] **Step 4: Update `deposit_submission_preparer.dart` & `deposit_controller.dart`**
  - Detect lookup failure, report to backend, display inline warning banner, and switch submit button to "Verify Automatically Now".
- [ ] **Step 5: Run mobile tests and analyzer (`flutter analyze`, `flutter test test/features/wallet`)**

---

### Task 5: End-to-End Verification Gate
- [ ] **Step 1: Run `npm run build` in `FriendsBingo-backend`**
- [ ] **Step 2: Run all backend tests (`npm test`)**
- [ ] **Step 3: Run `flutter analyze` and `flutter test` in `friends-bingo-mobile`**
