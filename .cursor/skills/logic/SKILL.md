---
name: logic
description: >-
  BONUS and BIG_GOTD queue like NORMAL: append on create, sortOrder ordering,
  single AUTO READY at queue head, removeAfterFinish forever-remove after
  play/cancel. Use when editing queue order, opener, auto-start, or create.
disable-model-invocation: true
---

# BONUS / BIG_GOTD queue order logic

## Scope

Order-on-add and registration/start ordering for `BONUS` and `BIG_GOTD`.

Do **not** change payment, registration accounting, or BIG_GAME schedule behavior.

## Rules (on create)

- `BONUS` and `BIG_GOTD` use the same `assignSortOrderOnCreate(tx, gameRuleId)` path as `NORMAL`.
- Append to the end of the queue (`maxSortOrder + 1`), unless top-5 rule diversity defers a duplicate rule.
- No live/READY jump-ahead insert.
- Set `removeAfterFinish: true` so finish/cancel removes the slot forever (never requeued).
- Standard-queue AUTO create does **not** open a READY session; only the queue head gets READY via the opener.

## AUTO queue-head invariant

- At most one standard-queue AUTO `READY` registration at a time (lowest `sortOrder`).
- Deep `NEXT` AUTO slots stay without READY until they become head.
- Opener activates/creates by lowest `sortOrder`; empty non-head READY sessions soft-retire (session cancelled, slot stays `NEXT`, no `removeAfterFinish`).
- Auto-start and assert start follow queue-head `sortOrder` (due BIG_GAME still wins when scheduled).
- Countdown repair restores deadline only for the head READY session.

## Registration / start ordering

- Among standard-queue games (NORMAL / BONUS / BIG_GOTD), order by `sortOrder` only (same runtime priority).
- Due BIG_GAME keeps schedule priority over lower-priority games.

## Key files

- `src/games/game-queue.service.ts` — `assignSortOrderOnCreate`; `assertSlotReady`; `restoreSlotAfterSession`
- `src/games/post-game-registration-opener.service.ts` — queue-head READY open/activate
- `src/games/game-auto-start-scheduler.service.ts` — due start by queue head
- `src/games/auto-ready-countdown-repair.service.ts` — head-only countdown repair
- `src/games/games.service.ts` — `createGameSlot` (no eager standard AUTO READY; `removeAfterFinish`)
- `src/games/game-category.util.ts` — `getRuntimeQueuePriority` (due Big Game only)
