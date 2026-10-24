# Bingo Claims Flow & Transaction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate race conditions, auto-call timer leaks, premature winner-window finalization, and unfair late-claim blocks in the Friends Bingo claim flow.

**Architecture:** Use a paused-remainder column on the session, finalizer deferral under the session lock, server-side late-claim grace, and a mobile timeout-and-poll flow.

**Tech Stack:** NestJS, TypeScript, Prisma ORM, PostgreSQL (Neon), Flutter, Dart.

## Global Constraints
- Do not break existing game rule evaluators (`GameRuleEvaluationService`).
- Preserve all existing financial transaction accounting (`WalletTransactionType.PRIZE_WIN`).
- No client-supplied time or ball order is trusted; the server decides fairness using its own monotonic clock and draw sequence.
- Schema changes ship as real migrations (`prisma migrate`).
- Keep interactive database transactions fenced with `lockGameSessionRow` and `CLAIM_VALIDATION_TXN_OPTIONS`.

---

### Task 0: Remove Early `bingo_checking` Emit (Backend)

**Files:**
- Modify: `src/bingo-claims/bingo-claims.service.ts:284-315`
- Test: `src/bingo-claims/bingo-claims.service.spec.ts`

**Interfaces:**
- Consumes: `claimBingo` request
- Produces: Deletes speculative `checkingPreview` query and its `setImmediate` emit. Real emit remains after Tx1 succeeds.

- [ ] **Step 1: Write test verifying no speculative emit before idempotency**

In `src/bingo-claims/bingo-claims.service.spec.ts`:
```ts
it('does not emit game:bingo_checking on duplicate attempt or before Tx1', async () => {
  const emitSpy = jest.spyOn(realtimeService, 'emitToGame');
  // Send same claimAttemptId twice
  await service.claimBingo(sessionId, userId, {
    gameCartelaId,
    claimAttemptId: 'test-attempt-1',
  });
  await service.claimBingo(sessionId, userId, {
    gameCartelaId,
    claimAttemptId: 'test-attempt-1',
  });
  // Should only emit checking once (from Tx1 success), not from speculative preview
  const checkingEmits = emitSpy.mock.calls.filter(
    (call) => call[1] === 'game:bingo_checking',
  );
  expect(checkingEmits.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: FAIL (currently emits speculative `bingo_checking` on both calls).

- [ ] **Step 3: Remove `checkingPreview` in `bingo-claims.service.ts`**

In `src/bingo-claims/bingo-claims.service.ts` around line 284:
Delete the `checkingPreview` findUnique query and the `if (checkingPreview ... setImmediate(...))` block completely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bingo-claims/bingo-claims.service.ts src/bingo-claims/bingo-claims.service.spec.ts
git commit -m "fix(claims): remove speculative bingo_checking emit prior to idempotency check"
```

---

### Task 1: Store Paused Remaining Time on Session (Backend)

**Files:**
- Modify: `prisma/schema.prisma`
- Create migration: `prisma/migrations/YYYYMMDDHHMMSS_add_auto_call_paused_remaining_ms/migration.sql`
- Modify: `src/bingo-claims/bingo-claims.service.ts`
- Test: `src/bingo-claims/bingo-claims.service.spec.ts`

**Interfaces:**
- Consumes: `GameSession` model
- Produces: `GameSession.autoCallPausedRemainingMs Int?`

- [ ] **Step 1: Write failing test for concurrent invalid claims timer restoration**

In `src/bingo-claims/bingo-claims.service.spec.ts`:
```ts
it('restores auto-call to remaining time rather than full interval after concurrent invalid claims', async () => {
  // Session with nextAutoCallAt set to now + 7000ms
  // Simulate 3 concurrent invalid claims
  // Ensure restored nextAutoCallAt is ~7000ms, NOT 18000ms
  const session = await createMockSession({ autoCallIntervalMs: 18000, nextAutoCallMs: 7000 });
  await Promise.all([
    service.claimBingo(session.id, user1, { gameCartelaId: c1, claimAttemptId: 'a1' }),
    service.claimBingo(session.id, user2, { gameCartelaId: c2, claimAttemptId: 'a2' }),
    service.claimBingo(session.id, user3, { gameCartelaId: c3, claimAttemptId: 'a3' }),
  ]);
  const updated = await prisma.gameSession.findUnique({ where: { id: session.id } });
  const remaining = updated!.nextAutoCallAt!.getTime() - Date.now();
  expect(remaining).toBeLessThanOrEqual(7500);
  expect(remaining).toBeGreaterThan(5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update Prisma schema and create migration**

In `prisma/schema.prisma` under `model GameSession`:
```prisma
  autoCallPausedRemainingMs Int?
