# Telebirr LOCAL_WITH_FALLBACK Circuit Breaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a seamless, robust circuit breaker for Telebirr deposits (`LOCAL_WITH_FALLBACK`): route deposits to Local receipt verification by default; upon reaching a configured threshold of upstream failures (HTTP 429 rate limits, 5xx server errors, timeouts) in a rolling window, seamlessly flip deposits to Verify.ET (`AUTOMATIC`) for a strictly configured duration with immutable timer, automatically reverting back to Local afterwards, with Admin Dashboard controls and a friendly "Try Again" mobile UX.

**Architecture:**
- **Database (`PostgreSQL / Prisma`):** Schema updates on `DepositApprovalConfig` (`fallbackThreshold`, `fallbackWindowMinutes`, `fallbackDurationMinutes`, `fallbackUntil`, `fallbackReason`) and a dedicated `DepositCircuitBreakerFailure` table for cluster-safe, restart-proof failure tracking.
- **Backend (`FriendsBingo-backend`):** State machine in `DepositApprovalConfigService` implementing strictly time-based routing (`LOCAL` when `now >= fallbackUntil`, `AUTOMATIC` when `now < fallbackUntil`) with non-extending timer, failure reporting endpoint, and admin force-reset.
- **Admin Dashboard (`friends_bingo_Admin`):** Config inputs for threshold/window/duration, live countdown alert when fallback is active, and "Force Reset to Local" button.
- **Mobile Client (`friends-bingo-mobile`):** Upstream failure detection (HTTP 429 / 5xx / timeouts) in `TelebirrReceiptPreviewService`, background reporting, and friendly "Telebirr is temporarily busy. Please tap Try Again in a moment." error with a "Try Again" action button.

**Global Constraints & Invariants:**
- Target Provider: `PaymentProvider.TELEBIRR` only. Existing modes (`LOCAL`, `AUTOMATIC`, `MANUAL`) remain 100% untouched.
- Foreign VPS Rule: The backend VPS is outside Ethiopia, so Ethio Telecom blocks it. **The backend server must NEVER call the Telebirr receipt web API directly.** All Telebirr receipt fetching is performed exclusively by the Flutter mobile client in Ethiopia.
- Seamless Upstream Tracking: Every upstream failure (HTTP 429, 5xx, timeout, lookup unavailability) counts towards the threshold, even if for the same transaction ref. User validation/input errors are NEVER counted.
- Timer Immutability: Once `fallbackUntil` is set, subsequent failure reports CANNOT extend the deadline. The fallback runs for its exact configured duration and then reverts.
- Mobile Copy: The user must never see internal references to Verify.ET, API credits, or fallback. Error message must be: `"Telebirr is temporarily busy. Please tap Try Again in a moment."` with button `"Try Again"`.

---

### Task 1: Database Schema & Migration
**Files:**
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/prisma/schema.prisma`
- Create: `d:/FILES/SELF/BINGO/FriendsBingo-backend/prisma/migrations/20261026170000_telebirr_auto_fallback/migration.sql`

**Interfaces:**
- Produces:
  - `DepositApprovalMode`: includes `LOCAL_WITH_FALLBACK`
  - `DepositApprovalConfig`: includes `fallbackThreshold`, `fallbackWindowMinutes`, `fallbackDurationMinutes`, `fallbackUntil`, `fallbackReason`
  - `DepositCircuitBreakerFailure`: `id`, `provider`, `transactionRef`, `userId`, `reason`, `createdAt` with `@@index([provider, createdAt])`

- [ ] **Step 1: Update `prisma/schema.prisma`**
Ensure `LOCAL_WITH_FALLBACK` is in `enum DepositApprovalMode`, update `DepositApprovalConfig`, and add `DepositCircuitBreakerFailure`:

```prisma
enum DepositApprovalMode {
  AUTOMATIC
  MANUAL
  LOCAL
  LOCAL_WITH_FALLBACK
}

model DepositApprovalConfig {
  provider                PaymentProvider      @id
  enabled                 Boolean              @default(true)
  approvalMode            DepositApprovalMode  @default(AUTOMATIC)
  fallbackThreshold       Int                  @default(2)
  fallbackWindowMinutes   Int                  @default(3)
  fallbackDurationMinutes Int                  @default(30)
  fallbackUntil           DateTime?
  fallbackReason          String?
  updatedAt               DateTime             @updatedAt
  updatedById             String?
}

