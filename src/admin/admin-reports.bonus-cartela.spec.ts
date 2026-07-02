import {
  CartelaPaymentSource,
  CompanyFeeSource,
  Prisma,
} from '@prisma/client';
import { AdminReportsService } from './admin-reports.service';
import { centsToDecimal } from '../games/registration-payment.util';

describe('AdminReportsService bonus cartela reporting', () => {
  function createService() {
    const prisma = {
      gameCartela: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const adminExpensesService = {
      findExpensesInRange: jest.fn().mockResolvedValue([]),
      sumExpenses: jest.fn().mockReturnValue(new Prisma.Decimal(0)),
    };

    const service = new AdminReportsService(
      prisma as never,
      adminExpensesService as never,
    );

    return { service, prisma };
  }

  it('separates real money and bonus registration values', () => {
    const { service } = createService();
    const totals = (
      service as unknown as {
        sumRegistrationAccounting: (records: unknown[]) => {
          realEntryFeeTotal: Prisma.Decimal;
          bonusEntryValueTotal: Prisma.Decimal;
          realCompanyFeeTotal: Prisma.Decimal;
          bonusCompanyFeeTotal: Prisma.Decimal;
          bonusCartelasUsed: number;
        };
      }
    ).sumRegistrationAccounting([
      {
        amount: centsToDecimal(200),
        occurredAt: new Date('2026-07-02T10:00:00.000Z'),
        paymentSource: CartelaPaymentSource.BONUS_CARTELA,
        companyFeeSource: CompanyFeeSource.BONUS,
        entryFeeCents: 1000,
        companyFeeCents: 200,
      },
      {
        amount: centsToDecimal(200),
        occurredAt: new Date('2026-07-02T11:00:00.000Z'),
        paymentSource: CartelaPaymentSource.MONEY_WALLET,
        companyFeeSource: CompanyFeeSource.MONEY,
        entryFeeCents: 1000,
        companyFeeCents: 200,
      },
    ]);

    expect(totals.bonusCartelasUsed).toBe(1);
    expect(totals.bonusEntryValueTotal.toString()).toBe('10');
    expect(totals.bonusCompanyFeeTotal.toString()).toBe('2');
    expect(totals.realEntryFeeTotal.toString()).toBe('10');
    expect(totals.realCompanyFeeTotal.toString()).toBe('2');
  });
});
