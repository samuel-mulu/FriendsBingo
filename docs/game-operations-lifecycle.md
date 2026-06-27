# Game Operations Lifecycle

**Last Updated:** June 27, 2026  
**Purpose:** Document the current game operations engine behavior without changing it

---

## Core Concepts

### GameSlot vs GameSession

**GameSlot** = Queue position holder and game template
- Defines: game type, category, operation mode, money config
- Holds: `sortOrder` for queue position
- Role: Template that spawns multiple sessions over time
- Lifetime: Permanent (until explicitly cancelled/removed)

**GameSession** = Actual game round
- Defines: specific round with players, cartelas, called numbers
- Holds: `status` (READY, PLAYING, CHECKING, WINNER_WINDOW, FINISHED, CANCELLED)
- Role: The actual game instance players interact with
- Lifetime: Single round (created → finished → archived)

### Source of Truth

**GameSession.status** is the canonical source of truth for game state.

**GameSlot.status** is a derivative/helper field synchronized from the active session:
- Updated when session transitions
- Used for queue filtering and admin UI
- Should always match active session status

### The Queue

The queue is **not a separate entity** - it's a **view** of GameSlot records:

```sql
-- The queue is this query:
SELECT * FROM game_slot
WHERE status = 'NEXT'
  AND category != 'BIG_GAME'
ORDER BY sortOrder ASC;
```

Queue operations:
- **Add to queue:** Create GameSlot with status NEXT
- **Move in queue:** Update sortOrder
- **Remove from queue:** Set status to CANCELLED
- **Restore to queue:** Set status to NEXT, sortOrder = max + 1

---

## The Confusing State: NEXT Slot + READY Session

### This is Normal and Expected

A GameSlot can be `NEXT` while its current GameSession is `READY`.

**What this means:**
- The slot is still in queue identity (sortOrder matters)
- The current session is open for registration
- The slot has not "left" the queue yet
- When the session starts (PLAYING), the slot status updates to PLAYING

**Example Timeline:**

```
1. Slot created: GameSlot(status: NEXT, sortOrder: 5)
   └─ No session yet

2. Registration opens: GameSlot(status: NEXT, sortOrder: 5)
   └─ GameSession(status: READY, scheduledStartAt: +60s)
   
   ⚠️ SLOT IS STILL NEXT, SESSION IS READY

3. Game starts: GameSlot(status: PLAYING, sortOrder: 5)
   └─ GameSession(status: PLAYING, startedAt: now)
   
   ✅ NOW SLOT STATUS MATCHES SESSION

4. Game finishes: GameSlot(status: FINISHED, sortOrder: 5)
   └─ GameSession(status: FINISHED, finishedAt: now)

5. Queue restore: GameSlot(status: NEXT, sortOrder: 99)
   └─ GameSession(status: FINISHED) [archived]
   
   ✅ SLOT BACK IN QUEUE, READY FOR NEW SESSION
```

### Why This Design?

**Reason 1:** Queue position matters even during registration
- Slot sortOrder determines priority
- Slot must stay in queue to maintain position
- Changing to READY would lose queue semantics

**Reason 2:** Registration phase is not "live game"
- READY = accepting registrations
- PLAYING = actual game in progress
- Slot status NEXT = "not live yet"

**Reason 3:** Multiple READY sessions can exist
- Different slots can have READY sessions simultaneously
- Only one can be PLAYING at a time
- Queue sortOrder determines which READY session is "next"

---

## Registration Flow

### Target Selection

**Registration targets a GameSession, not a GameSlot.**

All `GameCartela` records have `gameSessionId`, not `gameSlotId`.

### When Registration Opens

**For AUTO mode:**
1. PostGameRegistrationOpenerService runs on scheduler tick
2. Checks: no active game, no recent finished game, no due Big Game
3. Finds queue head (NEXT slot, lowest sortOrder, AUTO mode)
4. Creates READY session with scheduledStartAt
5. Slot status remains NEXT
6. Session status is READY

**For MANUAL mode:**
1. Player attempts registration on NEXT slot
2. GamesService.resolveRegistrationSessionForSlot() called
3. No READY session exists → creates one
4. Slot status remains NEXT
5. Session status is READY

**For Big Game:**
1. Admin creates Big Game slot
2. READY session created immediately with scheduledStartAt
3. Slot status remains NEXT
4. Session status is READY

### Registration Allowed When

Session must be:
- Status: READY or PLAYING or CHECKING
- Not cancelled
- Not finished

Slot must be:
- Status: NEXT or PLAYING
- Not cancelled

---

## Live Game Flow

### Starting a Game

**GameEngineService.startGame(slotId)** is the single entry point.

**Transition:** READY → PLAYING

