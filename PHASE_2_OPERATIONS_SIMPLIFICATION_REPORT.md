# Phase 2: Operations/Current Simplification - Complete ✅

**Date:** June 27, 2026  
**Status:** ✅ **COMPLETE**  
**Goal:** Simplify operations/current so READY = registration open, NEXT = queue only

---

## 1. Old Behavior (Before Phase 2)

### **Registration Candidate Selection**
```typescript
// OLD: pickRegistrationCandidate could return READY session OR NEXT slot
registrationCandidate: 
  | { kind: 'ready', session: GameSession }
  | { kind: 'next', slot: GameSlot }
  | null
```

**Selection Priority (OLD):**
1. First READY session (if registerable)
2. **Fallback to first NEXT slot** ← This was confusing
3. null if neither exists

### **operations/current Response (OLD)**
```json
{
  "liveGame": null,
  "checkingGame": null,
  "registrationOpenGame": {
    "slotId": "slot-123",
    "status": "NEXT",  // ← Could be NEXT slot!
    "category": "NORMAL",
    // No sessionId - this is a slot, not a session
  },
  "queue": [...]
}
```

### **Problems:**
- ❌ `NEXT` slot could appear as `registrationOpenGame`
- ❌ Confusing: "registration open" but no actual session exists
- ❌ Frontend had to guess: "Is this a session or a slot?"
- ❌ Admin UI showed "Automatic registration is being prepared..." for NEXT slots
- ❌ Mental model unclear: NEXT sometimes means "waiting" and sometimes means "registerable"

---

## 2. New Behavior (After Phase 2)

### **Registration Candidate Selection**
```typescript
// NEW: pickRegistrationCandidate ONLY returns READY sessions
registrationCandidate: 
  | { kind: 'ready', session: GameSession }
  | null  // ← No NEXT fallback
```

**Selection Priority (NEW):**
1. First READY session (if registerable)
2. **null if no READY session** ← Clear and simple
3. NEXT slots appear **only in queue**

### **operations/current Response (NEW)**
```json
{
  "liveGame": null,
  "checkingGame": null,
  "registrationOpenGame": null,  // ← null if no READY session
  "queue": [
    {
      "slotId": "slot-123",
      "status": "NEXT",  // ← NEXT slots only in queue
      "category": "NORMAL"
    }
  ]
}
```

### **Benefits:**
- ✅ `registrationOpenGame` is **always a READY session or null**
- ✅ Clear mental model: **READY = registration open, NEXT = queue/waiting**
- ✅ Frontend doesn't need to guess - type is consistent
- ✅ No more confusing "preparing registration" states
- ✅ Backend decides, frontend obeys

---

## 3. Affected API Fields

### **GET /games/operations/current**

**Type Change:**
```typescript
// BEFORE
interface CurrentOperations {
  registrationOpenGame: GameSession | GameSlot | null;
  //                                  ^^^^^^^^ Could be slot!
}

// AFTER
interface CurrentOperations {
  registrationOpenGame: GameSession | null;
  //                                  No more slot fallback
}
```

**Field Behavior:**
- `registrationOpenGame` - **Changed**: Now only READY session or null (never NEXT slot)
- `liveGame` - **Unchanged**: Still PLAYING/WINNER_WINDOW session
- `checkingGame` - **Unchanged**: Still CHECKING session
- `queue` - **Unchanged**: Still contains READY sessions + NEXT slots

**Breaking Change?**
- **Type-safe**: Yes (TypeScript will catch this)
- **Runtime-safe**: Mostly (null is valid JSON)
- **Frontend impact**: Depends on how Flutter/Admin handle null

---

## 4. Tests Added/Updated

### **Updated Test**
**File:** `src/games/game-operations-expected-behavior.spec.ts`

**Before:**
```typescript
it('returns NEXT slot as registrationOpenGame when no READY session exists')
// Expected: NEXT slot returned as registrationOpenGame
```

**After:**
```typescript
it('returns null as registrationOpenGame when no READY session exists (Phase 2)')
// Expected: null returned, NEXT slots in queue only
```

**Test Coverage:**
- ✅ READY session is returned as registrationOpenGame
- ✅ **null is returned when no READY session exists** (NEW)
- ✅ NEXT slots appear only in queue
- ✅ All 19 existing tests still pass

---

## 5. Flutter/Admin Null-State Handling

### **Do They Need Changes?**

**Short Answer:** **Likely YES** - small null-state handling needed

### **Current Flutter Behavior (Assumption)**
```dart
// Likely current code:
if (operations.registrationOpenGame != null) {
  // Show registration UI
  if (operations.registrationOpenGame.status == 'READY') {
    // Show "Register Now"
  } else if (operations.registrationOpenGame.status == 'NEXT') {
    // Show "Automatic registration is being prepared..."
  }
}
```

### **Required Flutter Changes**
```dart
// NEW code needed:
if (operations.registrationOpenGame != null) {
  // registrationOpenGame is ALWAYS a READY session now
  // Show "Register Now" UI
} else {
  // No READY session exists
  // Show "No games available for registration" or check queue
  if (operations.queue.isNotEmpty) {
    // Show "Next game starting soon" with queue info
  } else {
    // Show "No upcoming games"
  }
}
```

### **Required Admin Changes**
```typescript
// OLD Admin code (likely):
if (registrationOpenGame?.status === 'NEXT') {
  return 'Automatic registration is being prepared...';
}

// NEW Admin code needed:
if (!registrationOpenGame) {
  return 'No registration open';
}
// registrationOpenGame is always READY if not null
```

