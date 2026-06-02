import { Prisma } from '@prisma/client';

export const calledNumberSelect =
  Prisma.validator<Prisma.CalledNumberSelect>()({
    id: true,
    gameId: true,
    letter: true,
    number: true,
    order: true,
    createdAt: true,
  });

export type CalledNumberRecord = Prisma.CalledNumberGetPayload<{
  select: typeof calledNumberSelect;
}>;