model DepositCircuitBreakerFailure {
  id             String          @id @default(uuid())
  provider       PaymentProvider
  transactionRef String?
  userId         String?
  reason         String?
  createdAt      DateTime        @default(now())

  @@index([provider, createdAt])
}
```

- [ ] **Step 2: Create SQL migration `20261026170000_telebirr_auto_fallback/migration.sql`**
```sql
-- Add LOCAL_WITH_FALLBACK to DepositApprovalMode enum
ALTER TYPE "DepositApprovalMode" ADD VALUE IF NOT EXISTS 'LOCAL_WITH_FALLBACK';

-- Add circuit breaker configuration and state columns to DepositApprovalConfig
ALTER TABLE "DepositApprovalConfig"
ADD COLUMN IF NOT EXISTS "fallbackThreshold" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS "fallbackWindowMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS "fallbackDurationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS "fallbackUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "fallbackReason" TEXT;

-- Create DepositCircuitBreakerFailure table
CREATE TABLE IF NOT EXISTS "DepositCircuitBreakerFailure" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "transactionRef" TEXT,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositCircuitBreakerFailure_pkey" PRIMARY KEY ("id")
);

-- Index for querying failures within window
CREATE INDEX IF NOT EXISTS "DepositCircuitBreakerFailure_provider_createdAt_idx" ON "DepositCircuitBreakerFailure"("provider", "createdAt");
```

- [ ] **Step 3: Run `npx prisma generate`**
Run: `npx prisma generate` in `d:/FILES/SELF/BINGO/FriendsBingo-backend`.
Expected: Code generated successfully, exports `DepositCircuitBreakerFailure` and `DepositApprovalMode.LOCAL_WITH_FALLBACK`.

---

### Task 2: Backend Types, DTOs & Validation
**Files:**
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposit-approval-config/deposit-approval-config.types.ts`
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposit-approval-config/dto/update-deposit-approval-config.dto.ts`
- Create: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposits/dto/report-telebirr-lookup-failure.dto.ts`

- [ ] **Step 1: Update `deposit-approval-config.types.ts`**
Update `TELEBIRR_APPROVAL_MODES`, `DepositApprovalModeApi`, `toApiApprovalMode`, `fromApiApprovalMode`, and add circuit breaker fields to `DepositApprovalConfigRecord` and response interfaces:

```typescript
export const TELEBIRR_APPROVAL_MODES: DepositApprovalMode[] = [
  DepositApprovalMode.AUTOMATIC,
  DepositApprovalMode.MANUAL,
  DepositApprovalMode.LOCAL,
  DepositApprovalMode.LOCAL_WITH_FALLBACK,
];

export type DepositApprovalModeApi =
  | 'automatic'
  | 'manual'
  | 'local'
  | 'local_with_fallback';

export function toApiApprovalMode(mode: DepositApprovalMode): DepositApprovalModeApi {
  return mode.toLowerCase() as DepositApprovalModeApi;
}

export function fromApiApprovalMode(mode: DepositApprovalModeApi): DepositApprovalMode {
  return mode.toUpperCase() as DepositApprovalMode;
}

export interface DepositApprovalConfigRecord {
  provider: PaymentProvider;
  enabled: boolean;
  approvalMode: DepositApprovalMode;
  fallbackThreshold: number;
  fallbackWindowMinutes: number;
  fallbackDurationMinutes: number;
  fallbackUntil: Date | null;
  fallbackReason: string | null;
  updatedAt: Date;
  updatedById: string | null;
}

export interface AdminDepositApprovalConfigResponse {
  providers: Array<{
    provider: PaymentProvider;
    enabled: boolean;
    approvalMode: DepositApprovalModeApi;
    allowedModes: DepositApprovalModeApi[];
    fallbackThreshold?: number;
    fallbackWindowMinutes?: number;
    fallbackDurationMinutes?: number;
    fallbackUntil?: string | null;
    fallbackReason?: string | null;
    isFallbackActive?: boolean;
    updatedAt: string;
    updatedById: string | null;
  }>;
}

export interface PlayerDepositProviderApprovalConfig {
  key: PaymentProvider;
  enabled: boolean;
  approvalMode: DepositApprovalModeApi;
  configuredApprovalMode?: DepositApprovalModeApi;
  isFallbackActive?: boolean;
  fallbackUntil?: string | null;
}
```

