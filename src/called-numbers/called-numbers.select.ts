import { Prisma } from '@prisma/client';

export const calledNumberSelect = Prisma.validator<Prisma.CalledNumberSelect>()(
  {
    id: true,
    gameSessionId: true,
    letter: true,
    number: true,
    order: true,
    createdAt: true,
  },
);

export const calledNumberEvaluationSelect =
  Prisma.validator<Prisma.CalledNumberSelect>()({
    letter: true,
    number: true,
    order: true,
  });

export type CalledNumberRecord = Prisma.CalledNumberGetPayload<{
  select: typeof calledNumberSelect;
}>;

export type CalledNumberEvaluationRecord = Prisma.CalledNumberGetPayload<{
  select: typeof calledNumberEvaluationSelect;
}>;
