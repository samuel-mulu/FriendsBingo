# Game Operations Engine - Architecture Audit

**Date:** June 27, 2026  
**Auditor:** Cascade AI  
**Scope:** Queue, Scheduler, Session Creation, Transitions, Registration, Post-Game Flow, Auto Start, Current Operations, Bonus/Big Game

---

## 1. TRUE SOURCE OF TRUTH

**Answer: `GameSession`**

### Reasoning

The `GameSession` table is the single source of truth for game state because:

1. **Status is stored on GameSession** - The `status` field (READY, PLAYING, CHECKING, WINNER_WINDOW, FINISHED, CANCELLED) lives on `GameSession`, not `GameSlot`
2. **GameSlot.status is derivative** - Slot status is updated to match session state (e.g., slot becomes PLAYING when session transitions to PLAYING)
3. **Money config lives on GameSession** - `entryFee`, `prizePerCartela`, `companyFeePerCartela`, `prizeAmount` are session-specific
4. **Registration targets GameSession** - All `GameCartela` records point to `gameSessionId`, not `gameSlotId`
5. **Operations/current queries GameSession** - The canonical "what's happening now" query filters by `GameSession.status`

### GameSlot's Role

`GameSlot` is a **template** and **queue position holder**:
- Defines game type, category, operation mode
- Holds `sortOrder` for queue position
- Can spawn multiple sessions over time
- Status is synchronized from active session

### Queue's Role

The queue is **not a separate entity** - it's a **view** of `GameSlot` records filtered by `status: NEXT` and ordered by `sortOrder`.

---

## 2. WHO OWNS THESE TRANSITIONS?

### NEXT → READY

**Owners:**
1. **PostGameRegistrationOpenerService.openNextAutoQueueRegistration()** (PRIMARY for AUTO mode)
   - Creates READY session for AUTO queue head
   - Sets `scheduledStartAt`
   - Slot remains NEXT, session is READY
   
2. **GamesService.resolveRegistrationSessionForSlot()** (FALLBACK for MANUAL mode)
   - Creates READY session on first player registration
   - Only for non-Big-Game slots
   - Slot remains NEXT, session is READY

3. **GamesService.createGameSlot()** (ADMIN creation)
   - Can create AUTO slot with immediate READY session
   - Can create MANUAL slot (NEXT, no session)

**Note:** Slot status does NOT change to READY. Only session status is READY.

### READY → PLAYING

**Owners:**
1. **GameEngineService.startGame()** (PRIMARY)
   - Transitions existing READY session to PLAYING
   - Updates slot status to PLAYING
   - Called by scheduler or admin

2. **GameAutoStartSchedulerService.processDueSession()** (TRIGGER for AUTO)
   - Calls `GameEngineService.startGame()` when `scheduledStartAt` is due
   - Cancels session if no players registered

### PLAYING → CHECKING

**Owner:**
1. **GamesService.claimBingo()** (ONLY)
   - Player claims bingo
   - Transitions session to CHECKING
   - Slot status follows

### CHECKING → WINNER_WINDOW

**Owner:**
1. **GamesService.validateBingo()** (ONLY)
   - Admin validates bingo claim
   - If valid: transitions to WINNER_WINDOW
   - If invalid: transitions back to PLAYING

### CHECKING → PLAYING (invalid bingo)

**Owner:**
1. **GamesService.validateBingo()** (ONLY)
   - When bingo claim is rejected

### WINNER_WINDOW → FINISHED

**Owners:**
1. **GamesService.finalizeWinnerWindow()** (ADMIN manual)
   - Pays winners
   - Transitions to FINISHED
   - Slot status follows

2. **Auto-finalize timer** (if implemented)
   - Not found in current codebase
   - May be client-side or future feature

### FINISHED → NEXT (new session)

**Owner:**
1. **GameQueueService.restoreSlotAfterSession()** (ONLY)
   - Called after session finishes
   - Moves slot to back of queue (status: NEXT, sortOrder: max+1)
   - OR removes slot if `removeAfterFinish` flag set
   - Does NOT create new session

