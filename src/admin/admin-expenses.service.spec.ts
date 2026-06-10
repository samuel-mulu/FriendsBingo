import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminExpensesService } from './admin-expenses.service';

describe('AdminExpensesService', () => {
  it('creates an expense with a mandatory reason', async () => {
    const prisma = {
      adminExpense: {
        create: jest.fn().mockResolvedValue({
          id: 'expense-1',
          amount: new Prisma.Decimal('120'),
          reason: 'Internet bill',
          note: 'June office internet',
          expenseDate: new Date('2026-06-10T00:00:00.000Z'),
          createdById: 'admin-1',
          createdAt: new Date('2026-06-10T12:00:00.000Z'),
          updatedAt: new Date('2026-06-10T12:00:00.000Z'),
        }),
      },
    };

    const service = new AdminExpensesService(prisma as never);

    const result = await service.createExpense(
      {
        amount: '120',
        reason: 'Internet bill',
        note: 'June office internet',
        expenseDate: '2026-06-10',
      },
      'admin-1',
    );

    expect(result.amount).toBe('120');
    expect(result.reason).toBe('Internet bill');
    expect(prisma.adminExpense.create).toHaveBeenCalled();
  });

  it('rejects non-positive expense amounts', async () => {
    const service = new AdminExpensesService({} as never);

    await expect(
      service.createExpense({
        amount: '0',
        reason: 'Invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
