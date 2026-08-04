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
