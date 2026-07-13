---
name: logic
description: >-
  BONUS and BIG_GOTD cartela-aware queue insert and registration-pick rules.
  Use when editing queue order on create, assignSortOrderOnCreate, pickRegistrationCandidate,
  or BONUS/BIG_GOTD placement relative to live/READY games.
disable-model-invocation: true
---

# BONUS / BIG_GOTD queue order logic

## Scope

Only touch **order-on-add** and **registration-pick consistency** for `BONUS` and `BIG_GOTD`.

Do **not** change UI, payment, registration accounting, or BIG_GAME schedule behavior.

## Rules (on create)

| State when adding BONUS/BIG_GOTD | Resulting order |
|---|---|
| Live only | Live → new BONUS/BIG_GOTD (registration) |
| Live + READY with 0 cartelas | Live → new BONUS/BIG_GOTD (registration) → demoted former empty READY in queue |
| Live + READY with N>0 cartelas | Live → READY(with cartelas) → BONUS/BIG_GOTD → rest |
| No live, READY empty / filled | Same cartela rule without a live slot |

- Empty READY: demote (cancel READY session with `no_players`, keep slot as `NEXT` behind insert). Do not cancel the slot.
- Filled READY: keep as registration; insert BONUS/BIG_GOTD immediately after it.
- Skip top-5 rule diversity defer for bonus-like inserts.
- NORMAL / BIG_GAME create paths stay unchanged.

## Registration pick consistency

When selecting `registrationOpenGame`:

1. Prefer any READY with `registeredCartelasCount > 0` (lowest `sortOrder`).
2. Else apply existing category runtime priority / sortOrder (bonus may become registration when no filled READY exists).

This prevents a READY BONUS/BIG_GOTD from stealing registration from a filled READY.

## Key files

- `src/games/game-queue-bonus-insert.ts` — pure insert plan + filled-READY prefer helper
- `src/games/game-queue.service.ts` — `assignSortOrderOnCreate(tx, gameRuleId, category?)`
- `src/games/games.service.ts` — `createGameSlot` (passes category); `pickRegistrationCandidate`
- `src/games/game-category.util.ts` — `isBonusLikeCategory`, priorities (do not blunt-override filled READY)
