# Phase 1: Game Operations Engine Stabilization - Summary

**Date:** June 27, 2026  
**Status:** ✅ Complete  
**Goal:** Stabilize and document existing engine without changing behavior

---

## What Was Delivered

### 1. Lifecycle Documentation ✅

**File:** `docs/game-operations-lifecycle.md`

**Contents:**
- Core concepts (GameSlot vs GameSession, source of truth)
- The confusing NEXT + READY state explained
- Registration flow (AUTO, MANUAL, Big Game)
- Live game flow (start, bingo, validate, finalize)
- Post-game flow (queue restoration, next registration)
- Current operations selection logic
- Big Game priority rules
- Bonus Game rules
- Cancellation flow
- Invariants (expected to always be true)
- Common confusion points
- Debugging tips

**Key Clarifications:**
- GameSession.status is canonical source of truth
- GameSlot.status is derivative/helper field
- Slot can be NEXT while session is READY (expected and correct)
- Queue is a view of GameSlot records, not a separate entity
- Registration targets GameSession, not GameSlot

---

### 2. Debug Lifecycle Logger ✅

**File:** `src/games/game-lifecycle-debug-logger.service.ts`

**Features:**
- Only logs when `GAME_LIFECYCLE_DEBUG=true` or `NODE_ENV=development`
- Structured log format: `[GameFlow] event=... slotId=... sessionId=...`
- Does NOT log personal data (user IDs, wallet amounts)

**Events Logged:**
- `session_created` - when session is created, with reason
- `session_status_changed` - status transitions
- `slot_status_changed` - slot status updates
- `registration_opened` - registration opens
- `game_started` - game starts (auto or manual)
- `queue_restored` - slot restored to queue
- `registration_candidate_selected` - which session/slot selected for registration
- `current_operations_built` - operations/current response
- `scheduler_tick` - scheduler tick summary
- `queue_head_selected` - queue head selection
- `due_big_game_blocked` - Big Game blocks normal start

**Usage:**
```typescript
constructor(
  private readonly lifecycleLogger: GameLifecycleDebugLogger,
) {}

this.lifecycleLogger.sessionCreated({
  sessionId: session.id,
  slotId: slot.id,
  slotStatus: slot.status,
  sessionStatus: session.status,
  category: slot.category,
  operationMode: slot.operationMode,
  reason: 'post_game_opener',
  scheduledStartAt: session.scheduledStartAt,
});
```

---

### 3. Invariant Checks ✅

**File:** `src/games/game-operation-invariants.service.ts`

**Features:**
- Non-destructive checks (logs warnings, does not crash production)
- Throws in test environment for strict validation
- Enabled when `GAME_INVARIANTS_CHECK=true` or `NODE_ENV=development/test`

**Invariants Checked:**
1. **atMostOneActiveSession** - At most one PLAYING/CHECKING/WINNER_WINDOW session globally
2. **readySessionsHaveSlots** - READY sessions must have valid slots (not cancelled)
3. **noBigGameInNormalQueue** - Big Game excluded from normal queue queries (informational)
4. **noTerminalSessionsAsRegistrationCandidates** - FINISHED/CANCELLED sessions not in READY status
5. **dueBigGameBlocksLowerPriority** - Due Big Game blocks normal game starts

**Usage:**
```typescript
constructor(
  private readonly invariantsService: GameOperationInvariantsService,
) {}

// Check all invariants
const allPassed = await this.invariantsService.assertGameOperationInvariants();

// Check specific invariant
const passed = await this.invariantsService.checkInvariant('atMostOneActiveSession');
```

**Behavior:**
- **Development:** Logs warnings
- **Test:** Throws errors
- **Production:** Logs warnings (does not crash)

---

### 4. Expected Behavior Tests ✅

**File:** `src/games/game-operations-expected-behavior.spec.ts`

**Purpose:** Lock down intended behavior without requiring refactoring

**Test Categories:**

