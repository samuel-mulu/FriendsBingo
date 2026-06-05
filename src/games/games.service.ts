import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  GameCartelaStatus,
  GameStatus,
  Prisma,
  WalletTransactionType,
} from '@prisma/client';
import { BingoClaimsService } from '../bingo-claims/bingo-claims.service';
import { CreateBingoClaimDto } from '../bingo-claims/dto/create-bingo-claim.dto';
import { CalledNumbersService } from '../called-numbers/called-numbers.service';
import { CallNumberDto } from '../called-numbers/dto/call-number.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { GameEngineService } from '../game-engine/game-engine.service';
import { GameRulesService } from '../game-rules/game-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateGameDto } from './dto/create-game.dto';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import { serializeGameSlot, serializeGameSession, serializeGameCartela } from './games.mapper';
import {
  gameSlotSelect,
  gameSessionSelect,
  myGameCartelaSelect,
} from './games.select';

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gameEngineService: GameEngineService,
    private readonly calledNumbersService: CalledNumbersService,
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly gameRulesService: GameRulesService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly gameQueueService: GameQueueService,
  ) {}

  async createGameSlot(createGameDto: CreateGameDto, actorId?: string) {
    const gameRule = await this.gameRulesService.getActiveGameRuleOrThrow(
      createGameDto.gameRuleId,
    );

    const slot = await this.prisma.$transaction(async (tx) => {
      const sortOrder = await this.gameQueueService.assignSortOrderOnCreate(tx);
      const staticCode = await this.generateUniqueSlotCode(gameRule.key);

      const createdSlot = await tx.gameSlot.create({
        data: {
          staticCode,
          name: gameRule.name,
          gameType: gameRule.key,
          gameRuleId: gameRule.id,
          sortOrder,
          status: GameStatus.NEXT,
        },
        select: gameSlotSelect,
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.create',
          entity: 'GameSlot',
          entityId: createdSlot.id,
          metadata: {
            staticCode,
            gameRuleId: createdSlot.gameRuleId,
          },
        });
      }

      return createdSlot;
    });

    const payload = serializeGameSlot(slot);
    this.realtimeService.emitToAdmin('slot:created', payload);
    this.realtimeService.emitToPublicGames('slot:created', payload);
    return payload;
  }

  async getAdminSlots(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const activeStatuses = [
      GameStatus.NEXT,
      GameStatus.PLAYING,
      GameStatus.CHECKING,
    ];
    const where = { status: { in: activeStatuses } };
    const slots = await this.prisma.gameSlot.findMany({
      where,
      select: gameSlotSelect,
      orderBy: { sortOrder: 'asc' },
      skip,
      take,
    });
    
    const totalItems = await this.prisma.gameSlot.count({ where });

    return {
      items: slots.map(serializeGameSlot),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async updateQueueOrder(slotIds: string[], actorId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.gameQueueService.updateQueueOrder(tx, slotIds);

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.queue.reorder',
          entity: 'GameSlot',
          metadata: { slotIds },
        });
      }
    });

    return { success: true };
  }

  async registerCartela(
    sessionId: string,
    userId: string,
    registerCartelaDto: RegisterCartelaDto,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = await tx.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            playCode: true,
            entryFee: true,
            status: true,
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        if (session.status !== GameStatus.PLAYING) {
          throw new BadRequestException(
            'Cartela registration is only allowed for PLAYING sessions',
          );
        }

        const cartela = await tx.cartela.findUnique({
          where: { id: registerCartelaDto.cartelaId },
          select: { id: true },
        });

        if (!cartela) {
          throw new NotFoundException('Cartela not found');
        }

        await this.walletService.debitWallet(tx, userId, session.entryFee, {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'SESSION',
          referenceId: session.id,
          description: `Game entry fee for ${session.playCode}`,
        });

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: cartela.id,
            status: GameCartelaStatus.REGISTERED,
          },
          select: myGameCartelaSelect,
        });

        // Increment prizeAmount by 8 per registration
        const updatedSession = await tx.gameSession.update({
          where: { id: session.id },
          data: {
            prizeAmount: { increment: 8 },
          },
          select: gameSessionSelect,
        });

        return { gameCartela, updatedSession };
      });

      const sessionPayload = serializeGameSession(result.updatedSession);
      this.realtimeService.emitToGame(sessionId, 'session:prize_updated', sessionPayload);
      this.realtimeService.emitToPublicGames('session:prize_updated', sessionPayload);

      return serializeGameCartela(result.gameCartela);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'This cartela is already registered for this session',
        );
      }
      throw error;
    }
  }

  async updateSlotStatus(
    slotId: string,
    updateGameStatusDto: UpdateGameStatusDto,
    actorId?: string,
  ) {
    if (updateGameStatusDto.status === GameStatus.PLAYING) {
      throw new BadRequestException(
        'Use the start endpoint to move a slot into PLAYING status',
      );
    }

    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    assertValidGameStatusTransition(slot.status, updateGameStatusDto.status);

    const updatedSlot = await this.prisma.$transaction(async (tx) => {
      await tx.gameSlot.update({
        where: { id: slotId },
        data: {
          status: updateGameStatusDto.status,
        },
      });

      // When cancelling or finishing a slot, also resolve any active sessions
      // so they don't orphan and block future game starts.
      if (
        updateGameStatusDto.status === GameStatus.CANCELLED ||
        updateGameStatusDto.status === GameStatus.FINISHED
      ) {
        await tx.gameSession.updateMany({
          where: {
            gameSlotId: slotId,
            status: { in: [GameStatus.PLAYING, GameStatus.CHECKING] },
          },
          data: { status: updateGameStatusDto.status },
        });
      }

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.status_change',
          entity: 'GameSlot',
          entityId: slotId,
          metadata: {
            from: slot.status,
            to: updateGameStatusDto.status,
          },
        });
      }

      return tx.gameSlot.findUnique({
        where: { id: slotId },
        select: gameSlotSelect,
      });
    });

    const payload = serializeGameSlot(updatedSlot!);
    this.realtimeService.emitToSlot(slotId, 'slot:status_changed', payload);
    this.realtimeService.emitToAdmin('slot:status_changed', payload);
    this.realtimeService.emitToPublicGames('slot:status_changed', payload);

    return payload;
  }

  async getAvailableSlots() {
    const slots = await this.prisma.gameSlot.findMany({
      where: {
        status: GameStatus.NEXT,
      },
      select: gameSlotSelect,
      orderBy: { sortOrder: 'asc' },
    });

    return slots.map(serializeGameSlot);
  }

  async getCurrentLiveSession() {
    const session = await this.prisma.gameSession.findFirst({
      where: {
        status: {
          in: [GameStatus.PLAYING, GameStatus.CHECKING],
        },
      },
      select: gameSessionSelect,
      orderBy: { startedAt: 'desc' },
    });

    if (!session) {
      const nextSlot = await this.prisma.gameSlot.findFirst({
        where: { status: GameStatus.NEXT },
        select: gameSlotSelect,
        orderBy: { sortOrder: 'asc' },
      });

      if (nextSlot) {
        return { type: 'slot', data: serializeGameSlot(nextSlot) };
      }

      return null;
    }

    return { type: 'session', data: serializeGameSession(session) };
  }

  async getSlotDetail(slotId: string) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: gameSlotSelect,
    });
    if (!slot) throw new NotFoundException('Slot not found');
    return serializeGameSlot(slot);
  }

  async getSessionDetail(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });
    if (!session) throw new NotFoundException('Session not found');
    return serializeGameSession(session);
  }

  async cancelOrphanedSession(sessionId: string, actorId?: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    });

    if (!session) throw new NotFoundException('Session not found');

    if (
      session.status !== GameStatus.PLAYING &&
      session.status !== GameStatus.CHECKING
    ) {
      throw new BadRequestException(
        `Session is already ${session.status} and cannot be cancelled`,
      );
    }

    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: GameStatus.CANCELLED },
    });

    if (actorId) {
      await this.auditLogService.create(this.prisma, {
        actorId,
        action: 'admin.session.force_cancel',
        entity: 'GameSession',
        entityId: sessionId,
        metadata: { previousStatus: session.status },
      });
    }

    return { success: true, sessionId };
  }

  async startGame(slotId: string, actorId?: string, entryFee?: string) {
    return this.gameEngineService.startGame(slotId, actorId, entryFee);
  }

  async callNumber(
    sessionId: string,
    callNumberDto: CallNumberDto,
    actorId?: string,
  ) {
    return this.calledNumbersService.callNumber(sessionId, callNumberDto, actorId);
  }

  async getCalledNumbers(sessionId: string) {
    return this.calledNumbersService.getCalledNumbers(sessionId);
  }

  async claimBingo(
    sessionId: string,
    userId: string,
    createBingoClaimDto: CreateBingoClaimDto,
  ) {
    return this.bingoClaimsService.claimBingo(
      sessionId,
      userId,
      createBingoClaimDto.gameCartelaId,
    );
  }

  async getMyCartelas(sessionId: string, userId: string) {
    const gameCartelas = await this.prisma.gameCartela.findMany({
      where: {
        gameSessionId: sessionId,
        userId,
      },
      orderBy: { createdAt: 'desc' },
      select: myGameCartelaSelect,
    });

    return gameCartelas.map(serializeGameCartela);
  }

  async getSessionsHistory(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const sessions = await this.prisma.gameSession.findMany({
      where: { status: GameStatus.FINISHED },
      select: gameSessionSelect,
      orderBy: { finishedAt: 'desc' },
      skip,
      take,
    });
    
    const totalItems = await this.prisma.gameSession.count({
      where: { status: GameStatus.FINISHED },
    });

    return {
      items: sessions.map(serializeGameSession),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  private async generateUniqueSlotCode(ruleKey: string): Promise<string> {
    const count = await this.prisma.gameSlot.count({
      where: { gameType: ruleKey },
    });
    return `${ruleKey}-S${count + 1}`;
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