- [ ] **Step 2: Update `update-deposit-approval-config.dto.ts`**
```typescript
  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  fallbackThreshold?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  fallbackWindowMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  fallbackDurationMinutes?: number;
```

- [ ] **Step 3: Create `report-telebirr-lookup-failure.dto.ts`**
```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportTelebirrLookupFailureDto {
  @ApiPropertyOptional({ example: '26032014112345' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @ApiPropertyOptional({ example: 'HTTP 429 rate limit' })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  reason?: string;
}
```

- [ ] **Step 4: Verify build with `npm run build`**
Run: `npm run build` in `FriendsBingo-backend`.
Expected: PASS.

---

### Task 3: Backend Circuit Breaker Engine & Service Logic (TDD)
**Files:**
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposit-approval-config/deposit-approval-config.service.ts`
- Create: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposit-approval-config/deposit-approval-config.service.spec.ts`

- [ ] **Step 1: Write unit tests in `deposit-approval-config.service.spec.ts`**
Cover:
1. Seamless failure trip: 2 failures within window trip the breaker to `AUTOMATIC`.
2. Timer immutability: reports arriving while breaker is `OPEN` do not extend `fallbackUntil`.
3. Duration expiration: once `fallbackUntil` has elapsed, `getMode` immediately returns `LOCAL`.
4. Admin reset: `resetFallback` restores `LOCAL` and clears state.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx jest src/deposit-approval-config/deposit-approval-config.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement circuit breaker logic in `DepositApprovalConfigService`**
Update `depositApprovalConfigSelect`:
```typescript
const depositApprovalConfigSelect = {
  provider: true,
  enabled: true,
  approvalMode: true,
  fallbackThreshold: true,
  fallbackWindowMinutes: true,
  fallbackDurationMinutes: true,
  fallbackUntil: true,
  fallbackReason: true,
  updatedAt: true,
  updatedById: true,
} satisfies Prisma.DepositApprovalConfigSelect;
```

