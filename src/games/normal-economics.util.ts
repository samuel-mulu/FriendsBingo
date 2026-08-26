import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const DECIMAL_MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
export const MIN_NORMAL_PRIZE_PER_CARTELA = new Prisma.Decimal(1);

export type NormalEconomics = {
  entryFee: Prisma.Decimal;
  prizePerCartela: Prisma.Decimal;
  companyFeePerCartela: Prisma.Decimal;
};

export function parseMoneyDecimal(
  value: string,
  fieldName: string,
): Prisma.Decimal {
  const trimmed = value.trim();
  if (!DECIMAL_MONEY_PATTERN.test(trimmed)) {
    throw new BadRequestException(
      `${fieldName} must be a positive number with up to 2 decimal places`,
    );
  }

  const parsed = new Prisma.Decimal(trimmed);
  if (parsed.lt(0)) {
    throw new BadRequestException(
      `${fieldName} must be greater than or equal to 0`,
    );
  }

  return parsed;
}

export function computeNormalEconomics(
  entryFee: Prisma.Decimal,
  companyFeePerCartela: Prisma.Decimal,
): NormalEconomics {
  if (companyFeePerCartela.lt(0)) {
    throw new BadRequestException(
      'companyFeePerCartela must be greater than or equal to 0',
    );
  }

  const prizePerCartela = entryFee.minus(companyFeePerCartela);
  if (prizePerCartela.lt(MIN_NORMAL_PRIZE_PER_CARTELA)) {
    throw new BadRequestException(
      'entryFee must be greater than companyFeePerCartela so prize per cartela is at least 1 ETB',
    );
  }

  return {
    entryFee,
    prizePerCartela,
    companyFeePerCartela,
  };
}

export function computeNormalEconomicsFromStrings(
  entryFee: string,
  companyFeePerCartela: string,
): NormalEconomics {
  return computeNormalEconomics(
    parseMoneyDecimal(entryFee, 'entryFee'),
    parseMoneyDecimal(companyFeePerCartela, 'companyFeePerCartela'),
  );
}

export function deriveCompanyFeePerCartela(
  entryFee: Prisma.Decimal,
  prizePerCartela: Prisma.Decimal,
): Prisma.Decimal {
  return entryFee.minus(prizePerCartela);
}