**Then:**
2. **PostGameRegistrationOpenerService.openNextAutoQueueRegistration()**
   - Runs on scheduler tick
   - Creates new READY session for next AUTO queue head
   - Respects `finishedResultDisplaySeconds` grace period

### CANCELLED

**Owner:**
1. **GameLifecycleService.cancelSession()** (ONLY)
   - Single owner of cancel transition
   - Refunds all paid cartelas
   - Marks cartelas as CANCELLED
   - Calls `GameQueueService.restoreSlotAfterSession()`
   - Emits events and invalidates cache

**Callers:**
- Admin force-cancel
- Admin slot cancel
- AUTO scheduler (empty session skip)

---

## 3. EXACT LIFECYCLE

```
┌─────────────────────────────────────────────────────────────┐
│ ADMIN CREATES SLOT                                          │
│ ├─ MANUAL mode → GameSlot(status: NEXT, no session)        │
│ └─ AUTO mode → GameSlot(status: NEXT) + GameSession(READY) │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ QUEUE (GameSlot.status = NEXT, ordered by sortOrder)       │
│ - Slots wait in queue                                       │
│ - AUTO: PostGameRegistrationOpener creates READY session   │
│ - MANUAL: First registration creates READY session         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ READY SESSION (GameSession.status = READY)                 │
│ - Slot still NEXT (or PLAYING if already started)          │
│ - Players register cartelas                                 │
│ - AUTO: scheduledStartAt set, countdown active             │
│ - MANUAL: waits for admin start                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ PREPARING (AUTO only)                                       │
│ - Scheduler checks scheduledStartAt                         │
│ - If no players: cancel session, requeue slot              │
│ - If players: call GameEngineService.startGame()           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ PLAYING (GameSession.status = PLAYING)                     │
│ - GameSlot.status = PLAYING                                 │
│ - Numbers called (auto or manual)                           │
│ - Players mark cartelas                                     │
│ - Player claims bingo → CHECKING                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ CHECKING (GameSession.status = CHECKING)                   │
│ - Admin validates bingo claim                               │
│ - Valid → WINNER_WINDOW                                     │
│ - Invalid → back to PLAYING                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ WINNER_WINDOW (GameSession.status = WINNER_WINDOW)         │
│ - Winners displayed                                          │
│ - Admin finalizes → pays winners → FINISHED                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ FINISHED (GameSession.status = FINISHED)                   │
│ - GameSlot.status = FINISHED (briefly)                      │
│ - GameQueueService.restoreSlotAfterSession()               │
│   ├─ removeAfterFinish=true → CANCELLED                    │
│   └─ removeAfterFinish=false → NEXT (back to queue)        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ QUEUE RESTORE                                               │
│ - Slot moved to back (sortOrder = max + 1)                 │
│ - Slot status = NEXT                                        │
│ - Grace period (finishedResultDisplaySeconds)              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ NEXT READY SESSION                                          │
│ - PostGameRegistrationOpener checks queue                   │
│ - Creates READY session for AUTO queue head                │
│ - Cycle repeats                                             │
└─────────────────────────────────────────────────────────────┘

PARALLEL PATH: CANCELLED
┌─────────────────────────────────────────────────────────────┐
│ ANY STATUS → CANCELLED                                      │
│ - GameLifecycleService.cancelSession()                     │
│ - Refunds all paid cartelas                                 │
│ - Marks cartelas CANCELLED                                  │
│ - Restores slot to queue (or removes)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. EVERY PLACE THAT CHANGES GameStatus

### GameEngineService.startGame()

**Why:** Transition READY → PLAYING or create new PLAYING session  
**When:** Admin clicks start OR scheduler auto-starts  
**Expected Before:** READY (or no session for MANUAL slots)  
**Expected After:** PLAYING  
**Also Updates:** GameSlot.status = PLAYING

### GamesService.claimBingo()

**Why:** Player claims bingo  
**When:** Player marks all numbers and clicks "Bingo!"  
**Expected Before:** PLAYING  
**Expected After:** CHECKING  
**Also Updates:** GameSlot.status = CHECKING

### GamesService.validateBingo()

**Why:** Admin validates or rejects bingo claim  
**When:** Admin reviews claim  
**Expected Before:** CHECKING  
**Expected After:** WINNER_WINDOW (valid) or PLAYING (invalid)  
**Also Updates:** GameSlot.status follows

### GamesService.finalizeWinnerWindow()

**Why:** Pay winners and finish game  
**When:** Admin clicks finalize  
**Expected Before:** WINNER_WINDOW  
**Expected After:** FINISHED  
**Also Updates:** GameSlot.status = FINISHED, then queue restore

### GameLifecycleService.cancelSession()

**Why:** Cancel game and refund players  
**When:** Admin cancels OR scheduler skips empty session  
**Expected Before:** READY, PLAYING, or CHECKING  
**Expected After:** CANCELLED  
**Also Updates:** GameSlot.status = NEXT (requeued) or CANCELLED (removed)

### PostGameRegistrationOpenerService.openNextAutoQueueRegistration()

**Why:** Open registration for next AUTO game  
**When:** Scheduler tick after previous game finishes  
**Expected Before:** No session for slot  
**Expected After:** READY session created  
**Also Updates:** GameSlot.status remains NEXT

### GamesService.resolveRegistrationSessionForSlot()

**Why:** Create READY session on first player registration (MANUAL mode)  
**When:** Player registers for NEXT slot with no session  
**Expected Before:** No session for slot  
**Expected After:** READY session created  
**Also Updates:** GameSlot.status remains NEXT

### GamesService.createGameSlot()

**Why:** Admin creates new slot  
**When:** Admin adds game to queue  
**Expected Before:** No slot  
**Expected After:** NEXT slot (and optionally READY session for AUTO)  
**Also Updates:** Creates slot and optionally session

---

## 5. EVERY PLACE THAT CREATES GameSession

### 1. PostGameRegistrationOpenerService.openNextAutoQueueRegistration()

**Why:** Open registration for AUTO queue head  
**Frequency:** Every scheduler tick (1s) after game finishes  
**Session Status:** READY  
**Sets scheduledStartAt:** Yes (now + registrationDurationSeconds)

### 2. GamesService.resolveRegistrationSessionForSlot()

**Why:** First player registers for MANUAL slot  
**Frequency:** Once per slot, on-demand  
**Session Status:** READY  
**Sets scheduledStartAt:** No

### 3. GamesService.createGameSlot() (AUTO mode)

**Why:** Admin creates AUTO slot  
**Frequency:** Admin action  
**Session Status:** READY  
**Sets scheduledStartAt:** Yes (now + registrationDurationSeconds)

### 4. GameEngineService.startGame() (MANUAL fallback)

**Why:** Admin starts MANUAL slot with no READY session  
**Frequency:** Rare (only if no registrations)  
**Session Status:** PLAYING  
**Sets scheduledStartAt:** No

### 5. GamesService.switchSlotOperationMode() (MANUAL → AUTO)

**Why:** Admin switches slot to AUTO mode  
**Frequency:** Admin action  
**Session Status:** READY  
**Sets scheduledStartAt:** Yes

**Total: 5 places** (should ideally be 2-3)

---

## 6. EVERY PLACE THAT OPENS REGISTRATION

### Who Decides: PostGameRegistrationOpenerService

**When:**
- Scheduler tick (every 1s)
- No active session (PLAYING/WINNER_WINDOW/CHECKING)
- No recent FINISHED session (within finishedResultDisplaySeconds grace)
- No due Big Game
- AUTO queue head exists

**Why:** Automatic queue progression for AUTO mode

### Who Decides: GamesService.resolveRegistrationSessionForSlot()

**When:**
- Player attempts registration
- Slot is NEXT with no READY session
- Slot is MANUAL mode (not AUTO)
- Slot is not Big Game

**Why:** On-demand registration opening for MANUAL mode

### Who Decides: Admin (via createGameSlot or switchSlotOperationMode)

**When:**
- Admin creates AUTO slot
- Admin switches MANUAL → AUTO

**Why:** Explicit admin action

### Summary

**3 decision points:**
1. **Scheduler** (AUTO, automatic)
2. **First player registration** (MANUAL, on-demand)
3. **Admin** (explicit)

---

## 7. EVERY PLACE THAT SELECTS "CURRENT GAME"

### GamesService.getCurrentOperations()

**Purpose:** Canonical "what's happening now" API  
**Selection Logic:**
1. `liveGame` = first session with status PLAYING or WINNER_WINDOW
2. `checkingGame` = first session with status CHECKING
3. `registrationOpenGame` = first READY session by slot sortOrder, else first NEXT slot
4. `queue` = remaining READY + NEXT items by slot sortOrder

**Ordering:** Slot sortOrder (ASC)  
**Cache:** 500ms TTL  
**Used By:** Flutter app, admin dashboard

### GameAutoStartSchedulerService.processDueSession()

**Purpose:** Find due AUTO sessions to start  
**Selection Logic:**
1. All READY sessions with `scheduledStartAt <= now`
2. Sort by priority: Big Game > Bonus > Normal, then scheduledStartAt, then sortOrder
3. Process in order

**Ordering:** Category priority, scheduledStartAt, sortOrder  
**Used By:** Scheduler tick

### PostGameRegistrationOpenerService.openNextAutoQueueRegistration()

**Purpose:** Find next AUTO queue head for registration  
**Selection Logic:**
1. All NEXT slots
2. Sort by category priority (Bonus > Normal), then sortOrder
3. Pick first AUTO slot

**Ordering:** Category priority, sortOrder  
**Used By:** Scheduler tick

### GameQueueService.assertSlotReady()

**Purpose:** Validate slot can start (queue position check)  
**Selection Logic:**
1. All NEXT + READY slots
2. Check if due Big Game exists (blocks lower priority)
3. Check if target slot is highest priority

**Ordering:** Category priority, scheduledStartAt, sortOrder  
**Used By:** GameEngineService.startGame()

### Admin Dashboard

**Purpose:** Display current game for admin  
**Selection Logic:** Calls `getCurrentOperations()` with admin role  
**Used By:** Admin UI

### Flutter App

**Purpose:** Display current game for players  
**Selection Logic:** Calls `getCurrentOperations()` with player role  
**Used By:** Player UI

### Summary

**6 selection points** (4 backend, 2 frontend)  
**Consistency:** All use slot sortOrder + category priority, but different filters

---

## 8. DUPLICATE RESPONSIBILITIES

### 🔴 DUPLICATE: Session Creation for AUTO Slots

**Duplicate 1:** PostGameRegistrationOpenerService.openNextAutoQueueRegistration()  
**Duplicate 2:** GamesService.createGameSlot() (when creating AUTO slot)  
**Duplicate 3:** GamesService.switchSlotOperationMode() (when switching to AUTO)

**Why Duplicated:** Each entry point independently creates READY sessions  
**Risk:** Inconsistent scheduledStartAt calculation, money config, playCode generation

**Should Be:** Single factory method for creating AUTO READY sessions

---

### 🔴 DUPLICATE: Queue Head Selection

**Duplicate 1:** PostGameRegistrationOpenerService (for registration opening)  
**Duplicate 2:** GameAutoStartSchedulerService (for auto-start)  
**Duplicate 3:** GameQueueService.assertSlotReady() (for start validation)

**Why Duplicated:** Each service independently sorts and filters queue  
**Risk:** Inconsistent priority logic, Big Game handling, category ordering

**Should Be:** Single `GameQueueService.getNextQueueHead()` method

---

### 🔴 DUPLICATE: "Current Game" Selection

**Duplicate 1:** GamesService.getCurrentOperations() (canonical)  
**Duplicate 2:** GamesService.getCurrentLiveSession() (deprecated but still used)

**Why Duplicated:** Legacy compatibility  
**Risk:** Inconsistent results if logic diverges

**Should Be:** Remove deprecated method, force migration to getCurrentOperations()

---

### 🔴 DUPLICATE: Slot Status Updates

**Duplicate 1:** GameEngineService.startGame() updates slot status  
**Duplicate 2:** Session status changes trigger slot status updates  
**Duplicate 3:** GameLifecycleService.cancelSession() updates slot status  
**Duplicate 4:** GameQueueService.restoreSlotAfterSession() updates slot status

**Why Duplicated:** No single owner of slot status synchronization  
**Risk:** Slot and session status can desync

**Should Be:** Database trigger or single synchronization method

---

### 🔴 DUPLICATE: Registration Allowed Checks

**Duplicate 1:** GamesService.assertSessionRegistrationAllowed()  
**Duplicate 2:** GamesService.resolveRegistrationSessionForSlot() (checks slot status)  
**Duplicate 3:** Frontend validation (client-side)

**Why Duplicated:** Defense in depth, but logic can diverge  
**Risk:** Inconsistent error messages, race conditions

**Should Be:** Single source of truth for registration rules

---

### 🔴 DUPLICATE: Queue Restore Logic

**Duplicate 1:** GameQueueService.restoreSlotAfterSession()  
**Duplicate 2:** GameLifecycleService.cancelSession() calls restoreSlotAfterSession()  
**Duplicate 3:** Post-finalize cleanup (implicit)

**Why Duplicated:** Multiple paths to "game is done, restore slot"  
**Risk:** Slot not restored if path missed

**Should Be:** Single post-session cleanup hook

---

## 9. TEMPORARY FIXES THAT BECAME PERMANENT

### 🟡 LEGACY: getCurrentLiveSession() Deprecated Method

**Location:** GamesService.getCurrentLiveSession()  
**Purpose:** Legacy API for current game  
**Status:** Marked deprecated, delegates to getCurrentOperations()  
**Should Remove:** Yes - force clients to migrate

---

### 🟡 LEGACY: Slot Status Synchronization

**Location:** Multiple services update GameSlot.status  
**Purpose:** Keep slot status in sync with session status  
**Status:** Manual updates scattered across codebase  
**Should Remove:** Yes - replace with database trigger or single sync method

---

### 🟡 SPECIAL CASE: Big Game Priority Logic

**Location:** Multiple services (queue, scheduler, operations)  
**Purpose:** Big Game takes priority over normal games  
**Status:** Duplicated logic in 4+ places  
**Should Remove:** No, but consolidate into single priority calculator

---

### 🟡 SPECIAL CASE: Bonus Game Free Entry

**Location:** buildSessionMoneyConfig() checks isBonusCategory()  
**Purpose:** Bonus games have entryFee=0, prizePerCartela=0  
**Status:** Hardcoded special case  
**Should Remove:** No, but document as business rule

---

### 🟡 SPECIAL CASE: Empty Session Auto-Cancel

**Location:** GameAutoStartSchedulerService.processDueSession()  
**Purpose:** Cancel AUTO sessions with no players  
**Status:** Uses abortIfPlayersRegistered flag to handle race conditions  
**Should Remove:** No, but complex - needs documentation

---

### 🟡 FALLBACK: Create Session on First Registration

**Location:** GamesService.resolveRegistrationSessionForSlot()  
**Purpose:** MANUAL slots don't pre-create READY sessions  
**Status:** On-demand session creation  
**Should Remove:** No - this is the MANUAL mode design

---

### 🟡 FALLBACK: Create Session on Admin Start

**Location:** GameEngineService.startGame()  
**Purpose:** Start MANUAL slot with no READY session  
**Status:** Rare edge case  
**Should Remove:** No - needed for MANUAL mode

---

### 🟡 EXCEPTION: Big Game Cannot Create Session on Registration

**Location:** GamesService.resolveRegistrationSessionForSlot()  
**Purpose:** Big Game requires pre-created READY session  
**Status:** Throws error if no session exists  
**Should Remove:** No - Big Game must be scheduled

---

### 🟡 GRACE PERIOD: finishedResultDisplaySeconds

**Location:** PostGameRegistrationOpenerService  
**Purpose:** Delay opening next registration after FINISHED  
**Status:** Client-only display time, server respects it  
**Should Remove:** No - improves UX

---

### 🟡 CACHE: Operations Cache (500ms TTL)

**Location:** OperationsCacheService  
**Purpose:** Reduce database load for getCurrentOperations()  
**Status:** Short TTL, invalidated on state changes  
**Should Remove:** No - performance optimization

---

## 10. PROPOSED KISS ARCHITECTURE

### Goal

**One owner for:**
- Queue management
- Registration opening
- Live game state
- Status transitions
- Current operations

**No duplicated responsibility.**

---

### Proposed Structure

```
┌─────────────────────────────────────────────────────────────┐
│ GameQueueService (QUEUE OWNER)                              │
│ ├─ getNextQueueHead() - single priority logic              │
│ ├─ moveSlotToBack() - queue restoration                    │
│ ├─ assertSlotReady() - start validation                    │
│ └─ updateQueueOrder() - admin reordering                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GameSessionFactory (SESSION CREATION OWNER)                 │
│ ├─ createReadySession() - single creation method           │
│ │  ├─ Handles AUTO vs MANUAL                               │
│ │  ├─ Handles Big Game vs Normal vs Bonus                  │
│ │  ├─ Sets scheduledStartAt for AUTO                       │
│ │  └─ Generates playCode, money config                     │
│ └─ Used by: PostGameOpener, resolveRegistration, admin     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GameLifecycleService (TRANSITION OWNER)                     │
│ ├─ startSession() - READY → PLAYING                        │
│ ├─ claimBingo() - PLAYING → CHECKING                       │
│ ├─ validateBingo() - CHECKING → WINNER_WINDOW or PLAYING   │
│ ├─ finalizeWinnerWindow() - WINNER_WINDOW → FINISHED       │
│ ├─ cancelSession() - ANY → CANCELLED                       │
│ └─ All transitions emit events, invalidate cache           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GameOperationsService (CURRENT STATE OWNER)                 │
│ ├─ getCurrentOperations() - canonical "what's now"         │
│ ├─ Uses GameQueueService.getNextQueueHead()                │
│ ├─ Single selection logic                                   │
│ └─ Cache with invalidation on state changes                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GameSchedulerService (AUTOMATION OWNER)                     │
│ ├─ tick() - runs every 1s                                   │
│ ├─ Uses GameQueueService.getNextQueueHead()                │
│ ├─ Calls GameSessionFactory.createReadySession()           │
│ ├─ Calls GameLifecycleService.startSession()               │
│ ├─ Calls GameLifecycleService.cancelSession()              │
│ └─ No direct database writes                                │
└─────────────────────────────────────────────────────────────┘
```

---

### Consolidation Plan

#### 1. Create GameSessionFactory

**Consolidates:**
- PostGameRegistrationOpenerService session creation
- GamesService.resolveRegistrationSessionForSlot() session creation
- GamesService.createGameSlot() session creation
- GamesService.switchSlotOperationMode() session creation

**Single Method:**
```typescript
createReadySession(
  slot: GameSlot,
  options: {
    mode: 'AUTO' | 'MANUAL',
    scheduledStartAt?: Date,
  }
): Promise<GameSession>
```

---

#### 2. Consolidate Queue Head Selection

**Consolidates:**
- PostGameRegistrationOpenerService queue sorting
- GameAutoStartSchedulerService queue sorting
- GameQueueService.assertSlotReady() priority checks

**Single Method:**
```typescript
getNextQueueHead(
  filter: {
    mode?: 'AUTO' | 'MANUAL',
    category?: GameCategory,
    excludeSlotIds?: string[],
  }
): Promise<GameSlot | null>
```

---

#### 3. Move All Transitions to GameLifecycleService

**Current:** Transitions scattered across GameEngineService, GamesService  
**Proposed:** All transitions in GameLifecycleService

**Methods:**
- `startSession(sessionId)` - READY → PLAYING
- `claimBingo(sessionId, cartelaId)` - PLAYING → CHECKING
- `validateBingo(sessionId, valid)` - CHECKING → WINNER_WINDOW or PLAYING
- `finalizeWinnerWindow(sessionId)` - WINNER_WINDOW → FINISHED
- `cancelSession(sessionId, reason)` - ANY → CANCELLED (already exists)

---

#### 4. Slot Status Synchronization

**Current:** Manual updates in multiple services  
**Proposed:** Database trigger or single sync method

**Option A (Trigger):**
```sql
CREATE TRIGGER sync_slot_status_from_session
AFTER UPDATE ON game_session
FOR EACH ROW
EXECUTE FUNCTION update_slot_status_from_session();
```

**Option B (Service Method):**
```typescript
syncSlotStatusFromSession(sessionId: string): Promise<void>
```

Called after every session status change.

---

#### 5. Remove Deprecated getCurrentLiveSession()

**Current:** Deprecated but still exists  
**Proposed:** Remove, force migration to getCurrentOperations()

---

#### 6. Consolidate Registration Rules

**Current:** Scattered checks in multiple methods  
**Proposed:** Single validator

**Method:**
```typescript
assertRegistrationAllowed(
  session: GameSession,
  slot: GameSlot,
  userId: string,
): void | throws
```

---

### Benefits

✅ **Single source of truth** for each responsibility  
✅ **No duplicate logic** for queue, sessions, transitions  
✅ **Easier to reason about** - clear ownership  
✅ **Easier to test** - isolated responsibilities  
✅ **Easier to debug** - single place to add logs  
✅ **Easier to extend** - new features have clear home  

---

## 11. ARCHITECTURE CLARITY ASSESSMENT

### What is Clear

✅ **GameSession is source of truth** - status, money config, registration target  
✅ **Queue is a view** - not a separate entity  
✅ **GameLifecycleService owns cancel** - single cancel path  
✅ **Operations cache pattern** - short TTL, invalidation on changes  
✅ **Big Game priority** - always takes precedence  

### What is Unclear

❌ **Who creates sessions?** - 5 different places  
❌ **Who selects queue head?** - 3 different implementations  
❌ **Who updates slot status?** - 4 different places  
❌ **When does registration open?** - 3 different triggers  
❌ **What is READY vs NEXT?** - slot can be NEXT with READY session  

### What is Dangerous

⚠️ **Race condition:** Empty session cancel vs late registration  
⚠️ **Slot/session status desync:** Manual updates can miss  
⚠️ **Duplicate session creation:** Multiple paths can create for same slot  
⚠️ **Queue head selection divergence:** Different priority logic in different places  
⚠️ **Cache invalidation miss:** State change without cache clear  

---

## FINAL SUMMARY

### Current State

The Game Operations Engine has **grown organically** over time, resulting in:
- **5 places** that create GameSession
- **3 places** that select queue head
- **4 places** that update slot status
- **6 places** that select "current game"
- **Multiple duplicate** priority/sorting implementations

### Root Cause

**No clear ownership boundaries** when features were added:
- AUTO mode added → new session creation path
- Big Game added → new priority logic
- MANUAL mode added → new registration trigger
- Operations API added → new selection logic

Each feature added its own implementation instead of consolidating.

### Proposed Fix

**Consolidate into 5 clear owners:**
1. **GameQueueService** - queue management
2. **GameSessionFactory** - session creation
3. **GameLifecycleService** - status transitions
4. **GameOperationsService** - current state queries
5. **GameSchedulerService** - automation orchestration

### Understandability

**Before Consolidation:** A new senior developer would need **2-3 days** to understand the full lifecycle by tracing through 10+ services.

**After Consolidation:** A new senior developer could explain the entire lifecycle **from memory in 30 minutes** by understanding 5 clear owners.

---

**End of Audit**
