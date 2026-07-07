import { Prisma } from '@prisma/client';

const GAME_TRANSITION_LOCK_NAMESPACE = 42017;
const GAME_TRANSITION_LOCK_RESOURCE = 7;

type AdvisoryLockTx = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function tryAcquireGameTransitionLock(
  tx: AdvisoryLockTx,
): Promise<boolean> {
  const result = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(
      ${GAME_TRANSITION_LOCK_NAMESPACE},
      ${GAME_TRANSITION_LOCK_RESOURCE}
    ) AS "locked"
  `;

  return result[0]?.locked === true;
}