#### Source of Truth
- ✅ GameSession.status is canonical
- ✅ GameSlot.status is derivative

#### NEXT Slot + READY Session State
- ✅ Slot can be NEXT while session is READY (expected)
- ✅ Slot transitions to PLAYING when session starts

#### operations/current Behavior
- ✅ Returns READY session as registrationOpenGame
- ✅ Returns NEXT slot when no READY session exists

#### Queue Behavior
- ✅ Normal queue excludes Big Game
- ✅ Queue is ordered by sortOrder ASC

#### Big Game Priority
- ✅ Due Big Game blocks normal game start
- ✅ Future Big Game does not block normal queue

#### Session Lifecycle
- ✅ FINISHED session does not remain registration candidate
- ✅ Only one live session can exist

#### Invariant Checks
- ✅ Passes atMostOneActiveSession invariant
- ✅ Fails when multiple active sessions exist
- ✅ Passes readySessionsHaveSlots invariant
- ✅ Passes noTerminalSessionsAsRegistrationCandidates invariant

#### Documentation Alignment
- ✅ Documents GameSession as source of truth
- ✅ Documents NEXT + READY confusing state
- ✅ Documents queue as view, not entity

---

## What Was NOT Changed

### No Service Splitting ✅
- Did NOT create GameSessionFactory
- Did NOT create GameOperationsService
- Did NOT split GameLifecycleService
- Did NOT add database triggers
- Did NOT refactor existing services

### No Behavior Changes ✅
- Did NOT change registration flow
- Did NOT change queue logic
- Did NOT change status transitions
- Did NOT change Big Game priority
- Did NOT change operations/current selection

### No Product Changes ✅
- Did NOT change Flutter app
- Did NOT change Admin UI
- Did NOT change business rules
- Did NOT change API contracts

---

## How to Use

### Enable Debug Logging

**Development (automatic):**
```bash
# Already enabled in development
npm run start:dev
```

**Production (opt-in):**
```bash
GAME_LIFECYCLE_DEBUG=true npm run start:prod
```

**Logs will show:**
```
[GameFlow] event=session_created slotId=abc sessionId=xyz slotStatus=NEXT sessionStatus=READY category=NORMAL operationMode=AUTO reason=post_game_opener scheduledStartAt=2026-06-27T10:30:00.000Z
[GameFlow] event=game_started sessionId=xyz slotId=abc category=NORMAL operationMode=AUTO reason=scheduler_auto hadReadySession=true
[GameFlow] event=queue_restored slotId=abc result=requeued newSortOrder=99 reason=session_finished
```

---

### Enable Invariant Checks

**Development (automatic):**
```bash
# Already enabled in development
npm run start:dev
```

**Production (opt-in):**
```bash
GAME_INVARIANTS_CHECK=true npm run start:prod
```

**Test (automatic):**
```bash
# Invariants throw errors in tests
npm run test
```

**Manual check:**
```typescript
import { GameOperationInvariantsService } from './game-operation-invariants.service';

// In any service
const allPassed = await this.invariantsService.assertGameOperationInvariants();
if (!allPassed) {
  this.logger.warn('Game operation invariants violated - check logs');
}
```

---

### Run Expected Behavior Tests

```bash
npm run test -- game-operations-expected-behavior.spec.ts
```

**Expected output:**
```
PASS  src/games/game-operations-expected-behavior.spec.ts
  Game Operations - Expected Behavior (Current Implementation)
    Source of Truth
      ✓ GameSession.status is the canonical source of truth
      ✓ GameSlot.status is derivative and synchronized from session
    NEXT Slot + READY Session State
      ✓ Slot can be NEXT while session is READY (expected and correct)
      ✓ Slot transitions to PLAYING when session starts
    operations/current Behavior
      ✓ returns READY session as registrationOpenGame
      ✓ returns NEXT slot as registrationOpenGame when no READY session exists
    ...
```

---

## Integration Points

### Where to Add Debug Logging

