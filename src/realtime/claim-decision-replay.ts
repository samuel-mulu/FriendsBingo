import { BingoClaimStatus, GameStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Claim decision replay on `game:join`.
 *
 * Why: while a bingo claim is CHECKING, the player app pauses the called-numbers
 * strip and only releases it on the claim's decision event (`game:bingo_invalid`
 * / `game:bingo_claim_failed`). Those events go to the session room only, and
 * Socket.IO does not redeliver events a socket missed while disconnected. A phone
 * that missed the decision stayed paused forever while other players continued.
 *
 * Fix: when a socket (re)joins a session room, send that socket — and only that
 * socket — the current round's claim state using the exact live payload shapes.
 * The app already dedupes repeats (`claimId` / `claimAttemptId`), so phones that
 * already saw an event ignore it. This module only reads; it never changes claim
 * state or the claim flow.
 */

export const CLAIM_REPLAY_MAX_CLAIMS = 50;

export type ClaimReplayKind = 'invalid' | 'failed' | 'checking';

export interface ClaimReplayEvent {
  event: string;
  payload: Record<string, unknown>;
  claimId: string;
  kind: ClaimReplayKind;
}

export interface ClaimReplaySession {
  id: string;
  status: GameStatus;
  autoCallEnabled: boolean;
  nextAutoCallAt: Date | null;
}

export interface ClaimReplayClaim {
  id: string;
  claimAttemptId: string;
  userId: string;
  gameCartelaId: string;
  status: BingoClaimStatus;
  checkedPattern: string | null;
  reason: string | null;
  reasonCode: string | null;
  failureCode: string | null;
  receivedAt: Date;
  cartelaNumber: number;
}

export function buildClaimDecisionReplay(input: {
  session: ClaimReplaySession;
  roundStartedAfter: Date | null;
  claims: ClaimReplayClaim[];
}): ClaimReplayEvent[] {
  const { session, roundStartedAfter } = input;

  // Only a PLAYING session can have a frozen strip; other phases already
  // recover through the existing finish / winner-window paths.
  if (session.status !== GameStatus.PLAYING) {
    return [];
  }

  const sessionId = session.id;
  // Always the CURRENT schedule, never the one stored with the claim, so the
  // app's countdown can never be wound back by a replay.
  const currentNextAutoCallAt =
    session.autoCallEnabled && session.nextAutoCallAt != null
      ? session.nextAutoCallAt.toISOString()
      : null;

  const claims = input.claims.filter(
    (claim) =>
      roundStartedAfter == null ||
      claim.receivedAt.getTime() > roundStartedAfter.getTime(),
  );

  const byCartela = new Map<string, ClaimReplayClaim[]>();
  for (const claim of claims) {
    const list = byCartela.get(claim.gameCartelaId) ?? [];
    list.push(claim);
    byCartela.set(claim.gameCartelaId, list);
  }

  const decided: ClaimReplayClaim[] = [];
  const openChecks: ClaimReplayClaim[] = [];

  for (const list of byCartela.values()) {
    // An open CHECKING claim wins: never let an older/newer FAILED row (e.g. a
    // CLAIM_STATE_CONFLICT duplicate) release a pause the server still holds.
    const checking = list.find(
      (claim) => claim.status === BingoClaimStatus.CHECKING,
    );
    if (checking) {
      openChecks.push(checking);
      continue;
    }

    // Manual-rule claim still awaiting an admin decision: replay nothing.
    if (list.some((claim) => claim.status === BingoClaimStatus.PENDING)) {
      continue;
    }

    const latest = list.reduce((left, right) =>
      right.receivedAt.getTime() > left.receivedAt.getTime() ? right : left,
    );
    if (
      latest.status === BingoClaimStatus.INVALID ||
      latest.status === BingoClaimStatus.FAILED
    ) {
      decided.push(latest);
    }
    // VALID / ALREADY_RESOLVED: nothing to replay.
  }

  const oldestFirst = (left: ClaimReplayClaim, right: ClaimReplayClaim) =>
    left.receivedAt.getTime() - right.receivedAt.getTime();
  decided.sort(oldestFirst);
  openChecks.sort(oldestFirst);

  const events: ClaimReplayEvent[] = [];

  for (const claim of decided) {
    if (claim.status === BingoClaimStatus.INVALID) {
      // Same shape as the live `game:bingo_invalid` emit.
      events.push({
        event: 'game:bingo_invalid',
        kind: 'invalid',
        claimId: claim.id,
        payload: {
          sessionId,
          userId: claim.userId,
          gameCartelaId: claim.gameCartelaId,
          cartelaNumber: claim.cartelaNumber,
          claimId: claim.id,
          matchedPattern: claim.checkedPattern,
          reason: claim.reason,
          reasonCode: claim.reasonCode,
          progress: null,
          nextAutoCallAt: currentNextAutoCallAt,
        },
      });
      continue;
    }

    // FAILED: other phones only clear a FAILED claim when its claimAttemptId
    // matches a recorded check, so send the check first. It deliberately has NO
    // `nextAutoCallAt` key — the app would otherwise hide the countdown and the
    // non-owner `claim_failed` path never restores it.
    events.push({
      event: 'game:bingo_checking',
      kind: 'failed',
      claimId: claim.id,
      payload: {
        sessionId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
        claimAttemptId: claim.claimAttemptId,
        cartelaNumber: claim.cartelaNumber,
      },
    });
    // Same shape as the live `game:bingo_claim_failed` emit.
    events.push({
      event: 'game:bingo_claim_failed',
      kind: 'failed',
      claimId: claim.id,
      payload: {
        sessionId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
        cartelaNumber: claim.cartelaNumber,
        claimAttemptId: claim.claimAttemptId,
        claimId: claim.id,
        retryAllowed: true,
        nextAutoCallAt: currentNextAutoCallAt,
        reasonCode: claim.failureCode,
      },
    });
  }

  // Open checks last: the phone ends paused exactly when the server is checking.
  for (const claim of openChecks) {
    // Same shape as the live `game:bingo_checking` emit.
    events.push({
      event: 'game:bingo_checking',
      kind: 'checking',
      claimId: claim.id,
      payload: {
        sessionId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
        claimAttemptId: claim.claimAttemptId,
        cartelaNumber: claim.cartelaNumber,
        nextAutoCallAt: null,
      },
    });
  }

  return events;
}