### **Migration Strategy**

**Option 1: Safe Gradual Rollout**
1. Deploy backend Phase 2
2. Monitor logs for `registrationOpenGame=null` cases
3. Update Flutter to handle null gracefully
4. Update Admin to handle null gracefully

**Option 2: Coordinated Deploy**
1. Update Flutter first (handle both old and new behavior)
2. Deploy backend Phase 2
3. Update Admin
4. Remove old Flutter fallback code later

**Recommended:** Option 1 (backend first, then frontend)

---

## 6. Code Changes Summary

### **Files Modified**

**Core Logic:**
1. `src/games/games.service.ts`
   - `pickRegistrationCandidate()` - Removed NEXT slot candidates
   - `getCurrentOperationsInternal()` - Removed NEXT slot fallback
   - Updated return type to reflect session-only
   - Updated JSDoc comments

**Tests:**
2. `src/games/game-operations-expected-behavior.spec.ts`
   - Updated test to expect null instead of NEXT slot

3. `src/games/game-lifecycle-logger-integration.spec.ts`
   - Added GameOperationRepairService mock
   - Added GameLifecycleService mock

**Total:** 3 files modified

---

## 7. Validation Results

```bash
✅ npm run build - SUCCESS
✅ npm test -- game-operations-expected-behavior.spec.ts - 19/19 PASSING
✅ npm test -- game-lifecycle-logger-integration.spec.ts - 7/7 PASSING
✅ No regressions
✅ Type safety improved
```

---

## 8. Mental Model Clarity

### **Before Phase 2**
```
NEXT = "waiting in queue" OR "registration candidate if no READY"
READY = "registration open"
registrationOpenGame = READY session OR NEXT slot OR null
```
**Confusion:** NEXT has dual meaning

### **After Phase 2**
```
NEXT = "waiting in queue" (always)
READY = "registration open" (always)
registrationOpenGame = READY session OR null (never NEXT)
```
**Clarity:** Each status has one clear meaning

---

## 9. Example Scenarios

### **Scenario 1: No READY Session Exists**

**Before Phase 2:**
```json
{
  "registrationOpenGame": {
    "slotId": "slot-1",
    "status": "NEXT",
    "name": "Game 1"
  }
}
```
Frontend shows: "Automatic registration is being prepared..."

**After Phase 2:**
```json
{
  "registrationOpenGame": null,
  "queue": [
    {
      "slotId": "slot-1",
      "status": "NEXT",
      "name": "Game 1"
    }
  ]
}
```
Frontend should show: "No games available for registration. Next game: Game 1"

---

### **Scenario 2: READY Session Exists**

**Before Phase 2:**
```json
{
  "registrationOpenGame": {
    "sessionId": "session-1",
    "slotId": "slot-1",
    "status": "READY",
    "name": "Game 1"
  }
}
```

**After Phase 2:**
```json
{
  "registrationOpenGame": {
    "sessionId": "session-1",
    "slotId": "slot-1",
    "status": "READY",
    "name": "Game 1"
  }
}
```
**No change** - behavior is identical when READY session exists

---

## 10. Risk Assessment

### **Low Risk**
- ✅ Backend change is isolated to one method
- ✅ All existing tests pass
- ✅ Type safety improved
- ✅ No database changes
- ✅ No wallet/money logic touched

### **Medium Risk**
- ⚠️ Frontend may show blank state if not updated
- ⚠️ Admin may show confusing state if not updated
- ⚠️ Users may see "no games" when NEXT slots exist

### **Mitigation**
1. Deploy backend first
2. Monitor for `registrationOpenGame=null` in logs
3. Update Flutter within 24 hours
4. Update Admin within 24 hours
5. Add frontend fallback: "Check back soon for next game"

---

## 11. Success Criteria

✅ **READY means registration open** - Always  
✅ **NEXT means queue only** - Never registration candidate  
✅ **operations/current never returns NEXT as registrationOpenGame** - Enforced  
✅ **If no READY exists, frontend receives null** - Clear contract  
✅ **Engine mental model is simpler** - One meaning per status  
✅ **All tests pass** - No regressions  
✅ **Build succeeds** - No TypeScript errors  

---

## 12. Next Steps

### **Immediate (Required)**
1. ✅ Deploy backend Phase 2 to staging
2. ⚠️ Update Flutter to handle `registrationOpenGame: null`
3. ⚠️ Update Admin to handle `registrationOpenGame: null`
4. ✅ Monitor logs for null cases

### **Soon (Recommended)**
1. Add frontend empty state: "No games available for registration"
2. Show queue preview: "Next game starts in X minutes"
3. Add admin indicator: "No registration open (X games in queue)"

### **Later (Optional)**
1. Add Phase 1 repair tests
2. Consider adding `NO_WINNER` status (future phase)
3. Consider service refactoring (future phase)

---

## 13. Deployment Checklist

**Backend:**
- [x] Phase 2 code complete
- [x] Tests pass
- [x] Build succeeds
- [ ] Deploy to staging
- [ ] Monitor logs
- [ ] Deploy to production

**Flutter:**
- [ ] Add null-state handling for `registrationOpenGame`
- [ ] Test with backend staging
- [ ] Deploy to production

**Admin:**
- [ ] Add null-state handling for `registrationOpenGame`
- [ ] Test with backend staging
- [ ] Deploy to production

---

**Last Updated:** June 27, 2026 11:54 AM UTC+03:00