**Already identified locations (not yet integrated):**

1. **PostGameRegistrationOpenerService.openNextAutoQueueRegistration()**
   - Log: `registration_opened` when session created
   - Log: `queue_head_selected` when queue head picked

2. **GameEngineService.startGame()**
   - Log: `game_started` when session transitions to PLAYING
   - Log: `session_status_changed` for READY → PLAYING

3. **GameLifecycleService.cancelSession()**
   - Log: `session_status_changed` for ANY → CANCELLED
   - Log: `queue_restored` when slot restored

4. **GamesService.resolveRegistrationSessionForSlot()**
   - Log: `session_created` when MANUAL session created
   - Log: `registration_opened` when registration opens

5. **GamesService.getCurrentOperations()**
   - Log: `current_operations_built` with summary
   - Log: `registration_candidate_selected` with selected item

6. **GameAutoStartSchedulerService.tick()**
   - Log: `scheduler_tick` with summary
   - Log: `game_started` when auto-starting

7. **GameQueueService.restoreSlotAfterSession()**
   - Log: `queue_restored` with result

**Integration is left for Phase 2 to avoid changing existing code.**

---

### Where to Add Invariant Checks

**Recommended locations (not yet integrated):**

1. **After session creation** - check readySessionsHaveSlots
2. **After status transition** - check atMostOneActiveSession
3. **In getCurrentOperations** - check all invariants
4. **In scheduler tick** - check dueBigGameBlocksLowerPriority
5. **In tests** - check all invariants after each operation

**Integration is left for Phase 2 to avoid changing existing code.**

---

## Success Criteria Met ✅

### Documentation
✅ Current engine behavior is documented  
✅ Confusing NEXT + READY state is explained  
✅ All lifecycle flows are documented  
✅ Common confusion points are addressed  

### Debug Logging
✅ Logger service created  
✅ All relevant events defined  
✅ Structured log format  
✅ No personal data logged  
✅ Only enabled in development or opt-in  

### Invariant Checks
✅ Invariant service created  
✅ All key invariants defined  
✅ Non-destructive (logs warnings)  
✅ Throws in test environment  
✅ Can check individual invariants  

### Tests
✅ Expected behavior tests created  
✅ Tests document current behavior  
✅ Tests lock down intended behavior  
✅ Tests align with documentation  
✅ No refactoring required to pass  

### No Changes
✅ No service splitting  
✅ No behavior changes  
✅ No product changes  
✅ No risk to working flow  

---

## Next Steps (Phase 2+)

### Integration
- Add debug logging to identified locations
- Add invariant checks to identified locations
- Run invariant checks in CI/CD pipeline
- Monitor logs in production

### Consolidation (Future)
- Create GameSessionFactory (consolidate session creation)
- Create single queue head selector (consolidate priority logic)
- Move all transitions to GameLifecycleService
- Add database trigger for slot status sync
- Remove deprecated getCurrentLiveSession

### Testing (Future)
- Add integration tests for full lifecycle
- Add tests for all transition paths
- Add tests for all queue operations
- Add tests for Big Game priority

---

## Files Created

1. `docs/game-operations-lifecycle.md` - Comprehensive lifecycle documentation
2. `src/games/game-lifecycle-debug-logger.service.ts` - Debug logger
3. `src/games/game-operation-invariants.service.ts` - Invariant checker
4. `src/games/game-operations-expected-behavior.spec.ts` - Behavior tests
5. `PHASE_1_STABILIZATION_SUMMARY.md` - This summary

**Total:** 5 new files, 0 modified files

---

## Risk Assessment

**Risk Level:** ✅ **ZERO**

**Why:**
- No existing code modified
- No behavior changes
- No API changes
- No database changes
- All new code is opt-in (debug flags)
- Tests document existing behavior
- Documentation clarifies existing behavior

**Safe to deploy:** Yes (new services won't be used until Phase 2 integration)

---

**Phase 1 Complete** ✅
