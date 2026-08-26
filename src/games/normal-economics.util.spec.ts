import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  computeNormalEconomics,
  computeNormalEconomicsFromStrings,
  deriveCompanyFeePerCartela,
} from './normal-economics.util';

describe('normal-economics.util', () => {
  describe('computeNormalEconomics', () => {
    it('computes prize as entry minus commission', () => {
      const result = computeNormalEconomics(
        new Prisma.Decimal('10'),
        new Prisma.Decimal('2'),
      );

      expect(result.entryFee.toString()).toBe('10');
      expect(result.companyFeePerCartela.toString()).toBe('2');
      expect(result.prizePerCartela.toString()).toBe('8');
    });

    it('allows commission 1 with prize 9', () => {
      const result = computeNormalEconomics(
        new Prisma.Decimal('10'),
        new Prisma.Decimal('1'),
      );

      expect(result.prizePerCartela.toString()).toBe('9');
    });

    it('rejects prize below 1 ETB', () => {
      expect(() =>
        computeNormalEconomics(
          new Prisma.Decimal('10'),
          new Prisma.Decimal('10'),
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects negative commission', () => {
      expect(() =>
        computeNormalEconomics(
          new Prisma.Decimal('10'),
          new Prisma.Decimal('-1'),
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('computeNormalEconomicsFromStrings', () => {
    it('parses valid money strings', () => {
      const result = computeNormalEconomicsFromStrings('12.50', '2.25');

      expect(result.entryFee.toString()).toBe('12.5');
      expect(result.companyFeePerCartela.toString()).toBe('2.25');
      expect(result.prizePerCartela.toString()).toBe('10.25');
    });

    it('rejects invalid money format', () => {
      expect(() =>
        computeNormalEconomicsFromStrings('abc', '2'),
      ).toThrow(BadRequestException);
    });
  });

  describe('deriveCompanyFeePerCartela', () => {
    it('derives commission from entry and prize', () => {
      expect(
        deriveCompanyFeePerCartela(
          new Prisma.Decimal('10'),
          new Prisma.Decimal('8'),
        ).toString(),
      ).toBe('2');
    });
  });
});
