import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { AuditLogService } from '../common/services/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { serializeCalledNumber } from './called-numbers.mapper';
import { calledNumberSelect } from './called-numbers.select';
import { CallNumberDto } from './dto/call-number.dto';

@Injectable()
export class CalledNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly requestPerformance: RequestPerformanceContext,
  ) {}

  async callNumber(
    sessionId: string,
    callNumberDto: CallNumberDto,
    actorId?: string,
  ) {
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const calledNumber = await this.prisma.$transaction(async (tx) => {
          const session = await tx.gameSession.findUnique({
            where: { id: sessionId },
            select: {
              id: true,
              status: true,
              gameSlotId: true,
            },
          });

          if (!session) {
            throw new NotFoundException('Game session not found');
          }

          if (session.status !== GameStatus.PLAYING) {
            throw new BadRequestException(
              'Only PLAYING sessions can receive called numbers',
            );
          }

          const existingCalledNumber = await tx.calledNumber.findFirst({
            where: {
              gameSessionId: sessionId,
              number: callNumberDto.number,
            },
            select: { id: true },
          });

          if (existingCalledNumber) {
            throw new ConflictException(
              'This number has already been called for the session',
            );
          }

          const latestCalledNumber = await tx.calledNumber.findFirst({
            where: { gameSessionId: sessionId },
            orderBy: { order: 'desc' },
            select: { order: true },
          });

          const createdCalledNumber = await tx.calledNumber.create({
            data: {
              gameSessionId: sessionId,
              letter: callNumberDto.letter,
              number: callNumberDto.number,
              order: (latestCalledNumber?.order ?? 0) + 1,
            },
            select: calledNumberSelect,
          });

          if (actorId) {
            await this.auditLogService.create(tx, {
              actorId,
              action: 'admin.game.call_number',
              entity: 'CalledNumber',
              entityId: createdCalledNumber.id,
              metadata: {
                sessionId,
                letter: createdCalledNumber.letter,
                number: createdCalledNumber.number,
                order: createdCalledNumber.order,
              },
            });
          }

          return {
            calledNumber: createdCalledNumber,
            slotId: session.gameSlotId,
          };
        });

        const payload = {
          ...serializeCalledNumber(calledNumber.calledNumber),
          slotId: calledNumber.slotId,
          playerStatus: 'playing' as const,
        };
        this.realtimeService.emitToSession(
          sessionId,
          'game:number_called',
          payload,
        );
        this.realtimeService.emitToAdmin('game:number_called', payload);
        this.realtimeService.emitToPublicGames('game:number_called', payload);

        return payload;
      } catch (error) {
        if (this.isUniqueConstraintError(error) && attempt < maxAttempts - 1) {
          continue;
        }

        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'Called number already exists or ordering conflict occurred',
          );
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Called number already exists or ordering conflict occurred',
    );
  }

  async callRandomNumber(sessionId: string, actorId?: string) {
    const { calledNumbers } = await this.getCalledNumbers(sessionId);
    const used = new Set(calledNumbers.map((entry) => entry.number));
    const remaining: number[] = [];

    for (let number = 1; number <= 75; number += 1) {
      if (!used.has(number)) {
        remaining.push(number);
      }
    }

    if (remaining.length === 0) {
      throw new BadRequestException('All numbers have been called');
    }

    const number =
      remaining[Math.floor(Math.random() * remaining.length)] ?? remaining[0];

    return this.callNumber(
      sessionId,
      {
        letter: this.getLetterForNumber(number),
        number,
      },
      actorId,
    );
  }

  async getCalledNumbers(sessionId: string) {
    return this.requestPerformance.run(
      {
        operation: 'getCalledNumbers',
        userRole: 'guest',
      },
      async () => {
        const calledNumbers = await this.prisma.calledNumber.findMany({
          where: { gameSessionId: sessionId },
          orderBy: { order: 'asc' },
          select: calledNumberSelect,
        });

        if (calledNumbers.length === 0) {
          const session = await this.prisma.gameSession.findUnique({
            where: { id: sessionId },
            select: { id: true },
          });

          if (!session) {
            throw new NotFoundException('Game session not found');
          }
        }

        return {
          totalCount: calledNumbers.length,
          calledNumbers: calledNumbers.map(serializeCalledNumber),
        };
      },
      (result) => ({
        calledNumbersCount: result.totalCount,
      }),
    );
  }

  private getLetterForNumber(number: number): string {
    if (number >= 1 && number <= 15) return 'B';
    if (number >= 16 && number <= 30) return 'I';
    if (number >= 31 && number <= 45) return 'N';
    if (number >= 46 && number <= 60) return 'G';
    return 'O';
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'P2002'
    );
  }
}
