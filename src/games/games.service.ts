import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { StartSessionDto } from './dto/start-session.dto';
import { UpdateSlotEntryFeeDto } from './dto/update-slot-entry-fee.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import {
  serializeGameSlot,
  serializeGameSession,
  serializeGameSlotForPlayer,
  serializeGameSessionForPlayer,
  serializeGameCartela,
  toPlayerGameSession,
  toPlayerGameSlot,
} from './games.mapper';
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
    const publicPayload = toPlayerGameSlot(payload);

    this.realtimeService.emitToAdmin('slot:created', payload);
    this.realtimeService.emitToPublicGames('slot:created', publicPayload);

    this.realtimeService.emitGameOperationUpdate({
      slotId: slot.id,
      sessionId: null,
      adminPayload: payload,
      publicPayload,
    });

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
      skip,
      take,
    });

    const totalItems = await this.prisma.gameSlot.count({ where });
    const sortedSlots = this.sortOperationalSlots(slots);

    return {
      items: sortedSlots.map(serializeGameSlot),
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

    const updatedSlots = await this.prisma.gameSlot.findMany({
      where: { id: { in: slotIds } },
      select: gameSlotSelect,
    });

    updatedSlots.forEach((slot) => {
      const payload = serializeGameSlot(slot);
      const publicPayload = toPlayerGameSlot(payload);

      this.realtimeService.emitGameOperationUpdate({
        slotId: slot.id,
        sessionId: null,
        adminPayload: payload,
        publicPayload,
      });
    });

    return { success: true };
  }

  async updateSlotEntryFee(
    slotId: string,
    updateSlotEntryFeeDto: UpdateSlotEntryFeeDto,
    actorId?: string,
  ) {
    const entryFee = new Prisma.Decimal(updateSlotEntryFeeDto.entryFee);
    const minimumPrize = new Prisma.Decimal(8);

    if (entryFee.lt(minimumPrize)) {
      throw new BadRequestException('entryFee must be at least 8 ETB');
    }

    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: { id: true, status: true },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT) {
      throw new BadRequestException(
        'Entry fee can only be updated for upcoming NEXT games',
      );
    }

    const updatedSlot = await this.prisma.$transaction(async (tx) => {
      const savedSlot = await tx.gameSlot.update({
        where: { id: slotId },
        data: { entryFee },
        select: gameSlotSelect,
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.entry_fee_update',
          entity: 'GameSlot',
          entityId: slotId,
          metadata: {
            entryFee: entryFee.toString(),
          },
        });
      }

      return savedSlot;
    });

    const payload = serializeGameSlot(updatedSlot);
    const publicPayload = toPlayerGameSlot(payload);

    this.realtimeService.emitToSlot(slotId, 'slot:updated', publicPayload);
    this.realtimeService.emitToAdmin('slot:updated', payload);
    this.realtimeService.emitToPublicGames('slot:updated', publicPayload);

    this.realtimeService.emitToSlot(
      slotId,
      'slot:entry_fee_updated',
      publicPayload,
    );
    this.realtimeService.emitToAdmin('slot:entry_fee_updated', payload);
    this.realtimeService.emitToPublicGames(
      'slot:entry_fee_updated',
      publicPayload,
    );

    this.realtimeService.emitGameOperationUpdate({
      slotId: updatedSlot.id,
      sessionId: null,
      adminPayload: payload,
      publicPayload,
    });

    return payload;
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
            prizePerCartela: true,
            companyFeePerCartela: true,
            status: true,
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        if (session.status !== GameStatus.READY && session.status !== GameStatus.PLAYING) {
          throw new BadRequestException(
            'Cartela registration is only allowed for READY or PLAYING sessions',
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
            prizeAmount: { increment: session.prizePerCartela },
            companyRevenue: { increment: session.companyFeePerCartela },
          },
          select: gameSessionSelect,
        });

        return { gameCartela, updatedSession };
      });

      const sessionPayload = serializeGameSession(result.updatedSession);
      const publicSessionPayload = toPlayerGameSession(sessionPayload);

      this.realtimeService.emitToGame(
        sessionId,
        'session:prize_updated',
        publicSessionPayload,
      );
      this.realtimeService.emitToAdmin('session:prize_updated', sessionPayload);
      this.realtimeService.emitToPublicGames(
        'session:prize_updated',
        publicSessionPayload,
      );

      this.realtimeService.emitGameOperationUpdate({
        slotId: result.updatedSession.gameSlotId,
        sessionId: result.updatedSession.id,
        adminPayload: sessionPayload,
        publicPayload: publicSessionPayload,
      });

      await this.emitWalletUpdated(userId);

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

  async registerCartelaForSlot(
    slotId: string,
    userId: string,
    registerCartelaDto: RegisterCartelaDto,
  ) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        entryFee: true,
        prizePerCartela: true,
        gameType: true,
        name: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.PLAYING) {
      throw new BadRequestException(
        'Cartela registration is only allowed for NEXT or PLAYING slots',
      );
    }

    // Find an ACTIVE session for this slot (READY, PLAYING, or CHECKING).
    // Must filter by status to avoid picking up FINISHED sessions from prior games.
    let session = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: { in: [GameStatus.READY, GameStatus.PLAYING, GameStatus.CHECKING] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        playCode: true,
        entryFee: true,
        prizePerCartela: true,
        companyFeePerCartela: true,
        status: true,
      },
    });

      // If no session exists and the slot is NEXT, create one automatically.
      // Session is created with READY status — accepting registrations but game hasn't started yet.
      // Only admin can transition from READY to PLAYING via startGame.
      if (!session && slot.status === GameStatus.NEXT) {
        const companyFeePerCartela = new Prisma.Decimal(slot.entryFee.toString())
          .minus(slot.prizePerCartela);

        const playCode = this.generatePlayCode();

        session = await this.prisma.gameSession.create({
          data: {
            gameSlotId: slotId,
            playCode,
            entryFee: slot.entryFee,
            prizePerCartela: slot.prizePerCartela,
            companyFeePerCartela,
            prizeAmount: new Prisma.Decimal(0),
            companyRevenue: new Prisma.Decimal(0),
            status: GameStatus.READY,
          },
          select: {
            id: true,
            playCode: true,
            entryFee: true,
            prizePerCartela: true,
            companyFeePerCartela: true,
            status: true,
          },
        });

        // Emit session created event (slot stays NEXT)
        const fullSession = await this.prisma.gameSession.findUnique({
          where: { id: session.id },
          select: gameSessionSelect,
        });

        if (fullSession) {
          const payload = serializeGameSession(fullSession);
          const playerPayload = toPlayerGameSession(payload);
          this.realtimeService.emitToSession(
            session.id,
            'game:status_changed',
            playerPayload,
          );
          this.realtimeService.emitToAdmin('game:status_changed', payload);
          this.realtimeService.emitToPublicGames(
            'game:status_changed',
            playerPayload,
          );
          this.realtimeService.emitGameOperationUpdate({
            slotId,
            sessionId: session.id,
            adminPayload: payload,
            publicPayload: playerPayload,
          });
        }
      }

    if (!session) {
      throw new BadRequestException('No active session found for this slot');
    }

    if (session.status !== GameStatus.READY && session.status !== GameStatus.PLAYING) {
      throw new BadRequestException(
        'Cartela registration is only allowed for READY or PLAYING sessions',
      );
    }

    // Delegate to the existing registerCartela method
    return this.registerCartela(session.id, userId, registerCartelaDto);
  }

  private generatePlayCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `BINGO-${code}`;
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
    this.realtimeService.emitToPublicGames(
      'slot:status_changed',
      toPlayerGameSlot(payload),
    );

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

    return slots.map(serializeGameSlotForPlayer);
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
        return serializeGameSlotForPlayer(nextSlot);
      }

      return null;
    }

    return serializeGameSessionForPlayer(session);
  }

  async getSlotDetail(slotId: string) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: gameSlotSelect,
    });
    if (!slot) throw new NotFoundException('Slot not found');
    return serializeGameSlotForPlayer(slot);
  }

  async getSessionDetail(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });
    if (!session) throw new NotFoundException('Session not found');
    return serializeGameSessionForPlayer(session);
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

  async startGame(
    slotId: string,
    actorId?: string,
    sessionConfig?: StartSessionDto,
  ) {
    return this.gameEngineService.startGame(slotId, actorId, sessionConfig);
  }

  async callNumber(
    sessionId: string,
    callNumberDto: CallNumberDto,
    actorId?: string,
  ) {
    return this.calledNumbersService.callNumber(
      sessionId,
      callNumberDto,
      actorId,
    );
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

  async getSessionsHistory(
    paginationQuery: PaginationQueryDto,
    options?: { forPlayer?: boolean },
  ) {
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

    const serialize = options?.forPlayer
      ? serializeGameSessionForPlayer
      : serializeGameSession;

    return {
      items: sessions.map(serialize),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  private sortOperationalSlots<T extends { status: GameStatus; sortOrder: number | null }>(
    slots: T[],
  ): T[] {
    const statusOrder: Record<GameStatus, number> = {
      [GameStatus.PLAYING]: 0,
      [GameStatus.CHECKING]: 1,
      [GameStatus.READY]: 2,
      [GameStatus.NEXT]: 3,
      [GameStatus.FINISHED]: 4,
      [GameStatus.CANCELLED]: 5,
    };

    return [...slots].sort((left, right) => {
      const statusDiff = statusOrder[left.status] - statusOrder[right.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }

      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
    });
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

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
