import { Prisma } from '@prisma/client';

type RowLockTx = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function lockGameSessionRow(
  tx: RowLockTx,
  sessionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "GameSession"
    WHERE id = ${sessionId}
    FOR UPDATE
  `;

  return rows.length === 1;
}

export async function lockGameSlotRow(
  tx: RowLockTx,
  slotId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "GameSlot"
    WHERE id = ${slotId}
    FOR UPDATE
  `;

  return rows.length === 1;
}

/**
 * Lock order for AUTO bingo authorization inside claim accept:
 * GameSession FOR UPDATE → User FOR UPDATE.
 * Feature grant/preference updates only lock User, so this order cannot
 * deadlock against A2/A3 user feature settings transactions.
 */
export async function lockUserRow(
  tx: RowLockTx,
  userId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "User"
    WHERE id = ${userId}
    FOR UPDATE
  `;

  return rows.length === 1;
}
