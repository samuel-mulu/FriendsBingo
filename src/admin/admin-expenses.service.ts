import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { PrismaService } from '../prisma/prisma.service';

type ExpenseRecord = {
  amount: Prisma.Decimal;
  expenseDate: Date;
};

@Injectable()
export class AdminExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async createExpense(createExpenseDto: CreateExpenseDto, actorId?: string) {
    const amount = new Prisma.Decimal(createExpenseDto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than zero');
    }

    const expense = await this.prisma.adminExpense.create({
      data: {
        amount,
        reason: createExpenseDto.reason.trim(),
        note: createExpenseDto.note?.trim() || null,
        expenseDate: createExpenseDto.expenseDate
          ? this.parseExpenseDate(createExpenseDto.expenseDate)
          : new Date(),
        createdById: actorId ?? null,
      },
      select: adminExpenseSelect,
    });

    return this.serializeExpense(expense);
  }

  async findExpensesInRange(dateRangeQuery: DateRangeQueryDto) {
    const dateRange = this.buildDateRange(dateRangeQuery);
    const expenses = await this.prisma.adminExpense.findMany({
      where: {
        expenseDate: dateRange,
      },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
      select: adminExpenseSelect,
    });

    return expenses.map((expense) => this.serializeExpense(expense));
  }

  sumExpenses(expenses: ExpenseRecord[]) {
    return expenses.reduce(
      (total, expense) => total.plus(expense.amount),
      new Prisma.Decimal(0),
    );
  }

  groupExpensesByDay(
    expenses: ExpenseRecord[],
    dateRangeQuery: DateRangeQueryDto,
  ) {
    const grouped = new Map<string, Prisma.Decimal>();

    for (const expense of expenses) {
      const dayKey = this.formatDateKey(expense.expenseDate);
      grouped.set(
        dayKey,
        (grouped.get(dayKey) ?? new Prisma.Decimal(0)).plus(expense.amount),
      );
    }

    const requestedDays = this.buildRequestedDayKeys(dateRangeQuery);
    if (requestedDays.length > 0) {
      for (const dayKey of requestedDays) {
        if (!grouped.has(dayKey)) {
          grouped.set(dayKey, new Prisma.Decimal(0));
        }
      }
    }

    return grouped;
  }

  private serializeExpense(
    expense: Prisma.AdminExpenseGetPayload<{
      select: typeof adminExpenseSelect;
    }>,
  ) {
    return {
      id: expense.id,
      amount: expense.amount.toString(),
      reason: expense.reason,
      note: expense.note,
      expenseDate: expense.expenseDate,
      createdById: expense.createdById,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    };
  }

  private buildDateRange(query: DateRangeQueryDto): Prisma.DateTimeFilter {
    const from = query.from
      ? this.parseDateBoundary(query.from, 'start')
      : undefined;
    const to = query.to ? this.parseDateBoundary(query.to, 'end') : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    return {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  private parseExpenseDate(rawValue: string): Date {
    return this.parseDateBoundary(rawValue, 'start');
  }

  private parseDateBoundary(rawValue: string, boundary: 'start' | 'end'): Date {
    const parsedDate = new Date(rawValue);

    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`Invalid ${boundary} date`);
    }

    if (!rawValue.includes('T')) {
      parsedDate.setHours(
        boundary === 'start' ? 0 : 23,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 999,
      );
    }

    return parsedDate;
  }

  private buildRequestedDayKeys(query: DateRangeQueryDto): string[] {
    if (!query.from || !query.to) {
      return [];
    }

    const start = this.parseDateBoundary(query.from, 'start');
    const end = this.parseDateBoundary(query.to, 'end');

    if (start > end) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const keys: string[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    const lastDay = new Date(end);
    lastDay.setHours(0, 0, 0, 0);

    while (cursor <= lastDay) {
      keys.push(this.formatDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return keys;
  }

  private formatDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
  }
}

const adminExpenseSelect = {
  id: true,
  amount: true,
  reason: true,
  note: true,
  expenseDate: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminExpenseSelect;
