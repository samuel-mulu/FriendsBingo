import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BigGameTicketLedgerType,
  GameCategory,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

const ACTIVE_BIG_GAME_STATUSES: GameStatus[] = [
  GameStatus.READY,
  GameStatus.PLAYING,
  GameStatus.CHECKING,
  GameStatus.WINNER_WINDOW,
];

export interface BigGameTicketMutationMeta {
  type: BigGameTicketLedgerType;
  referenceType: string;
  referenceId: string;
  description?: string;
}

export interface BigGameTicketContext {
  slotId: string;
  slotName: string;
  entryFee: Prisma.Decimal;
  status: GameStatus;
  registrationOpensAt: Date | null;
  scheduledStartAt: Date | null;
  roundCount: number;
  currentRound: number;
}

@Injectable()
export class BigGameTicketService {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveBigGameSlot(
    db: PrismaDbClient = this.prisma,
  ): Promise<BigGameTicketContext | null> {
    const slot = await db.gameSlot.findFirst({
      where: {
        category: GameCategory.BIG_GAME,
        status: { not: GameStatus.CANCELLED },
        OR: [
          { status: { in: ACTIVE_BIG_GAME_STATUSES } },
          {
            sessions: {
              some: {
                status: GameStatus.FINISHED,
                nextRoundStartsAt: { not: null },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        entryFee: true,
        status: true,
        roundCount: true,
        currentRound: true,
        sessions: {
          where: {
            OR: [
              {
                status: {
                  in: [
                    GameStatus.READY,
                    GameStatus.PLAYING,
                    GameStatus.CHECKING,
                    GameStatus.WINNER_WINDOW,
                  ],
                },
              },
              {
                status: GameStatus.FINISHED,
                nextRoundStartsAt: { not: null },
              },
            ],
          },
          orderBy: { roundIndex: 'desc' },
          take: 1,
          select: {
            registrationOpensAt: true,
            scheduledStartAt: true,
            status: true,
            nextRoundStartsAt: true,
          },
        },
      },
    });

    if (!slot) {
      return null;
    }

    const session = slot.sessions[0];
    return {
      slotId: slot.id,
      slotName: slot.name,
      entryFee: slot.entryFee,
      status: slot.status,
      registrationOpensAt: session?.registrationOpensAt ?? null,
      scheduledStartAt: session?.scheduledStartAt ?? null,
      roundCount: slot.roundCount,
      currentRound: slot.currentRound,
    };
  }

  async getBalance(
    userId: string,
    gameSlotId: string,
    db: PrismaDbClient = this.prisma,
  ): Promise<number> {
    const row = await db.bigGameTicketBalance.findUnique({
      where: {
        userId_gameSlotId: { userId, gameSlotId },
      },
      select: { balance: true },
    });
    return row?.balance ?? 0;
  }

  async getWalletTicketFields(userId: string) {
    const active = await this.findActiveBigGameSlot();
    if (!active) {
      return {
        bigGameTicketBalance: 0,
        bigGameTicketSlotId: null as string | null,
        bigGameName: null as string | null,
      };
    }

    const balance = await this.getBalance(userId, active.slotId);
    if (balance <= 0) {
      return {
        bigGameTicketBalance: 0,
        bigGameTicketSlotId: null as string | null,
        bigGameName: null as string | null,
      };
    }

    return {
      bigGameTicketBalance: balance,
      bigGameTicketSlotId: active.slotId,
      bigGameName: active.slotName,
    };
  }

  async applyMutation(
    db: PrismaDbClient,
    params: {
      userId: string;
      gameSlotId: string;
      delta: number;
    } & BigGameTicketMutationMeta,
  ): Promise<{ applied: boolean; balanceAfter: number }> {
    if (params.delta === 0) {
      throw new BadRequestException({
        code: 'BIG_GAME_TICKET_DELTA_ZERO',
        message: 'Ticket delta must be non-zero',
      });
    }

    const existing = await db.bigGameTicketLedger.findUnique({
      where: {
        userId_type_referenceType_referenceId: {
          userId: params.userId,
          type: params.type,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
        },
      },
      select: { balanceAfter: true },
    });

    if (existing) {
      return { applied: false, balanceAfter: existing.balanceAfter };
    }

    const current = await db.bigGameTicketBalance.findUnique({
      where: {
        userId_gameSlotId: {
          userId: params.userId,
          gameSlotId: params.gameSlotId,
        },
      },
      select: { id: true, balance: true },
    });

    const balanceBefore = current?.balance ?? 0;
    const balanceAfter = balanceBefore + params.delta;

    if (balanceAfter < 0) {
      throw new BadRequestException({
        code: 'BIG_GAME_TICKET_INSUFFICIENT',
        message: 'Insufficient Big Tickets',
      });
    }

    if (current) {
      await db.bigGameTicketBalance.update({
        where: { id: current.id },
        data: { balance: balanceAfter },
      });
    } else {
      await db.bigGameTicketBalance.create({
        data: {
          id: randomUUID(),
          userId: params.userId,
          gameSlotId: params.gameSlotId,
          balance: balanceAfter,
        },
      });
    }

    try {
      await db.bigGameTicketLedger.create({
        data: {
          id: randomUUID(),
          userId: params.userId,
          gameSlotId: params.gameSlotId,
          delta: params.delta,
          balanceAfter,
          type: params.type,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          description: params.description,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const again = await db.bigGameTicketLedger.findUnique({
          where: {
            userId_type_referenceType_referenceId: {
              userId: params.userId,
              type: params.type,
              referenceType: params.referenceType,
              referenceId: params.referenceId,
            },
          },
          select: { balanceAfter: true },
        });
        return {
          applied: false,
          balanceAfter: again?.balanceAfter ?? balanceBefore,
        };
      }
      throw error;
    }

    return { applied: true, balanceAfter };
  }

  async grantTickets(
    db: PrismaDbClient,
    params: {
      userId: string;
      gameSlotId: string;
      count: number;
      type: BigGameTicketLedgerType;
      referenceType: string;
      referenceId: string;
      description?: string;
    },
  ) {
    if (params.count <= 0) {
      return { applied: false, balanceAfter: 0 };
    }
    return this.applyMutation(db, {
      userId: params.userId,
      gameSlotId: params.gameSlotId,
      delta: params.count,
      type: params.type,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      description: params.description,
    });
  }

  async spendTicket(
    db: PrismaDbClient,
    params: {
      userId: string;
      gameSlotId: string;
      referenceType: string;
      referenceId: string;
      description?: string;
    },
  ) {
    return this.applyMutation(db, {
      userId: params.userId,
      gameSlotId: params.gameSlotId,
      delta: -1,
      type: BigGameTicketLedgerType.SPEND_REGISTER,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      description: params.description,
    });
  }

  /**
   * Zero all positive balances for a finished Big Game event.
   * Creates one EXPIRE ledger row per user with remaining balance.
   */
  async expireAllForSlot(gameSlotId: string, db: PrismaDbClient = this.prisma) {
    const balances = await db.bigGameTicketBalance.findMany({
      where: {
        gameSlotId,
        balance: { gt: 0 },
      },
      select: { userId: true, balance: true },
    });

    for (const row of balances) {
      await this.applyMutation(db, {
        userId: row.userId,
        gameSlotId,
        delta: -row.balance,
        type: BigGameTicketLedgerType.EXPIRE,
        referenceType: 'big_game_slot',
        referenceId: `${gameSlotId}:expire`,
        description: 'Big Tickets expired — Big Game finished',
      });
    }

    return { expiredUserCount: balances.length };
  }

  async requireActiveBigGameForForce(db: PrismaDbClient = this.prisma) {
    const active = await this.findActiveBigGameSlot(db);
    if (!active) {
      throw new BadRequestException({
        code: 'NO_ACTIVE_BIG_GAME',
        message: 'Force Big Tickets requires a scheduled or live Big Game',
      });
    }
    return active;
  }

  async getBalanceOrThrow(
    userId: string,
    gameSlotId: string,
    db: PrismaDbClient = this.prisma,
  ) {
    const balance = await this.getBalance(userId, gameSlotId, db);
    if (balance <= 0) {
      throw new BadRequestException({
        code: 'BIG_GAME_TICKET_INSUFFICIENT',
        message: 'Insufficient Big Tickets',
      });
    }
    return balance;
  }

  assertSlotExists = async (gameSlotId: string, db: PrismaDbClient) => {
    const slot = await db.gameSlot.findUnique({
      where: { id: gameSlotId },
      select: { id: true },
    });
    if (!slot) {
      throw new NotFoundException('Big Game slot not found');
    }
  };
}
