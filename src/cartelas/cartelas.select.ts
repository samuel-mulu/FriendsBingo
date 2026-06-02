import { Prisma } from '@prisma/client';

export const cartelaSelect = Prisma.validator<Prisma.CartelaSelect>()({
  id: true,
  number: true,
  b: true,
  i: true,
  n: true,
  g: true,
  o: true,
  createdAt: true,
});

export type CartelaRecord = Prisma.CartelaGetPayload<{
  select: typeof cartelaSelect;
}>;