**What happens:**
1. Find READY session for slot (if exists)
2. Update slot status to PLAYING
3. If READY session exists: transition to PLAYING
4. If no READY session: create new PLAYING session (MANUAL fallback)
5. Emit events, invalidate cache

**Who calls startGame:**
- GameAutoStartSchedulerService (AUTO mode, when scheduledStartAt due)
- Admin (MANUAL mode, manual start button)

### Claiming Bingo

**GamesService.claimBingo(sessionId, cartelaId)**

**Transition:** PLAYING → CHECKING

**What happens:**
1. Validate cartela is winner
2. Update session status to CHECKING
3. Update slot status to CHECKING
4. Emit events

### Validating Bingo

**GamesService.validateBingo(sessionId, valid)**

**Transition:** CHECKING → WINNER_WINDOW (valid) or PLAYING (invalid)

**What happens:**
1. If valid: transition to WINNER_WINDOW
2. If invalid: transition back to PLAYING
3. Update slot status to match
4. Emit events

### Finalizing Winner Window

**GamesService.finalizeWinnerWindow(sessionId)**

**Transition:** WINNER_WINDOW → FINISHED

**What happens:**
1. Pay winners
2. Update session status to FINISHED
3. Update slot status to FINISHED
4. Call GameQueueService.restoreSlotAfterSession()
5. Emit events

---

## Post-Game Flow

### Queue Restoration

**GameQueueService.restoreSlotAfterSession(slotId)**

**Called after:** Session finishes or is cancelled

**What happens:**
1. Check slot.removeAfterFinish flag
2. If true: set slot status to CANCELLED (removed)
3. If false: set slot status to NEXT, sortOrder = max + 1 (requeued)
4. Return 'removed' or 'requeued'

**Does NOT create new session** - that happens later.

### Opening Next Registration

**PostGameRegistrationOpenerService.openNextAutoQueueRegistration()**

**Runs on:** Scheduler tick (every 1s)

**Checks:**
1. No active session (PLAYING/CHECKING/WINNER_WINDOW)
2. No recent FINISHED session (within finishedResultDisplaySeconds grace)
3. No due Big Game (scheduledStartAt <= now)
4. AUTO queue head exists (NEXT slot, AUTO mode, lowest sortOrder)
5. No existing READY session for that slot

**If all pass:**
1. Create READY session for queue head
2. Set scheduledStartAt = now + registrationDurationSeconds
3. Slot status remains NEXT
4. Session status is READY
5. Emit events, invalidate cache

---

## Current Operations (operations/current)

### Purpose

Canonical "what's happening now" API for clients.

### Selection Logic

**Query order:**
1. `liveGame` = first session with status PLAYING or WINNER_WINDOW
2. `checkingGame` = first session with status CHECKING
3. `registrationOpenGame` = first READY session by slot sortOrder, else first NEXT slot
4. `queue` = remaining READY + NEXT items by slot sortOrder

**Ordering:** All by GameSlot.sortOrder ASC

**Filters:**
- Exclude cancelled slots
- Exclude Big Game from normal queue
- Exclude slots already used in liveGame/checkingGame/registrationOpenGame

**Cache:** 500ms TTL, invalidated on state changes

### registrationOpenGame Can Be

**Option 1:** READY session
- Slot is NEXT (or PLAYING if already started)
- Session is READY
- Lowest sortOrder among READY sessions

**Option 2:** NEXT slot (no session)
- No READY sessions exist
- Lowest sortOrder among NEXT slots
- MANUAL mode only (AUTO creates session immediately)

---

## Big Game Priority

### Rules

1. **Due Big Game blocks everything**
   - scheduledStartAt <= now
   - Must start before any normal game
   - Checked by GameQueueService.assertSlotReady()

2. **Future Big Game does not block**
   - scheduledStartAt > now
   - Normal games can start
   - Big Game waits for its scheduled time

3. **Big Game never appears in normal queue**
   - Excluded from operations/current queue
   - Excluded from queue diversity checks
   - Shown separately in UI

### Priority Order

When multiple READY sessions exist:

1. **Due Big Game** (scheduledStartAt <= now)
2. **Bonus Game** (category BONUS)
3. **Normal Game** (category NORMAL)

Within same category: earliest scheduledStartAt, then lowest sortOrder.

---

## Bonus Game Rules

### Money Config

- entryFee = 0
- prizePerCartela = 0
- prizeAmount = fixedPrizeAmount (from slot)
- companyRevenue = 0

### Registration

- Free for all players
- Limited by maxCartelasPerPlayer (from slot)
- No wallet debit

### Queue Behavior

- Higher priority than NORMAL
- Lower priority than BIG_GAME
- Appears in normal queue (unlike Big Game)

---

## Cancellation

### Single Owner

**GameLifecycleService.cancelSession()** is the ONLY way to cancel.

**All cancel paths must go through this method:**
- Admin force-cancel
- Admin slot cancel
- AUTO scheduler empty-session skip

