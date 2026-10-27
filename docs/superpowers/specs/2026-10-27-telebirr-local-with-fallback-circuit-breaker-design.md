# Spec: Telebirr LOCAL_WITH_FALLBACK Deposit Circuit Breaker

- **Date:** 2026-10-27 (Revision 4 - Seamless Upstream Failure Counter)
- **Status:** Approved
- **Target Subsystems:** `FriendsBingo-backend`, `friends-bingo-mobile`, `friends_bingo_Admin`

---

## 1. Core Operating Principles

### 1.1 Seamless Upstream Failure Tracking
- **What counts as a failure:**
  - Upstream infrastructure errors ONLY: HTTP 429 (rate limit), 5xx server errors, network connection/read timeouts, or receipt lookup unavailability.
  - User-based errors (invalid transaction code format, wrong amount, mismatch) are **NEVER** recorded as circuit breaker failures.
- **No artificial deduplication or user-distinct constraints:**
  - If Telebirr is rate-limiting, even if the same user attempts the same transaction code twice, each 429/timeout hit represents a real infrastructure failure.
  - Every upstream failure counts towards `fallbackThreshold` so the system flips **seamlessly and promptly** to `AUTOMATIC` without friction.

### 1.2 Timer Immutability (Zero Abuse / Never Extends)
- While the breaker is in `OPEN` state (`now < fallbackUntil`):
  - Incoming failure reports are saved for audit/telemetry, but **NEVER extend `fallbackUntil`**.
  - The fallback duration runs for its exact configured window (e.g. 15 or 30 minutes).
  - The moment `fallbackUntil` elapses, the system immediately reverts to `LOCAL`.

### 1.3 The Foreign VPS Constraint
- The backend server is hosted on a VPS outside Ethiopia. Ethio Telecom blocks foreign IP addresses from querying the Telebirr public receipt web endpoint.
- **The backend server must NEVER call the Telebirr receipt web API directly.**
- All receipt fetching and preview occurs on the Flutter mobile app on player devices inside Ethiopia.
- When mobile preview encounters rate limiting (HTTP 429) or 5xx/timeout, it reports the failure to the backend.

### 1.4 Zero Impact on Existing Modes
- Existing modes (`AUTOMATIC`, `LOCAL`, `MANUAL`) remain 100% untouched.
- `LOCAL_WITH_FALLBACK` is a dedicated option for Telebirr only.

---

## 2. Database Schema

### `prisma/schema.prisma`

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
  fallbackThreshold       Int                  @default(2)      // Failures to trip (e.g. 2)
  fallbackWindowMinutes   Int                  @default(3)      // Rolling time window (e.g. 3m)
  fallbackDurationMinutes Int                  @default(30)     // Fallback duration in minutes
  fallbackUntil           DateTime?                             // When open, timestamp when fallback ends
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

---

## 3. Backend Service Logic (`DepositApprovalConfigService`)

### 3.1 Mode Resolution (`getMode`)
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
  if (config.fallbackUntil && now < config.fallbackUntil.getTime()) {
    return DepositApprovalMode.AUTOMATIC;
  }

  return DepositApprovalMode.LOCAL;
}
```

### 3.2 Failure Recording with Timer Immutability
```typescript
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

  // Record failure event in database
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
```

### 3.3 Admin Reset Handler
```typescript
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

---

## 4. Mobile Application Specifications

- Upstream failure detection: when preview encounters HTTP 429, 5xx, or network timeout, it calls `POST /deposits/telebirr-lookup-failure`.
- Error UX Copy: When a deposit fails with `VERIFICATION_UNAVAILABLE`, the message shown is:
  > **"Telebirr is temporarily busy. Please tap Try Again in a moment."**
  with button **"Try Again"**.
- Subsequent submission: when breaker is active, backend `GET /deposits/config` returns `approvalMode: 'automatic'`. Retrying routes directly through Verify.ET seamlessly.

---

## 5. Admin Dashboard Specifications

- Allows selecting `Local (Auto-Fallback to Verify.ET)` for Telebirr.
- Configures `fallbackThreshold`, `fallbackWindowMinutes`, and `fallbackDurationMinutes`.
- Shows live countdown banner when fallback is active with `[Force Reset to Local Now]` button.