Implement `getMode`, `getPlayerProviderConfigs`, `recordLookupFailure`, and `resetFallback`:
```typescript
  async getMode(provider: PaymentProvider): Promise<DepositApprovalMode> {
    const config = await this.getProviderConfig(provider);
    if (!config.enabled) {
      throw new BadRequestException(`${provider} deposits are currently unavailable.`);
    }

    if (config.approvalMode !== DepositApprovalMode.LOCAL_WITH_FALLBACK) {
      return config.approvalMode;
    }

    const now = Date.now();
    // OPEN state: routing to Verify.ET
    if (config.fallbackUntil && now < config.fallbackUntil.getTime()) {
      return DepositApprovalMode.AUTOMATIC;
    }

    // CLOSED state: routing to LOCAL
    return DepositApprovalMode.LOCAL;
  }

  async recordLookupFailure(params: {
    userId?: string;
    transactionRef?: string;
    reason?: string;
  }): Promise<{ tripped: boolean; fallbackUntil?: Date }> {
    const config = await this.getProviderConfig(PaymentProvider.TELEBIRR);
    if (config.approvalMode !== DepositApprovalMode.LOCAL_WITH_FALLBACK) {
      return { tripped: false };
    }

    const now = new Date();

    // TIMER IMMUTABILITY: If breaker is already active, NEVER extend fallbackUntil!
    if (config.fallbackUntil && now.getTime() < config.fallbackUntil.getTime()) {
      return { tripped: false, fallbackUntil: config.fallbackUntil };
    }

    // Record failure in database
    await this.prisma.depositCircuitBreakerFailure.create({
      data: {
        provider: PaymentProvider.TELEBIRR,
        transactionRef: params.transactionRef ? params.transactionRef.toUpperCase().trim() : null,
        userId: params.userId ?? null,
        reason: params.reason?.slice(0, 250) ?? 'Receipt lookup failure',
      },
    });

    // Count upstream failures in rolling window
    const windowStart = new Date(now.getTime() - config.fallbackWindowMinutes * 60_000);
    const failureCount = await this.prisma.depositCircuitBreakerFailure.count({
      where: {
        provider: PaymentProvider.TELEBIRR,
        createdAt: { gte: windowStart },
      },
    });

    if (failureCount >= config.fallbackThreshold) {
      const fallbackUntil = new Date(now.getTime() + config.fallbackDurationMinutes * 60_000);
      await this.prisma.depositApprovalConfig.update({
        where: { provider: PaymentProvider.TELEBIRR },
        data: {
          fallbackUntil,
          fallbackReason: `${failureCount} upstream failures in ${config.fallbackWindowMinutes}m window`,
        },
      });

      this.invalidateCache();
      return { tripped: true, fallbackUntil };
    }

    return { tripped: false };
  }

  async resetFallback(provider: PaymentProvider, actorId: string): Promise<AdminDepositApprovalConfigResponse> {
    await this.prisma.depositApprovalConfig.update({
      where: { provider },
      data: {
        fallbackUntil: null,
        fallbackReason: null,
      },
    });

    await this.prisma.depositCircuitBreakerFailure.deleteMany({
      where: { provider },
    });

    this.invalidateCache();
    await this.auditLogService.create(this.prisma, {
      actorId,
      action: 'admin.deposit_config.reset_fallback',
      entity: 'DepositApprovalConfig',
      entityId: provider,
      metadata: { provider },
    });

    return this.getAdminConfig();
  }
```

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx jest src/deposit-approval-config/deposit-approval-config.service.spec.ts`
Expected: PASS.

---

### Task 4: Backend Controller Endpoints & Deposit Flow Integration
**Files:**
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposits/deposits.controller.ts`
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/deposits/deposits.service.ts`
- Modify: `d:/FILES/SELF/BINGO/FriendsBingo-backend/src/admin/admin.controller.ts`

- [ ] **Step 1: Add failure reporting endpoint in `deposits.controller.ts`**
```typescript
  @Post('telebirr-lookup-failure')
  @ApiOperation({ summary: 'Report Telebirr receipt preview/lookup failure' })
  reportTelebirrLookupFailure(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReportTelebirrLookupFailureDto,
  ) {
    return this.depositsService.reportTelebirrLookupFailure(user.id, dto);
  }
```

- [ ] **Step 2: Update `deposits.service.ts`**
```typescript
  async reportTelebirrLookupFailure(userId: string, dto: ReportTelebirrLookupFailureDto) {
    const result = await this.depositApprovalConfigService.recordLookupFailure({
      userId,
      transactionRef: dto.transactionRef,
      reason: dto.reason,
    });
    return {
      success: true,
      fallbackActivated: result.tripped,
    };
  }
```
In `createLocalTelebirrDeposit`:
- On `!validation.ok`: if `validation.errorCode === 'VERIFICATION_UNAVAILABLE'`, call `recordLookupFailure` and throw user-friendly exception. Note: **The server does NOT call Telebirr API directly**, respecting foreign VPS IP blocking!

- [ ] **Step 3: Add reset endpoint in `admin.controller.ts`**
```typescript
  @Post('deposit-config/telebirr/reset-fallback')
  @ApiOperation({ summary: 'Force reset Telebirr fallback back to Local' })
  resetTelebirrFallback(@CurrentUser() user: AuthenticatedUser) {
    return this.depositApprovalConfigService.resetFallback(
      PaymentProvider.TELEBIRR,
      user.id,
    );
  }