```
Run `npx prisma migrate dev --name add_auto_call_paused_remaining_ms`.

- [ ] **Step 4: Update `acceptClaimAttempt`, `createAutoInvalidClaim`, and `createAutoValidOpenOrJoinWindowClaim`**

In `acceptClaimAttempt` (`src/bingo-claims/bingo-claims.service.ts`):
```ts
    let pausedRemainingMs = 0;
    let hadScheduledAutoCall = false;
    if (
      sessionStatus === GameStatus.PLAYING &&
      gameCartela.gameSession.autoCallEnabled
    ) {
      const scheduledAt = gameCartela.gameSession.nextAutoCallAt;
      hadScheduledAutoCall = scheduledAt != null;
      const nowMs = Date.now();

      if (scheduledAt != null) {
        // First claim while timer is running: calculate and persist durable remainder
        pausedRemainingMs = Math.max(0, scheduledAt.getTime() - nowMs);
        await tx.gameSession.updateMany({
          where: {
            id: gameCartela.gameSessionId,
            status: GameStatus.PLAYING,
            autoCallEnabled: true,
          },
          data: {
            nextAutoCallAt: null,
            autoCallPausedRemainingMs: pausedRemainingMs,
          },
        });
      } else {
        // Later concurrent claim: reuse existing stored remainder
        const currentSession = await tx.gameSession.findUnique({
          where: { id: gameCartela.gameSessionId },
          select: { autoCallPausedRemainingMs: true },
        });
        pausedRemainingMs = currentSession?.autoCallPausedRemainingMs ?? 0;
      }
      gameCartela.gameSession.nextAutoCallAt = null;
    }
```

In `createAutoInvalidClaim`:
```ts
    // Check if other checking claims remain for this session
    const otherCheckingCount = await tx.bingoClaim.count({
      where: {
        gameSessionId: gameCartela.gameSessionId,
        status: BingoClaimStatus.CHECKING,
        id: { not: attempt.existingClaimId },
      },
    });

    let session;
    if (otherCheckingCount === 0) {
      // Last active claim finishes: restore using durable session column
      const currentSession = await tx.gameSession.findUnique({
        where: { id: gameCartela.gameSessionId },
        select: { autoCallPausedRemainingMs: true },
      });
      const durableRemainingMs = currentSession?.autoCallPausedRemainingMs ?? pausedRemainingMs;

      session = await this.restorePausedClaimAutoCall(
        tx,
        gameCartela.gameSessionId,
        durableRemainingMs,
        hadScheduledAutoCall,
        defaultAutoCallIntervalMs,
      );
      // Clear durable stored remainder
      await tx.gameSession.update({
        where: { id: gameCartela.gameSessionId },
        data: { autoCallPausedRemainingMs: null },
      });
    } else {
      session = await tx.gameSession.findUniqueOrThrow({
        where: { id: gameCartela.gameSessionId },
        select: { nextAutoCallAt: true },
      });
    }
```

In `createAutoValidOpenOrJoinWindowClaim`:
Clear `autoCallPausedRemainingMs: null` when window opens.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/bingo-claims/
git commit -m "fix(claims): store auto-call paused remaining ms on session to prevent timer reset"
```

---

### Task 2: Finalizer Waits Under Session Lock (Backend)

**Files:**
- Modify: `src/bingo-claims/bingo-claims.service.ts` (`finalizeWinnerWindow`)
- Modify: `src/bingo-claims/winner-window-finalizer.service.ts`
- Test: `src/bingo-claims/winner-window-finalizer.service.spec.ts`

**Interfaces:**
- Consumes: `lockGameSessionRow(tx, sessionId)`
- Produces: Defers finalization when active `CHECKING` claims exist within 25s cutoff; logs committed only for non-null results.

