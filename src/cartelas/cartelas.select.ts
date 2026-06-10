import { Prisma } from '@prisma/client';

export const cartelaNumberSelect = Prisma.validator<Prisma.CartelaSelect>()({
  id: true,
  number: true,
  createdAt: true,
});

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
