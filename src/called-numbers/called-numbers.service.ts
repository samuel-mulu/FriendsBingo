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

export class AutoCallClaimLostError extends Error {
  constructor(message = 'Auto-call claim lost') {
    super(message);
    this.name = 'AutoCallClaimLostError';
  }
}

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
    const nextDraw = await this.queryRandomRemainingNumber(sessionId);

    if (nextDraw == null) {
      throw new BadRequestException('All numbers have been called');
    }

    if (process.env.AUTO_CALL_DEBUG === 'true') {
      this.logger.log(
        `[AutoCall] selected number=${nextDraw.number} session=${sessionId} remainingCount=${nextDraw.remainingCount} selectDurationMs=${Date.now() - selectStartedAt}`,
      );
    }

    return this.callNumber(
      sessionId,
      {
        letter: this.getLetterForNumber(nextDraw.number),
        number: nextDraw.number,
      },
      actorId,
    );
  }

  async callRandomNumberForAutoCall(
    sessionId: string,
    params: {
      intervalMs: number;
      /** Scheduled due time from the tick finder — metrics only, not the claim lock. */
      scheduledDueAt: Date;
      nextAutoCallAt: Date;
    },
  ) {
    const nextDraw = await this.queryRandomRemainingNumber(sessionId);

    if (nextDraw == null) {
      throw new BadRequestException('All numbers have been called');
    }

    const letter = this.getLetterForNumber(nextDraw.number);
    const isLastNumber = nextDraw.remainingCount <= 1;
    const transactionStartedAt = Date.now();
    const delayedByMs = Math.max(
      transactionStartedAt - params.scheduledDueAt.getTime(),
      0,
    );

    const committed = await this.prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          gameSlotId: true,
          autoCallEnabled: true,
          autoCallIntervalMs: true,
          nextAutoCallAt: true,
          noWinnerGraceEndsAt: true,
          noWinnerReason: true,
          _count: {
            select: {
              calledNumbers: true,
            },
          },
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

      if (!session.autoCallEnabled) {
        throw new AutoCallClaimLostError('Auto-call disabled for session');
      }

      // Claim any currently-due schedule (lte now), not the stale findMany timestamp.
      // Bingo pause sets nextAutoCallAt=null so this correctly loses until restore.
      const claimResult = await tx.gameSession.updateMany({
        where: {
          id: sessionId,
          status: GameStatus.PLAYING,
          autoCallEnabled: true,
          nextAutoCallAt: { lte: new Date() },
        },
        data: isLastNumber
          ? {
              autoCallEnabled: false,
              nextAutoCallAt: null,
            }
          : {
              nextAutoCallAt: params.nextAutoCallAt,
            },
      });

      if (claimResult.count !== 1) {
        throw new AutoCallClaimLostError('Auto-call due claim lost');
      }

      const createdCalledNumber = await tx.calledNumber.create({
        data: {
          gameSessionId: sessionId,
          letter,
          number: nextDraw.number,
          order: session._count.calledNumbers + 1,
        },
        select: calledNumberSelect,
      });

      return {
        calledNumber: createdCalledNumber,
        slotId: session.gameSlotId,
        autoCallEnabled: isLastNumber ? false : session.autoCallEnabled,
        autoCallIntervalMs:
          session.autoCallIntervalMs ?? params.intervalMs ?? null,
        nextAutoCallAt: isLastNumber ? null : params.nextAutoCallAt,
        noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
        noWinnerReason: session.noWinnerReason,
        shouldStartNoWinnerGrace: isLastNumber,
      };
    });

    const transactionMs = Date.now() - transactionStartedAt;
    const noWinnerGrace = committed.shouldStartNoWinnerGrace
      ? this.gameEngineService?.startNoWinnerGrace
        ? await this.gameEngineService.startNoWinnerGrace(sessionId)
        : null
      : null;

    if (noWinnerGrace?.started) {
      void this.gameEngineService?.emitSessionUpdated?.(sessionId);
    }

    const serverNow = new Date().toISOString();
    const payload = {
      ...serializeCalledNumber(committed.calledNumber),
      sessionId,
      slotId: committed.slotId,
      playerStatus: 'playing' as const,
      autoCallEnabled: noWinnerGrace?.started
        ? false
        : committed.autoCallEnabled,
      autoCallIntervalMs: committed.autoCallIntervalMs,
      nextAutoCallAt:
        noWinnerGrace?.started || committed.nextAutoCallAt == null
          ? null
          : committed.nextAutoCallAt.toISOString(),
      serverNow,
      noWinnerGraceEndsAt:
        noWinnerGrace?.noWinnerGraceEndsAt?.toISOString() ??
        committed.noWinnerGraceEndsAt?.toISOString() ??
        null,
      noWinnerReason: noWinnerGrace?.started
        ? 'ALL_NUMBERS_CALLED'
        : (committed.noWinnerReason ?? null),
    };

    return {
      payload,
      transactionMs,
      delayedByMs,
      autoCallChangedPayload: {
        sessionId,
        slotId: committed.slotId,
        autoCallEnabled: payload.autoCallEnabled,
        autoCallIntervalMs: payload.autoCallIntervalMs,
        nextAutoCallAt: payload.nextAutoCallAt,
        updatedReason: 'auto_call_changed' as const,
      },
    };
  }

  private async queryRandomRemainingNumber(
    sessionId: string,
  ): Promise<{ number: number; remainingCount: number } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ number: number; remainingCount: bigint | number }>
    >`
      WITH remaining AS (
        SELECT candidate.number
        FROM generate_series(1, 75) AS candidate(number)
        WHERE NOT EXISTS (
          SELECT 1
          FROM "CalledNumber" cn
          WHERE cn."gameSessionId" = ${sessionId}
            AND cn.number = candidate.number
        )
      )
      SELECT
        number,
        COUNT(*) OVER () AS "remainingCount"
      FROM remaining
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      number: row.number,
      remainingCount: Number(row.remainingCount),
    };
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