```

- [ ] **Step 4: Run backend tests and verify build**
Run: `npm test` and `npm run build` in `FriendsBingo-backend`.
Expected: PASS.

---

### Task 5: Mobile App Failure Detection & Clean "Try Again" UX
**Files:**
- Modify: `d:/FILES/SELF/BINGO/friends-bingo-mobile/lib/src/features/wallet/deposits/data/models/deposit_config_model.dart`
- Modify: `d:/FILES/SELF/BINGO/friends-bingo-mobile/lib/src/features/wallet/deposits/data/repositories/deposits_repository.dart`
- Modify: `d:/FILES/SELF/BINGO/friends-bingo-mobile/lib/src/features/wallet/deposits/data/services/telebirr_receipt_preview_service.dart`
- Modify: `d:/FILES/SELF/BINGO/friends-bingo-mobile/lib/src/features/wallet/deposits/application/controllers/deposit_controller.dart`

- [ ] **Step 1: Update `deposit_config_model.dart`**
Add `isLocalOrFallback` helper:
```dart
bool get isLocalOrFallback => approvalMode == 'local' || approvalMode == 'local_with_fallback';
```

- [ ] **Step 2: Add `reportLookupFailure` to `deposits_repository.dart`**
```dart
  Future<void> reportLookupFailure({
    String? transactionRef,
    String? reason,
  }) async {
    try {
      await _client.post(
        '/deposits/telebirr-lookup-failure',
        data: {
          if (transactionRef != null) 'transactionRef': transactionRef,
          if (reason != null) 'reason': reason,
        },
      );
    } catch (_) {
      // Best-effort reporting; never block player UI
    }
  }
```

- [ ] **Step 3: Update `telebirr_receipt_preview_service.dart`**
Catch HTTP 429, 5xx, and connection timeouts, and trigger reporting:
```dart
      if (error is DioException) {
        final statusCode = error.response?.statusCode;
        if (statusCode == 429 ||
            (statusCode != null && statusCode >= 500) ||
            error.type == DioExceptionType.connectionTimeout ||
            error.type == DioExceptionType.receiveTimeout) {
          TelebirrDepositDebug.log('upstream rate-limit or timeout detected: ${error.type.name} (code: $statusCode)');
        }
      }
```

- [ ] **Step 4: Update `deposit_controller.dart` error copy**
When `code == 'VERIFICATION_UNAVAILABLE'`:
```dart
        confirmation: DepositConfirmationState(
          kind: DepositConfirmationKind.rejected,
          message: code == 'VERIFICATION_UNAVAILABLE'
              ? 'Telebirr is temporarily busy. Please tap Try Again in a moment.'
              : displayMessage,
          provider: provider,
          amount: amount,
          transactionRef: rawTransactionInput.toUpperCase(),
          canRetry: true,
        ),
```
Ensure retry button displays `"Try Again"`.

- [ ] **Step 5: Run mobile tests and analyzer**
Run: `flutter analyze` and `flutter test test/features/wallet` in `friends-bingo-mobile`.
Expected: PASS.

---

### Task 6: Admin Dashboard UI & Controls
**Files:**
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/lib/api/types.ts`
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/lib/api/admin.ts`
- Modify: `D:/FILES/SELF/BINGO/friends_bingo_Admin/components/admin/deposit-config-management.tsx`

- [ ] **Step 1: Update `types.ts` in Admin**
Add `'local_with_fallback'` to `DepositApprovalModeApi`, and include circuit breaker properties on the config type.

- [ ] **Step 2: Add `resetTelebirrFallback` to `admin.ts`**
```typescript
export async function resetTelebirrFallback(): Promise<AdminDepositApprovalConfigResponse> {
  const { data } = await apiClient.post<AdminDepositApprovalConfigResponse>(
    '/admin/deposit-config/telebirr/reset-fallback'
  );
  return data;
}
```

- [ ] **Step 3: Update `deposit-config-management.tsx`**
- In mode dropdown for Telebirr: add `<option value="local_with_fallback">Local (Auto-Fallback to Verify.ET)</option>`.
- When `local_with_fallback` is selected, render inputs for Failure Threshold, Window Minutes, and Duration Minutes.
- When `config.isFallbackActive` is true:
  - Render amber banner: `⚠️ Telebirr Fallback Active: Temporarily routing deposits to Verify.ET (Ends in MM:SS)`.
  - Render `[Force Reset to Local Now]` button calling `resetTelebirrFallback()`.

---

### Task 7: End-to-End Verification Gate
- [ ] **Step 1: Run `npm run build` in `FriendsBingo-backend`**
- [ ] **Step 2: Run all backend tests (`npm test`)**
- [ ] **Step 3: Run `flutter analyze` and `flutter test` in `friends-bingo-mobile`**