/** Read-only: two indexed queries. Never writes. */
export async function loadClaimDecisionReplay(
  prisma: Pick<PrismaService, 'gameSession' | 'bingoClaim'>,
  sessionId: string,
): Promise<ClaimReplayEvent[]> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      autoCallEnabled: true,
      nextAutoCallAt: true,
      roundResults: {
        orderBy: { roundIndex: 'desc' },
        take: 1,
        select: { finalizedAt: true },
      },
    },
  });

  if (!session || session.status !== GameStatus.PLAYING) {
    return [];
  }

  // Chain games reuse one session: only claims after the last finished round.
  const roundStartedAfter = session.roundResults[0]?.finalizedAt ?? null;

  const rows = await prisma.bingoClaim.findMany({
    where: {
      gameSessionId: sessionId,
      ...(roundStartedAfter ? { receivedAt: { gt: roundStartedAfter } } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: CLAIM_REPLAY_MAX_CLAIMS,
    select: {
      id: true,
      claimAttemptId: true,
      userId: true,
      gameCartelaId: true,
      status: true,
      checkedPattern: true,
      reason: true,
      reasonCode: true,
      failureCode: true,
      receivedAt: true,
      gameCartela: { select: { cartela: { select: { number: true } } } },
    },
  });

  return buildClaimDecisionReplay({
    session: {
      id: session.id,
      status: session.status,
      autoCallEnabled: session.autoCallEnabled,
      nextAutoCallAt: session.nextAutoCallAt,
    },
    roundStartedAfter,
    claims: rows.map((row) => ({
      id: row.id,
      claimAttemptId: row.claimAttemptId,
      userId: row.userId,
      gameCartelaId: row.gameCartelaId,
      status: row.status,
      checkedPattern: row.checkedPattern,
      reason: row.reason,
      reasonCode: row.reasonCode,
      failureCode: row.failureCode,
      receivedAt: row.receivedAt,
      cartelaNumber: row.gameCartela.cartela.number,
    })),
  });
}