### What Happens

1. Claim session with optimistic updateMany (status check)
2. Refund all paid cartelas (in transaction)
3. Mark all cartelas as CANCELLED
4. Update session status to CANCELLED
5. Call GameQueueService.restoreSlotAfterSession()
6. Emit events, invalidate cache

### Race Condition Handling

**abortIfPlayersRegistered flag:**
- Used by AUTO scheduler
- If players register during cancel: abort (rollback)
- Scheduler will then start the game instead
- Prevents stranding paid cartelas

---

## Invariants (Expected to Always Be True)

### Global Invariants

1. **At most one active session globally**
   - Active = PLAYING or CHECKING or WINNER_WINDOW
   - Multiple READY sessions OK
   - Multiple FINISHED sessions OK

2. **Slot status matches active session**
   - If session is PLAYING, slot is PLAYING
   - If session is READY, slot is NEXT or PLAYING (transition)
   - If session is FINISHED, slot is FINISHED (briefly, then NEXT)

3. **Registration targets valid session**
   - GameCartela.gameSessionId must exist
   - Session must be READY or PLAYING or CHECKING
   - Session must not be CANCELLED

### Queue Invariants

1. **Queue is NEXT slots only**
   - status = NEXT
   - category != BIG_GAME (for normal queue)
   - Ordered by sortOrder ASC

2. **sortOrder is unique and sequential**
   - No gaps required
   - No duplicates
   - Used for ordering only

3. **Due Big Game blocks normal start**
   - If Big Game READY with scheduledStartAt <= now
   - Normal games cannot start
   - Checked by assertSlotReady()

### Session Invariants

1. **READY session has slot**
   - gameSlotId must exist
   - Slot must not be CANCELLED

2. **PLAYING session has started**
   - startedAt must be set
   - calledNumbers may be empty (just started)

3. **FINISHED session has ended**
   - finishedAt must be set
   - Winner or no winner (cancelled mid-game)

---

## Common Confusion Points

### "Why is slot NEXT when session is READY?"

**Answer:** Slot status represents queue identity, session status represents game phase.
- NEXT = "in queue, not live yet"
- READY = "accepting registrations"
- These are compatible states

### "Why does operations/current return a READY session?"

**Answer:** registrationOpenGame is the session open for registration.
- If READY session exists: show it
- If no READY session: show NEXT slot (registration will create session)

### "Why can multiple READY sessions exist?"

**Answer:** Different slots can have READY sessions simultaneously.
- Only one can be PLAYING at a time
- Queue sortOrder determines which is "next"
- Others wait in queue

### "Why does slot status change to PLAYING when session starts?"

**Answer:** PLAYING means "live game in progress."
- NEXT = in queue
- READY = accepting registrations (still in queue)
- PLAYING = live game (left queue)

### "Why does queue restore set status to NEXT, not READY?"

**Answer:** Slot goes back to queue without session.
- NEXT = in queue, no active session
- New READY session created later by scheduler or first registration

---

## Debugging Tips

### Check Session Status First

GameSession.status is the source of truth. Always check session status before slot status.

### Trace Session Creation

Sessions are created in 5 places:
1. PostGameRegistrationOpenerService (AUTO queue head)
2. GamesService.resolveRegistrationSessionForSlot (MANUAL first registration)
3. GamesService.createGameSlot (admin creates AUTO slot)
4. GameEngineService.startGame (MANUAL fallback, rare)
5. GamesService.switchSlotOperationMode (MANUAL → AUTO)

### Trace Status Transitions

All transitions go through:
- GameEngineService.startGame (READY → PLAYING)
- GamesService.claimBingo (PLAYING → CHECKING)
- GamesService.validateBingo (CHECKING → WINNER_WINDOW or PLAYING)
- GamesService.finalizeWinnerWindow (WINNER_WINDOW → FINISHED)
- GameLifecycleService.cancelSession (ANY → CANCELLED)

### Check Operations Cache

operations/current has 500ms TTL cache.
- Invalidated on state changes
- May be stale for up to 500ms
- Check OperationsCacheService

### Check Scheduler Logs

GameAutoStartSchedulerService ticks every 1s.
- Logs due sessions
- Logs auto-start attempts
- Logs empty-session cancels

---

## Future Improvements (Not in Current Implementation)

These are documented in the architecture audit but not yet implemented:

1. **GameSessionFactory** - consolidate session creation
2. **Single queue head selector** - consolidate priority logic
3. **Database trigger for slot status** - automatic synchronization
4. **Consolidated transition service** - all transitions in one place
5. **Remove deprecated getCurrentLiveSession** - force migration

See `GAME_OPERATIONS_ARCHITECTURE_AUDIT.md` for details.

---

**End of Lifecycle Documentation**
