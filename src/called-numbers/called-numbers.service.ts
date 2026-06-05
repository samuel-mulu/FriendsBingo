import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameStatus } from '@prisma/client';
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
  ) {}

  async callNumber(
    sessionId: string,
    callNumberDto: CallNumberDto,
    actorId?: string,
  ) {
    try {
      const calledNumber = await this.prisma.$transaction(async (tx) => {
        const session = await tx.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            status: true,
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

        return createdCalledNumber;
      });

      const payload = serializeCalledNumber(calledNumber);
      this.realtimeService.emitToSession(sessionId, 'game:number_called', payload);
      this.realtimeService.emitToAdmin('game:number_called', payload);

      return payload;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Called number already exists or ordering conflict occurred',
        );
      }

      throw error;
    }
  }

  async getCalledNumbers(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    const calledNumbers = await this.prisma.calledNumber.findMany({
      where: { gameSessionId: sessionId },
      orderBy: { order: 'asc' },
      select: calledNumberSelect,
    });

    return {
      totalCount: calledNumbers.length,
      calledNumbers: calledNumbers.map(serializeCalledNumber),
    };
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
