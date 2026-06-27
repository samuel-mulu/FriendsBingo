import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameEngineService } from '../game-engine/game-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { serializeCalledNumber } from './called-numbers.mapper';
import { calledNumberSelect } from './called-numbers.select';
import { CallNumberDto } from './dto/call-number.dto';

@Injectable()
export class CalledNumbersService {
  private readonly logger = new Logger(CalledNumbersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly requestPerformance: RequestPerformanceContext,
    @Optional()
    private readonly gameEngineService: GameEngineService,
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

        const noWinnerGrace =
          calledNumber.calledNumber.order >= 75
            ? this.gameEngineService?.startNoWinnerGrace
              ? await this.gameEngineService.startNoWinnerGrace(sessionId)
              : await this.prisma.gameSession
                  .updateMany({
                    where: { id: sessionId },
                    data: {
                      autoCallEnabled: false,
                      nextAutoCallAt: null,
                    },
                  })
                  .then(() => null)
            : null;

        const autoCallState = await this.prisma.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            autoCallEnabled: true,
            nextAutoCallAt: true,
            autoCallIntervalMs: true,
            noWinnerGraceEndsAt: true,
            noWinnerReason: true,
          },
        });

        const payload = {
          ...serializeCalledNumber(calledNumber.calledNumber),
          sessionId: sessionId,
          slotId: calledNumber.slotId,
          playerStatus: 'playing' as const,
          autoCallEnabled: autoCallState?.autoCallEnabled ?? false,
          autoCallIntervalMs: autoCallState?.autoCallIntervalMs ?? null,
          nextAutoCallAt:
            autoCallState?.autoCallEnabled &&
            autoCallState.nextAutoCallAt != null
              ? autoCallState.nextAutoCallAt.toISOString()
              : null,
          noWinnerGraceEndsAt:
            autoCallState?.noWinnerGraceEndsAt?.toISOString() ??
            noWinnerGrace?.noWinnerGraceEndsAt?.toISOString() ??
            null,
          noWinnerReason: autoCallState?.noWinnerReason ?? null,
        };
        this.realtimeService.emitToSession(
          sessionId,
          'game:number_called',
          payload,
        );
        this.realtimeService.emitToAdmin('game:number_called', payload);
        this.realtimeService.emitToPublicGames('game:number_called', payload);

        if (process.env.AUTO_CALL_DEBUG === 'true') {
          this.logger.log(
            `[Socket] emitted game:number_called session=${sessionId} order=${calledNumber.calledNumber.order} ${calledNumber.calledNumber.letter}${calledNumber.calledNumber.number} nextAutoCallAt=${autoCallState?.nextAutoCallAt?.toISOString() ?? 'null'}`,
          );
          this.logger.log(
            `[AutoCall] called draw order=${calledNumber.calledNumber.order} number=${calledNumber.calledNumber.number} session=${sessionId}`,
          );
        }

        if (noWinnerGrace?.started) {
          await this.gameEngineService?.emitSessionUpdated?.(sessionId);
        }

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
    const selectStartedAt =
      process.env.AUTO_CALL_DEBUG === 'true' ? Date.now() : 0;
    const used = await this.getUsedNumbersForSession(sessionId);
    const number = this.pickRandomUncalledNumber(used);

    if (number === null) {
      throw new BadRequestException('All numbers have been called');
    }

    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `[AutoCall] selected number=${number} session=${sessionId} usedCount=${used.size} selectDurationMs=${Date.now() - selectStartedAt}`,
      );
    }

    return this.callNumber(
      sessionId,
      {
        letter: this.getLetterForNumber(number),
        number,
      },
      actorId,
    );
  }

  /** Lightweight lookup for random draw — numbers only, no serialization. */
  private async getUsedNumbersForSession(
    sessionId: string,
  ): Promise<Set<number>> {
    const rows = await this.prisma.calledNumber.findMany({
      where: { gameSessionId: sessionId },
      select: { number: true },
    });

    return new Set(rows.map((row) => row.number));
  }

  private pickRandomUncalledNumber(used: Set<number>): number | null {
    const remaining: number[] = [];

    for (let candidate = 1; candidate <= 75; candidate += 1) {
      if (!used.has(candidate)) {
        remaining.push(candidate);
      }
    }

    if (remaining.length === 0) {
      return null;
    }

    return (
      remaining[Math.floor(Math.random() * remaining.length)] ?? remaining[0]
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