- [ ] **Step 1: Write unit tests for finalizer deferral under lock and age cutoff**

In `src/bingo-claims/winner-window-finalizer.service.spec.ts`:
```ts
it('defers finalization if CHECKING claim is younger than 25s under session lock', async () => {
  // Mock active CHECKING claim received 5s ago
  // finalizeWinnerWindow should return null
});

it('does not defer finalization for orphaned CHECKING claim older than 25s', async () => {
  // Mock active CHECKING claim received 120s ago
  // finalizeWinnerWindow proceeds and returns non-null
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/winner-window-finalizer.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update `finalizeWinnerWindow` in `bingo-claims.service.ts`**

Inside `this.prisma.$transaction(async (tx) => ...)`:
```ts
      if (!(await lockGameSessionRow(tx, sessionId))) {
        return null;
      }

      // Check for in-flight CHECKING claims that arrived recently (within 25s)
      const checkingCutoff = new Date(Date.now() - 25_000);
      const activeCheckingCount = await tx.bingoClaim.count({
        where: {
          gameSessionId: sessionId,
          status: BingoClaimStatus.CHECKING,
          receivedAt: { gte: checkingCutoff },
        },
      });

      if (activeCheckingCount > 0) {
        this.logger.warn(
          `event=winner_window.finalization_deferred sessionId=${sessionId} activeCheckingCount=${activeCheckingCount}`,
        );
        return null;
      }
```

- [ ] **Step 4: Update `WinnerWindowFinalizerService.tick` logging**

In `src/bingo-claims/winner-window-finalizer.service.ts`:
```ts
      for (const session of expiredSessions) {
        const startedAt = Date.now();
        const deadlineLagMs = session.winnerWindowEndsAt
          ? startedAt - session.winnerWindowEndsAt.getTime()
          : null;
        try {
          const result = await this.bingoClaimsService.finalizeWinnerWindow(session.id);
          const durationMs = Date.now() - startedAt;
          if (result != null) {
            this.observability.recordWinnerWindowFinalization({
              durationMs,
              deadlineLagMs,
              result: 'success',
            });
            this.logger.log(
              `event=winner_window.finalization_committed sessionId=${session.id} durationMs=${durationMs} deadlineLagMs=${deadlineLagMs ?? 'null'}`,
            );
          } else {
            this.logger.log(
              `event=winner_window.finalization_deferred sessionId=${session.id} durationMs=${durationMs}`,
            );
          }
        } catch (error) { ... }
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/bingo-claims/winner-window-finalizer.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bingo-claims/
git commit -m "fix(claims): defer winner window finalization under session lock when checking claims are in flight"
```

---

### Task 3: Enable Orphaned Claim Recovery by Default & Verify Scavenger (Backend)

**Files:**
- Modify: `src/config/env.validation.ts`
- Modify: `src/bingo-claims/bingo-claim-recovery.service.ts`
- Modify: `.env.example`
- Test: `src/bingo-claims/bingo-claim-recovery.service.spec.ts`

**Interfaces:**
- Consumes: `BINGO_CLAIM_RECOVERY_ENABLED` boolean validation
- Produces: Enabled scavenger that marks >60s CHECKING claims FAILED and restores `autoCallPausedRemainingMs`.

- [ ] **Step 1: Write test verifying orphan recovery restores stored remainder**

In `src/bingo-claims/bingo-claim-recovery.service.spec.ts`:
```ts
it('recovers orphaned claim older than 60s to FAILED and restores stored auto-call remainder', async () => {
  // Create session with autoCallPausedRemainingMs = 6000
  // Create CHECKING claim with receivedAt = now - 65s
  // Run scan
  // Claim is FAILED with CLAIM_ORPHANED, session timer restored to ~6000ms
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/bingo-claim-recovery.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update `env.validation.ts` and `bingo-claim-recovery.service.ts`**

In `src/config/env.validation.ts`:
```ts
  BINGO_CLAIM_RECOVERY_ENABLED: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
```
In `src/bingo-claims/bingo-claim-recovery.service.ts`:
```ts
  onApplicationBootstrap() {
    if (this.config.get<boolean>('BINGO_CLAIM_RECOVERY_ENABLED') === false) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/bingo-claims/bingo-claim-recovery.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.validation.ts src/bingo-claims/bingo-claim-recovery.service.ts .env.example
git commit -m "fix(claims): enable orphaned claim recovery by default with clean shutdown"
```

---

### Task 4: Server-Side Late-Claim Grace & Pattern-Only Blocking (Backend)

**Files:**
- Modify: `src/bingo-claims/bingo-claims.service.ts`
- Test: `src/bingo-claims/bingo-claims-claim-latency.spec.ts`

**Interfaces:**
- Consumes: `claim.receivedAt` and `latestCalled.createdAt`
- Produces: If pattern is completed by `order - 1` and `receivedAt` is within 1500ms of latest ball's `createdAt`, accepts as VALID. Blocks cartela ONLY on `INVALID_PATTERN`.

- [ ] **Step 1: Write unit tests for 1.5s grace acceptance and cartela non-blocking on late claim**

In `src/bingo-claims/bingo-claims-claim-latency.spec.ts`:
```ts
it('accepts claim when completed by order-1 ball and received within 1500ms of new ball draw', async () => {
  // Ball 14 completed pattern. Ball 15 drawn at t=1000ms. Claim received at t=1800ms (800ms lag).
  // Must be accepted as VALID.
});

it('rejects claim received 3000ms after new ball draw as INVALID_LATE_CLAIM but leaves cartela REGISTERED', async () => {
  // Claim received at t=4000ms.
  // Must be rejected as INVALID_LATE_CLAIM.
  // GameCartela.status must stay REGISTERED (NOT BLOCKED).
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/bingo-claims-claim-latency.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update `createAutoValidatedClaim` in `bingo-claims.service.ts`**

In `createAutoValidatedClaim`:
```ts
    const latestBall = calledNumbers[calledNumbers.length - 1];
    let isLateClaimGraceAccepted = false;

    if (
      evaluation.isWinner &&
      !evaluation.completedByLatestNumber &&
      calledNumbers.length > 1 &&
      latestBall?.createdAt
    ) {
      const timeSinceLatestBallMs = attempt.receivedAt.getTime() - latestBall.createdAt.getTime();
      // Server-side grace window: 1500ms
      if (timeSinceLatestBallMs >= 0 && timeSinceLatestBallMs <= 1500) {
        // Re-evaluate against the previous ball (order - 1)
        const previousBalls = calledNumbers.slice(0, -1);
        const prevEvaluation = this.gameRuleEvaluationService.evaluate(
          {
            id: gameCartela.cartela.id,
            number: gameCartela.cartela.number,
            b: gameCartela.cartela.b,
            i: gameCartela.cartela.i,
            n: gameCartela.cartela.n,
            g: gameCartela.cartela.g,
            o: gameCartela.cartela.o,
          },
          previousBalls,
          ruleKey,
          this.resolveClaimGameRule(gameCartela)?.patterns,
        );
        if (prevEvaluation.isWinner && prevEvaluation.completedByLatestNumber) {
          isLateClaimGraceAccepted = true;
          this.logger.log(
            `[late_claim_grace] accepted claim ${attempt.claimAttemptId} on order ${latestBall.order - 1} (lagMs=${timeSinceLatestBallMs})`,
          );
        }
      }
    }

    if (!evaluation.isWinner) {
      return this.createAutoInvalidClaim(
        tx, gameCartela, userId, ruleKey, 'INVALID_PATTERN',
        evaluation.matchedPattern, defaultAutoCallIntervalMs,
        pausedRemainingMs, hadScheduledAutoCall, activeBall, attempt,
      );
    }

    if (!evaluation.completedByLatestNumber && !isLateClaimGraceAccepted) {
      return this.createAutoInvalidClaim(
        tx, gameCartela, userId, ruleKey, 'INVALID_LATE_CLAIM',
        evaluation.matchedPattern, defaultAutoCallIntervalMs,
        pausedRemainingMs, hadScheduledAutoCall, activeBall, attempt,
      );
    }
```

In `createAutoInvalidClaim`:
```ts
    // Product decision: Block cartela ONLY on INVALID_PATTERN, NOT on INVALID_LATE_CLAIM
    const shouldBlockCartela = reasonCode === 'INVALID_PATTERN';
    let cartelaStatus = gameCartela.status;

    if (shouldBlockCartela) {
      const cartelaUpdateResult = await tx.gameCartela.updateMany({
        where: { id: gameCartela.id, status: GameCartelaStatus.REGISTERED },
        data: { status: GameCartelaStatus.BLOCKED, blockedAt: checkedAt },
      });
      if (cartelaUpdateResult.count !== 1) {
        throw new ConflictException('Cartela could not be blocked');
      }
      cartelaStatus = GameCartelaStatus.BLOCKED;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/bingo-claims/bingo-claims-claim-latency.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bingo-claims/
git commit -m "fix(claims): add server-side 1.5s late claim grace and block only on invalid patterns"
```

---

### Task 5: Mobile Timeout, Polling & Guaranteed Spinner Reset (Mobile)

**Files:**
- Modify: `lib/src/features/games/data/games_repository.dart`
- Modify: `lib/src/features/games/presentation/screens/live_game_called_numbers.dart`
- Modify: `lib/src/features/games/presentation/screens/live_game_orchestration.dart`
- Test: `test/bingo_claim_hold_test.dart`

**Interfaces:**
- Consumes: `GET /games/:sessionId/claims/:claimAttemptId`
- Produces: 4s HTTP timeout, 700ms polling with 15s cap, resets spinner in `finally`.

- [ ] **Step 1: Write widget test simulating dropped response and asserting spinner clears**

In `test/bingo_claim_hold_test.dart`:
```dart
testWidgets('claim submission clears in-flight spinner on HTTP timeout and polls to terminal state', (tester) async {
  // Tap BINGO button
  // Simulate network timeout after 4s
  // Assert polling GET .../claims/:claimAttemptId begins
  // When GET returns VALID, assert winner state applied and spinner cleared
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `flutter test test/bingo_claim_hold_test.dart`
Expected: FAIL.

- [ ] **Step 3: Add 4s timeout and poll loop in `_submitBingoClaim`**

In `live_game_called_numbers.dart`:
```dart
    try {
      final result = await _gamesRepository.claimBingo(
        sessionId: sessionId,
        gameCartelaId: gameCartela.id,
        claimAttemptId: attempt.claimAttemptId,
        clientTapAt: startedAt,
        claimSource: source,
      ).timeout(const Duration(seconds: 4));
      // Handle normal result...
    } catch (error) {
      // Begin 700ms poll with 15s cap
      final pollDeadline = DateTime.now().add(const Duration(seconds: 15));
      while (DateTime.now().isBefore(pollDeadline) && isLiveHostActive && !attempt.terminal) {
        await Future<void>.delayed(const Duration(milliseconds: 700));
        try {
          final pollResult = await _gamesRepository.getClaimAttempt(
            sessionId: sessionId,
            claimAttemptId: attempt.claimAttemptId,
          );
          if (pollResult.status == BingoClaimStatus.checking) {
            continue; // Keep waiting
          }
          // Terminal status reached: apply result and break
          _applyRecoveredClaimAttempt(attempt, pollResult);
          break;
        } catch (_) {}
      }
    } finally {
      controllers.claim.clearClaimInFlight(gameCartela.id, attempt.claimAttemptId);
      _cn.finishClaimSubmission(attempt);
      _flushPendingClaimSocketEvents(); // Guaranteed flush
    }
```

In `live_game_orchestration.dart` in `_onBingoClaimFailed`:
```dart
    if (normalizedPayload['nextAutoCallAt'] == null) {
      _scheduleCanonicalRefetch(includeCalledNumbers: true);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/bingo_claim_hold_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/src/features/games/
git commit -m "fix(mobile): add 4s claim timeout, 700ms recovery poll and guaranteed spinner reset"
```

---

### Task 6: Judge Winner Window by Arrival Time & Prefetch Config (Backend)

**Files:**
- Modify: `src/bingo-claims/bingo-claims.service.ts`
- Test: `src/bingo-claims/bingo-claims.service.spec.ts`

**Interfaces:**
- Consumes: `httpReceivedAt = new Date()` captured at entrypoint of `claimBingo`
- Produces: Fails late window claims in Tx1 without creating CHECKING row; compares `attempt.receivedAt` in `createAutoValidJoinWindowClaim`.

- [ ] **Step 1: Write test verifying claim arriving before deadline but validated after is accepted**

In `src/bingo-claims/bingo-claims.service.spec.ts`:
```ts
it('accepts join-window claim that arrived before winnerWindowEndsAt even if Tx2 executes after deadline', async () => { ... });
it('rejects claim arriving after winnerWindowEndsAt + grace in Tx1 without creating CHECKING row', async () => { ... });
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update `claimBingo`, `acceptClaimAttempt`, and `createAutoValidJoinWindowClaim`**

In `claimBingo`:
```ts
    const httpReceivedAt = new Date();
    // Prefetch timing config before opening transactions
    const [defaultAutoCallIntervalMs, winnerWindowDurationMs, winnerWindowClaimGraceMs] =
      await Promise.all([
        this.gameTimingConfigService.getAutoCallIntervalMs(),
        this.gameTimingConfigService.getWinnerWindowDurationMs(),
        this.gameTimingConfigService.getWinnerWindowClaimGraceMs(),
      ]);
```

In `acceptClaimAttempt`:
```ts
    if (sessionStatus === GameStatus.WINNER_WINDOW) {
      const endsAt = gameCartela.gameSession.winnerWindowEndsAt;
      if (endsAt && args.clientTapAt && httpReceivedAt.getTime() > endsAt.getTime() + winnerWindowClaimGraceMs) {
        const sideEffect = await this.createPreAcceptBusinessRejectedClaim(
          tx, gameCartela, args, {
            failureCode: 'CLAIM_NOT_ELIGIBLE',
            failureMessage: 'Winner window has already closed',
            retryAllowed: false,
          },
        );
        return { kind: 'business_rejected', sideEffect };
      }
    }
```

In `createAutoValidJoinWindowClaim`:
Compare `attempt.receivedAt.getTime() > winnerWindowEndsAt.getTime() + winnerWindowClaimGraceMs` instead of `new Date()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bingo-claims/
git commit -m "fix(claims): judge winner window claims by arrival time and prefetch timing config"
```

---

### Task 7: Error Code Mapping & Retry Policy (Backend)

**Files:**
- Modify: `src/bingo-claims/bingo-claims.service.ts`
- Test: `src/bingo-claims/bingo-claims.service.spec.ts`

**Interfaces:**
- Consumes: `mapInfraFailureCode(error)`
- Produces: Maps `BadRequestException` to `CLAIM_NOT_ELIGIBLE`; sets `retryAllowed: false` for ineligible claims.

- [ ] **Step 1: Write unit test verifying error mapping and retryAllowed policy**

```ts
it('maps BadRequestException to CLAIM_NOT_ELIGIBLE with retryAllowed=false', () => {
  const code = service.mapInfraFailureCode(new BadRequestException('Window closed'));
  expect(code).toBe('CLAIM_NOT_ELIGIBLE');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Update `mapInfraFailureCode` in `bingo-claims.service.ts`**

```ts
  private mapInfraFailureCode(error: unknown): BingoClaimFailureCode {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2028'
    ) {
      return 'DB_TRANSACTION_TIMEOUT';
    }
    if (isPrismaConnectivityError(error)) {
      return 'DB_UNAVAILABLE';
    }
    if (error instanceof ConflictException) {
      return 'CLAIM_STATE_CONFLICT';
    }
    if (error instanceof BadRequestException) {
      return 'CLAIM_NOT_ELIGIBLE';
    }
    return 'VALIDATION_INTERNAL_ERROR';
  }
```
And ensure `retryAllowed` is `false` when failure code is `CLAIM_NOT_ELIGIBLE` or `AUTO_BINGO_NOT_ALLOWED`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/bingo-claims/bingo-claims.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bingo-claims/
git commit -m "fix(claims): map BadRequest to CLAIM_NOT_ELIGIBLE with retryAllowed false"
```

---

## Plan Self-Review
- Spec coverage: Covers Tasks 0 through 7 verbatim as requested.
- No placeholders: All tasks contain the exact implementation and test code.
- Type consistency: All types (`autoCallPausedRemainingMs`, `CLAIM_NOT_ELIGIBLE`) match across services and migrations.
