import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GameCartelaStatus,
  GameOperationMode,
  GameStatus,
  Prisma,
  UserRole,
  WalletTransactionType,
} from '@prisma/client';
import { serializeCartelaBoard } from '../cartelas/cartelas.mapper';
import { cartelaSelect } from '../cartelas/cartelas.select';
import { BingoClaimsService } from '../bingo-claims/bingo-claims.service';
import { CreateBingoClaimDto } from '../bingo-claims/dto/create-bingo-claim.dto';
import { CalledNumbersService } from '../called-numbers/called-numbers.service';
import { CallNumberDto } from '../called-numbers/dto/call-number.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserActionRateLimitService } from '../common/rate-limit/user-action-rate-limit.service';
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
import { UpdateSlotOperationModeDto } from './dto/update-slot-operation-mode.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { AutoCallService } from './auto-call.service';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import {
  assertRegistrationAllowed,
  canRegisterForOperationMode,
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
} from './games.operation-mode';
import {
  serializeGameSlot,
  serializeGameSession,
  serializeGameSlotForPlayer,
  serializeGameSessionForPlayer,
  serializeGameCartela,
  serializeGameSessionWithCartelaSummary,
  serializeRegisteredCartelaSummary,
  buildRegisteredCartelasSummary,
  serializeWinnerCartelaSummary,
  serializeWinnerPayoutsSummary,
  toPlayerGameSession,
  toPlayerGameSlot,
  withTerminalSessionContextForAdminSlot,
  withTerminalSessionContextForPlayerSlot,
} from './games.mapper';
import {
  gameSlotSelect,
  gameSessionSelect,
  myGameCartelaSelect,
  operationsSessionBaseSelect,
  registrationSessionMetricsSelect,
  sessionCartelaSummarySelect,
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
    private readonly autoCallService: AutoCallService,
    private readonly userActionRateLimitService: UserActionRateLimitService,
  ) {}

  async createGameSlot(createGameDto: CreateGameDto, actorId?: string) {
    const gameRule = await this.gameRulesService.getActiveGameRuleOrThrow(
      createGameDto.gameRuleId,
    );
    const operationMode =
      createGameDto.operationMode ?? GameOperationMode.MANUAL;
    const registrationDurationSeconds =
      operationMode === GameOperationMode.AUTO
        ? (createGameDto.registrationDurationSeconds ??
          DEFAULT_REGISTRATION_DURATION_SECONDS)
        : null;
    const autoCallIntervalSeconds =
      operationMode === GameOperationMode.AUTO
        ? (createGameDto.autoCallIntervalSeconds ??
          DEFAULT_AUTO_CALL_INTERVAL_SECONDS)
        : null;

    const { slot, autoSessionId } = await this.prisma.$transaction(async (tx) => {
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
          operationMode,
          registrationDurationSeconds,
          autoCallIntervalSeconds,
        },
        select: gameSlotSelect,
      });

      let createdAutoSessionId: string | null = null;

      if (operationMode === GameOperationMode.AUTO) {
        const scheduledStartAt = new Date(
          Date.now() + registrationDurationSeconds! * 1000,
        );
        const companyFeePerCartela = new Prisma.Decimal(
          createdSlot.entryFee.toString(),
        ).minus(createdSlot.prizePerCartela);

        const createdAutoSession = await tx.gameSession.create({
          data: {
            gameSlotId: createdSlot.id,
            playCode: this.generatePlayCode(),
            entryFee: createdSlot.entryFee,
            prizePerCartela: createdSlot.prizePerCartela,
            companyFeePerCartela,
            prizeAmount: new Prisma.Decimal(0),
            companyRevenue: new Prisma.Decimal(0),
            status: GameStatus.READY,
            scheduledStartAt,
          },
          select: { id: true },
        });
        createdAutoSessionId = createdAutoSession.id;
      }

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.create',
          entity: 'GameSlot',
          entityId: createdSlot.id,
          metadata: {
            staticCode,
            gameRuleId: createdSlot.gameRuleId,
            operationMode,
            registrationDurationSeconds,
            autoCallIntervalSeconds,
          },
        });
      }

      return { slot: createdSlot, autoSessionId: createdAutoSessionId };
    });

    const payload = serializeGameSlot(slot);
    const publicPayload = toPlayerGameSlot(payload);

    this.realtimeService.emitToAdmin('slot:created', payload);
    this.realtimeService.emitToPublicGames('slot:created', publicPayload);

    const autoSession = autoSessionId
      ? await this.prisma.gameSession.findUnique({
          where: { id: autoSessionId },
          select: gameSessionSelect,
        })
      : null;

    if (autoSession) {
      const sessionPayload = serializeGameSession(autoSession);
      const playerSessionPayload = toPlayerGameSession(sessionPayload);
      this.realtimeService.emitToSession(
        autoSession.id,
        'game:status_changed',
        playerSessionPayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        playerSessionPayload,
      );
      this.realtimeService.emitGameOperationUpdate({
        slotId: slot.id,
        sessionId: autoSession.id,
        adminPayload: sessionPayload,
        publicPayload: playerSessionPayload,
      });
    } else {
      this.realtimeService.emitGameOperationUpdate({
        slotId: slot.id,
        sessionId: null,
        adminPayload: payload,
        publicPayload,
      });
    }

    return payload;
  }

  async switchSlotOperationMode(
    slotId: string,
    dto: UpdateSlotOperationModeDto,
    actorId?: string,
  ) {
    const targetMode = dto.operationMode;
    const registrationDurationSeconds =
      targetMode === GameOperationMode.AUTO
        ? (dto.registrationDurationSeconds ??
          DEFAULT_REGISTRATION_DURATION_SECONDS)
        : null;
    const autoCallIntervalSeconds =
      targetMode === GameOperationMode.AUTO
        ? (dto.autoCallIntervalSeconds ?? DEFAULT_AUTO_CALL_INTERVAL_SECONDS)
        : null;

    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        entryFee: true,
        prizePerCartela: true,
        operationMode: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    const latestSession = await this.prisma.gameSession.findFirst({
      where: { gameSlotId: slotId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        autoCallEnabled: true,
      },
    });

    const isTerminalSession =
      latestSession?.status === GameStatus.WINNER_WINDOW ||
      latestSession?.status === GameStatus.FINISHED ||
      latestSession?.status === GameStatus.CANCELLED;

    if (latestSession && isTerminalSession) {
      throw new BadRequestException(
        targetMode === GameOperationMode.AUTO
          ? 'This game can no longer be switched to automatic.'
          : 'This game can no longer be switched to manual.',
      );
    }

    if (latestSession?.status === GameStatus.CHECKING) {
      throw new BadRequestException(
        'Cannot switch operation mode while a bingo claim is being checked.',
      );
    }

    const activeSession =
      latestSession &&
      (latestSession.status === GameStatus.READY ||
        latestSession.status === GameStatus.PLAYING)
        ? latestSession
        : null;

    const { sessionId, shouldStartAutoCall, shouldStopAutoCall } =
      await this.prisma.$transaction(async (tx) => {
        await tx.gameSlot.update({
          where: { id: slotId },
          data: {
            operationMode: targetMode,
            registrationDurationSeconds,
            autoCallIntervalSeconds,
          },
        });

        let affectedSessionId: string | null = null;
        let startAutoCall = false;
        let stopAutoCall = false;

        if (activeSession?.status === GameStatus.READY) {
          affectedSessionId = activeSession.id;
          await tx.gameSession.update({
            where: { id: activeSession.id },
            data: {
              scheduledStartAt:
                targetMode === GameOperationMode.AUTO
                  ? new Date(
                      Date.now() + registrationDurationSeconds! * 1000,
                    )
                  : null,
            },
          });
        } else if (activeSession?.status === GameStatus.PLAYING) {
          affectedSessionId = activeSession.id;
          if (targetMode === GameOperationMode.AUTO) {
            await tx.gameSession.update({
              where: { id: activeSession.id },
              data: {
                autoCallIntervalMs: autoCallIntervalSeconds! * 1000,
              },
            });
            if (!activeSession.autoCallEnabled) {
              startAutoCall = true;
            }
          } else {
            if (activeSession.autoCallEnabled) {
              stopAutoCall = true;
            }
          }
        } else if (
          !activeSession &&
          slot.status === GameStatus.NEXT &&
          targetMode === GameOperationMode.AUTO
        ) {
          const existingReadySession = await tx.gameSession.findFirst({
            where: {
              gameSlotId: slotId,
              status: GameStatus.READY,
            },
            select: { id: true },
          });

          const scheduledStartAt = new Date(
            Date.now() + registrationDurationSeconds! * 1000,
          );

          if (existingReadySession) {
            affectedSessionId = existingReadySession.id;
            await tx.gameSession.update({
              where: { id: existingReadySession.id },
              data: { scheduledStartAt },
            });
          } else {
            const companyFeePerCartela = new Prisma.Decimal(
              slot.entryFee.toString(),
            ).minus(slot.prizePerCartela);

            const createdSession = await tx.gameSession.create({
              data: {
                gameSlotId: slotId,
                playCode: this.generatePlayCode(),
                entryFee: slot.entryFee,
                prizePerCartela: slot.prizePerCartela,
                companyFeePerCartela,
                prizeAmount: new Prisma.Decimal(0),
                companyRevenue: new Prisma.Decimal(0),
                status: GameStatus.READY,
                scheduledStartAt,
              },
              select: { id: true },
            });
            affectedSessionId = createdSession.id;
          }
        }

        if (actorId) {
          await this.auditLogService.create(tx, {
            actorId,
            action: 'admin.slot.operation_mode_change',
            entity: 'GameSlot',
            entityId: slotId,
            metadata: {
              from: slot.operationMode,
              to: targetMode,
              registrationDurationSeconds,
              autoCallIntervalSeconds,
              sessionId: affectedSessionId,
            },
          });
        }

        return {
          sessionId: affectedSessionId,
          shouldStartAutoCall: startAutoCall,
          shouldStopAutoCall: stopAutoCall,
        };
      });

    if (shouldStopAutoCall && sessionId) {
      await this.autoCallService.stopAutoCall(sessionId);
    }

    if (shouldStartAutoCall && sessionId) {
      await this.autoCallService.startAutoCall(sessionId);
    }

    if (sessionId) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: gameSessionSelect,
      });

      if (!session) {
        throw new NotFoundException('Session not found after operation mode switch');
      }

      const sessionPayload = serializeGameSession(session);
      const playerSessionPayload = toPlayerGameSession(sessionPayload);
      this.realtimeService.emitGameOperationUpdate({
        slotId,
        sessionId,
        adminPayload: sessionPayload,
        publicPayload: playerSessionPayload,
      });

      return sessionPayload;
    }

    const updatedSlot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: gameSlotSelect,
    });

    if (!updatedSlot) {
      throw new NotFoundException('Game slot not found after operation mode switch');
    }

    const payload = serializeGameSlot(updatedSlot);
    const publicPayload = toPlayerGameSlot(payload);
    this.realtimeService.emitGameOperationUpdate({
      slotId,
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
      select: {
        id: true,
        status: true,
        prizePerCartela: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT) {
      throw new BadRequestException(
        'Entry fee can only be updated for upcoming queued games',
      );
    }

    const registrationCount = await this.prisma.gameCartela.count({
      where: {
        gameSession: {
          gameSlotId: slotId,
          status: GameStatus.READY,
        },
      },
    });

    if (registrationCount > 0) {
      throw new BadRequestException(
        'Entry fee cannot be changed after players have registered',
      );
    }

    const companyFeePerCartela = entryFee.minus(slot.prizePerCartela);
    if (companyFeePerCartela.lt(0)) {
      throw new BadRequestException(
        'entryFee must be greater than or equal to prizePerCartela',
      );
    }

    const updatedSlot = await this.prisma.$transaction(async (tx) => {
      const savedSlot = await tx.gameSlot.update({
        where: { id: slotId },
        data: { entryFee },
        select: gameSlotSelect,
      });

      await tx.gameSession.updateMany({
        where: {
          gameSlotId: slotId,
          status: GameStatus.READY,
        },
        data: {
          entryFee,
          companyFeePerCartela,
        },
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
    const existingRegistration = await this.prisma.gameCartela.findFirst({
      where: {
        gameSessionId: sessionId,
        cartelaId: registerCartelaDto.cartelaId,
        userId,
      },
      select: myGameCartelaSelect,
    });

    if (existingRegistration) {
      return serializeGameCartela(existingRegistration);
    }

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
            gameSlot: {
              select: { operationMode: true },
            },
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        assertRegistrationAllowed(
          session.gameSlot.operationMode,
          session.status,
        );

        const cartela = await tx.cartela.findUnique({
          where: { id: registerCartelaDto.cartelaId },
          select: { id: true },
        });

        if (!cartela) {
          throw new NotFoundException('Cartela not found');
        }

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: cartela.id,
            status: GameCartelaStatus.REGISTERED,
          },
          select: myGameCartelaSelect,
        });

        await this.walletService.debitWallet(tx, userId, session.entryFee, {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME_CARTELA',
          referenceId: gameCartela.id,
          description: `Game entry fee for ${session.playCode}`,
        });

        // Increment prizeAmount by 8 per registration
        const updatedSession = await tx.gameSession.update({
          where: { id: session.id },
          data: {
            prizeAmount: { increment: session.prizePerCartela },
            companyRevenue: { increment: session.companyFeePerCartela },
          },
          select: registrationSessionMetricsSelect,
        });

        return { gameCartela, updatedSession };
      });

      this.emitRegistrationSideEffects({
        sessionId,
        userId,
        gameCartela: result.gameCartela,
        updatedSession: result.updatedSession,
      });

      return serializeGameCartela(result.gameCartela);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const duplicateRegistration = await this.prisma.gameCartela.findFirst({
          where: {
            gameSessionId: sessionId,
            cartelaId: registerCartelaDto.cartelaId,
            userId,
          },
          select: myGameCartelaSelect,
        });

        if (duplicateRegistration) {
          return serializeGameCartela(duplicateRegistration);
        }

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
        operationMode: true,
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
        status: {
          in: [GameStatus.READY, GameStatus.PLAYING, GameStatus.CHECKING],
        },
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
      const companyFeePerCartela = new Prisma.Decimal(
        slot.entryFee.toString(),
      ).minus(slot.prizePerCartela);

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

    assertRegistrationAllowed(slot.operationMode, session.status);

    // Delegate to the existing registerCartela method
    return this.registerCartela(session.id, userId, registerCartelaDto);
  }

  private static readonly RESERVATION_TTL_MS = 10_000;

  async reserveCartela(
    sessionId: string,
    userId: string,
    cartelaId: string,
  ) {
    this.userActionRateLimitService.assertWithinLimit('reserve', userId);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + GamesService.RESERVATION_TTL_MS,
    );

    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.gameCartelaReservation.updateMany({
        where: {
          gameSessionId: sessionId,
          cartelaId,
          status: 'ACTIVE',
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
      });

      const session = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          gameSlot: { select: { operationMode: true } },
        },
      });

      if (!session) {
        throw new NotFoundException('Game session not found');
      }

      assertRegistrationAllowed(
        session.gameSlot.operationMode,
        session.status,
      );

      const cartela = await tx.cartela.findUnique({
        where: { id: cartelaId },
        select: { id: true },
      });

      if (!cartela) {
        throw new NotFoundException('Cartela not found');
      }

      const registeredCartela = await tx.gameCartela.findFirst({
        where: {
          gameSessionId: sessionId,
          cartelaId,
          status: { not: GameCartelaStatus.CANCELLED },
        },
        select: { id: true },
      });

      if (registeredCartela) {
        throw new ConflictException(
          'This cartela is already registered for this session',
        );
      }

      const activeReservation = await tx.gameCartelaReservation.findFirst({
        where: {
          gameSessionId: sessionId,
          cartelaId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
      });

      if (activeReservation && activeReservation.userId !== userId) {
        throw new ConflictException(
          'Another player is choosing this cartela',
        );
      }

      if (activeReservation && activeReservation.userId === userId) {
        return tx.gameCartelaReservation.update({
          where: { id: activeReservation.id },
          data: { expiresAt },
        });
      }

      await tx.gameCartelaReservation.updateMany({
        where: {
          gameSessionId: sessionId,
          userId,
          status: 'ACTIVE',
        },
        data: { status: 'CANCELLED' },
      });

      try {
        return await tx.gameCartelaReservation.create({
          data: {
            gameSessionId: sessionId,
            cartelaId,
            userId,
            expiresAt,
            status: 'ACTIVE',
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException(
            'Another player is choosing this cartela',
          );
        }

        throw error;
      }
    });

    await this.notifySessionCartelasUpdated(sessionId);

    const cartelaBoard = await this.prisma.cartela.findUnique({
      where: { id: cartelaId },
      select: cartelaSelect,
    });

    if (!cartelaBoard) {
      throw new NotFoundException('Cartela not found');
    }

    return {
      id: reservation.id,
      gameSessionId: reservation.gameSessionId,
      cartelaId: reservation.cartelaId,
      expiresAt: reservation.expiresAt.toISOString(),
      status: reservation.status,
      cartela: serializeCartelaBoard(cartelaBoard),
    };
  }

  async reserveCartelaForSlot(
    slotId: string,
    userId: string,
    cartelaId: string,
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
        operationMode: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.PLAYING) {
      throw new BadRequestException(
        'Cartela reservation is only allowed for NEXT or PLAYING slots',
      );
    }

    let session = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: {
          in: [GameStatus.READY, GameStatus.PLAYING, GameStatus.CHECKING],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });

    if (!session && slot.status === GameStatus.NEXT) {
      const companyFeePerCartela = new Prisma.Decimal(
        slot.entryFee.toString(),
      ).minus(slot.prizePerCartela);

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
        select: { id: true, status: true },
      });

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

    assertRegistrationAllowed(slot.operationMode, session.status);

    return this.reserveCartela(session.id, userId, cartelaId);
  }

  async confirmReservation(reservationId: string, userId: string) {
    this.userActionRateLimitService.assertWithinLimit('confirm', userId);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.gameCartelaReservation.findUnique({
          where: { id: reservationId },
        });

        if (!reservation) {
          throw new NotFoundException('Reservation not found');
        }

        if (reservation.userId !== userId) {
          throw new BadRequestException('Reservation does not belong to user');
        }

        if (reservation.status !== 'ACTIVE') {
          throw new BadRequestException('Reservation is no longer active');
        }

        if (reservation.expiresAt <= new Date()) {
          await tx.gameCartelaReservation.update({
            where: { id: reservationId },
            data: { status: 'EXPIRED' },
          });
          throw new BadRequestException('Reservation has expired');
        }

        const session = await tx.gameSession.findUnique({
          where: { id: reservation.gameSessionId },
          select: {
            id: true,
            playCode: true,
            entryFee: true,
            prizePerCartela: true,
            companyFeePerCartela: true,
            status: true,
            gameSlot: {
              select: { operationMode: true },
            },
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        assertRegistrationAllowed(
          session.gameSlot.operationMode,
          session.status,
        );

        const existingCartelaRegistration = await tx.gameCartela.findFirst({
          where: {
            gameSessionId: session.id,
            cartelaId: reservation.cartelaId,
            userId,
          },
          select: myGameCartelaSelect,
        });

        if (existingCartelaRegistration) {
          await tx.gameCartelaReservation.update({
            where: { id: reservationId },
            data: { status: 'CONFIRMED' },
          });
          return {
            gameCartela: existingCartelaRegistration,
            updatedSession: await tx.gameSession.findUnique({
              where: { id: session.id },
              select: registrationSessionMetricsSelect,
            }),
          };
        }

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: reservation.cartelaId,
            status: GameCartelaStatus.REGISTERED,
          },
          select: myGameCartelaSelect,
        });

        await this.walletService.debitWallet(tx, userId, session.entryFee, {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME_CARTELA',
          referenceId: gameCartela.id,
          description: `Game entry fee for ${session.playCode}`,
        });

        const updatedSession = await tx.gameSession.update({
          where: { id: session.id },
          data: {
            prizeAmount: { increment: session.prizePerCartela },
            companyRevenue: { increment: session.companyFeePerCartela },
          },
          select: registrationSessionMetricsSelect,
        });

        await tx.gameCartelaReservation.update({
          where: { id: reservationId },
          data: { status: 'CONFIRMED' },
        });

        return { gameCartela, updatedSession };
      });

      if (!result.updatedSession) {
        throw new NotFoundException('Game session not found');
      }

      this.emitRegistrationSideEffects({
        sessionId: result.updatedSession.id,
        userId,
        gameCartela: result.gameCartela,
        updatedSession: result.updatedSession,
      });

      return serializeGameCartela(result.gameCartela);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const reservation = await this.prisma.gameCartelaReservation.findUnique({
          where: { id: reservationId },
          select: { gameSessionId: true, cartelaId: true },
        });

        if (reservation) {
          const existing = await this.prisma.gameCartela.findFirst({
            where: {
              gameSessionId: reservation.gameSessionId,
              cartelaId: reservation.cartelaId,
              userId,
            },
            select: myGameCartelaSelect,
          });

          if (existing) {
            return serializeGameCartela(existing);
          }
        }

        throw new ConflictException(
          'This cartela is already registered for this session',
        );
      }

      throw error;
    }
  }

  async cancelReservation(reservationId: string, userId: string) {
    this.userActionRateLimitService.assertWithinLimit('cancel', userId);

    const cancelled = await this.prisma.gameCartelaReservation.updateMany({
      where: {
        id: reservationId,
        userId,
        status: 'ACTIVE',
      },
      data: { status: 'CANCELLED' },
    });

    if (cancelled.count === 0) {
      throw new NotFoundException('Active reservation not found');
    }

    const reservation = await this.prisma.gameCartelaReservation.findUnique({
      where: { id: reservationId },
      select: { gameSessionId: true },
    });

    if (reservation) {
      await this.notifySessionCartelasUpdated(reservation.gameSessionId);
    }

    return { success: true };
  }

  private async notifySessionCartelasUpdated(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        gameSlotId: true,
        prizeAmount: true,
        _count: { select: { gameCartelas: true } },
      },
    });

    if (!session) {
      return;
    }

    this.realtimeService.emitSessionCartelasUpdated({
      sessionId,
      slotId: session.gameSlotId,
      prizeAmount: session.prizeAmount.toString(),
      registeredCartelasCount: session._count.gameCartelas,
    });
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
    const publicPayload = toPlayerGameSlot(payload);

    this.realtimeService.emitToSlot(slotId, 'slot:status_changed', payload);
    this.realtimeService.emitToAdmin('slot:status_changed', payload);
    this.realtimeService.emitToPublicGames('slot:status_changed', publicPayload);

    // Emit game:operation_updated for ALL status changes to ensure live sync
    this.realtimeService.emitGameOperationUpdate({
      slotId,
      sessionId: null,
      adminPayload: payload,
      publicPayload,
    });

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

  /**
   * @deprecated Use getCurrentOperations() / GET /games/operations/current.
   * Kept for backward compatibility and delegates to canonical selection.
   */
  async getCurrentLiveSession(requestingUserId?: string) {
    const operations = await this.getCurrentOperations(
      requestingUserId,
      UserRole.PLAYER,
    );
    const current =
      operations.liveGame ??
      operations.checkingGame ??
      operations.registrationOpenGame;

    if (!current) {
      return null;
    }

    if (current.sessionId) {
      return this.getSessionDetail(current.sessionId, requestingUserId);
    }

    return this.getSlotDetail(current.slotId);
  }

  /**
   * CANONICAL SOURCE OF TRUTH for current game operations.
   * Both Admin and Flutter MUST use this endpoint to ensure they display
   * the SAME game state. Frontend must NOT apply additional filtering/sorting.
   *
   * Selection logic (backend decides, frontend obeys):
   * 1. liveGame = first PLAYING session by slot sortOrder
   * 2. checkingGame = first CHECKING session by slot sortOrder
   * 3. registrationOpenGame = first READY session by slot sortOrder, else first NEXT slot
   * 4. queue = remaining READY + NEXT items by slot sortOrder
   */
  async getCurrentOperations(
    requestingUserId?: string,
    requestingUserRole: UserRole = UserRole.PLAYER,
  ): Promise<{
    liveGame: ReturnType<typeof this.buildGameOperationItem> | null;
    checkingGame: ReturnType<typeof this.buildGameOperationItem> | null;
    registrationOpenGame: ReturnType<typeof this.buildGameOperationItem> | null;
    queue: ReturnType<typeof this.buildGameOperationItem>[];
    timestamp: string;
  }> {
    const isAdmin = requestingUserRole === UserRole.ADMIN;
    const activeSessions = await this.prisma.gameSession.findMany({
      where: {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.WINNER_WINDOW,
            GameStatus.CHECKING,
            GameStatus.READY,
          ],
        },
      },
      select: {
        ...operationsSessionBaseSelect,
        gameSlot: {
          select: {
            id: true,
            staticCode: true,
            name: true,
            gameType: true,
            status: true,
            entryFee: true,
            prizePerCartela: true,
            sortOrder: true,
            operationMode: true,
            registrationDurationSeconds: true,
            autoCallIntervalSeconds: true,
            gameRule: { select: { id: true, name: true, key: true } },
          },
        },
        calledNumbers: {
          orderBy: { order: 'desc' },
          take: 1,
          select: { letter: true, number: true, order: true },
        },
      },
    });

    const nextSlots = await this.prisma.gameSlot.findMany({
      where: { status: GameStatus.NEXT },
      select: this.getNextSlotOperationsSelect(),
      orderBy: { sortOrder: 'asc' },
    });

    const sortedSessions = this.sortBySlotOrder(activeSessions);
    const playingSessions = sortedSessions.filter(
      (session) =>
        session.status === GameStatus.PLAYING ||
        session.status === GameStatus.WINNER_WINDOW,
    );
    const checkingSessions = sortedSessions.filter(
      (session) => session.status === GameStatus.CHECKING,
    );
    const readySessions = sortedSessions.filter(
      (session) =>
        session.status === GameStatus.READY &&
        session.gameSlot?.status !== GameStatus.CANCELLED,
    );

    const liveSession = playingSessions[0] ?? null;
    const checkingSession = checkingSessions[0] ?? null;
    const registrationReadySession = readySessions[0] ?? null;

    const usedSlotIds = new Set<string>();
    if (liveSession) {
      usedSlotIds.add(liveSession.gameSlot.id);
    }
    if (checkingSession) {
      usedSlotIds.add(checkingSession.gameSlot.id);
    }

    let registrationOpenSource:
      | { type: 'session'; data: (typeof sortedSessions)[number] }
      | { type: 'slot'; data: (typeof nextSlots)[number] }
      | null = null;

    if (registrationReadySession) {
      registrationOpenSource = {
        type: 'session',
        data: registrationReadySession,
      };
      usedSlotIds.add(registrationReadySession.gameSlot.id);
    } else if (nextSlots.length > 0) {
      registrationOpenSource = { type: 'slot', data: nextSlots[0] };
      usedSlotIds.add(nextSlots[0].id);
    }

    const queueReadySessions = readySessions.filter(
      (session) => !usedSlotIds.has(session.gameSlot.id),
    );
    const queueNextSlots = nextSlots.filter((slot) => !usedSlotIds.has(slot.id));
    const queueItems = [
      ...queueReadySessions.map((session) => ({
        kind: 'session' as const,
        sortOrder: session.gameSlot.sortOrder,
        data: session,
      })),
      ...queueNextSlots.map((slot) => ({
        kind: 'slot' as const,
        sortOrder: slot.sortOrder,
        data: slot,
      })),
    ].sort(
      (left, right) =>
        this.getSortOrderValue(left.sortOrder) -
        this.getSortOrderValue(right.sortOrder),
    );

    const summarySessionIds = new Set<string>();
    if (liveSession) {
      summarySessionIds.add(liveSession.id);
    }
    if (
      registrationOpenSource?.type === 'session' &&
      registrationOpenSource.data.id
    ) {
      summarySessionIds.add(registrationOpenSource.data.id);
    } else if (registrationOpenSource?.type === 'slot') {
      const readySession = registrationOpenSource.data.sessions?.[0];
      if (readySession?.status === GameStatus.READY) {
        summarySessionIds.add(readySession.id);
      }
    }

    const cartelaSummaries = await this.loadSessionCartelaSummaries([
      ...summarySessionIds,
    ]);

    const buildOptions = { requestingUserId, isAdmin };
    const liveGame = liveSession
      ? this.sanitizeOperationItem(
          this.buildGameOperationItem(
            this.mergeSessionCartelaSummary(liveSession, cartelaSummaries),
            'live',
            { ...buildOptions, includeCartelaSummary: true },
          ),
          isAdmin,
        )
      : null;
    const checkingGame = checkingSession
      ? this.sanitizeOperationItem(
          this.buildGameOperationItem(checkingSession, 'checking', {
            ...buildOptions,
            includeCartelaSummary: false,
          }),
          isAdmin,
        )
      : null;

    let registrationOpenGame:
      | ReturnType<GamesService['buildGameOperationItem']>
      | ReturnType<GamesService['buildSlotOperationItem']>
      | null = null;
    if (registrationOpenSource?.type === 'session') {
      registrationOpenGame = this.sanitizeOperationItem(
        this.buildGameOperationItem(
          this.mergeSessionCartelaSummary(
            registrationOpenSource.data,
            cartelaSummaries,
          ),
          'registration',
          { ...buildOptions, includeCartelaSummary: true },
        ),
        isAdmin,
      );
    } else if (registrationOpenSource?.type === 'slot') {
      const slot = registrationOpenSource.data;
      const latestSession = slot.sessions?.[0];
      const slotWithSummary =
        latestSession?.status === GameStatus.READY
          ? {
              ...slot,
              sessions: [
                this.mergeSessionCartelaSummary(latestSession, cartelaSummaries),
              ],
            }
          : slot;

      registrationOpenGame = this.sanitizeOperationItem(
        this.buildSlotOperationItem(slotWithSummary, 'registration', {
          ...buildOptions,
          includeCartelaSummary: latestSession?.status === GameStatus.READY,
        }),
        isAdmin,
      );
    }

    const queue = queueItems.map((item) =>
      this.sanitizeOperationItem(
        item.kind === 'session'
          ? this.buildGameOperationItem(item.data, 'queue', {
              ...buildOptions,
              includeCartelaSummary: false,
            })
          : this.buildSlotOperationItem(item.data, 'queue', {
              ...buildOptions,
              includeCartelaSummary: false,
            }),
        isAdmin,
      ),
    );

    return {
      liveGame,
      checkingGame,
      registrationOpenGame,
      queue,
      timestamp: new Date().toISOString(),
    };
  }

  private getNextSlotOperationsSelect() {
    return {
      id: true,
      staticCode: true,
      name: true,
      gameType: true,
      status: true,
      entryFee: true,
      prizePerCartela: true,
      sortOrder: true,
      operationMode: true,
      registrationDurationSeconds: true,
      autoCallIntervalSeconds: true,
      gameRule: { select: { id: true, name: true, key: true } },
      sessions: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: {
          id: true,
          playCode: true,
          status: true,
          prizeAmount: true,
          companyRevenue: true,
          startedAt: true,
          finishedAt: true,
          winnerCartelaId: true,
          scheduledStartAt: true,
          _count: {
            select: { gameCartelas: true, calledNumbers: true },
          },
        },
      },
    };
  }

  private getSortOrderValue(sortOrder: number | null | undefined): number {
    return sortOrder ?? Number.MAX_SAFE_INTEGER;
  }

  private sortBySlotOrder<
    T extends { gameSlot: { sortOrder: number | null } },
  >(sessions: T[]): T[] {
    return [...sessions].sort(
      (left, right) =>
        this.getSortOrderValue(left.gameSlot.sortOrder) -
        this.getSortOrderValue(right.gameSlot.sortOrder),
    );
  }

  private sanitizeOperationItem<
    T extends { companyRevenue?: string },
  >(item: T, isAdmin: boolean): T {
    if (isAdmin) {
      return item;
    }

    const { companyRevenue: _companyRevenue, ...playerSafeItem } = item;
    return playerSafeItem as T;
  }

  /**
   * Build GameOperationItem from a GameSession (PLAYING, CHECKING, READY)
   */
  private buildGameOperationItem(
    session: any,
    operationStatus: 'live' | 'checking' | 'registration' | 'queue',
    options: {
      requestingUserId?: string;
      isAdmin?: boolean;
      includeCartelaSummary?: boolean;
    } = {},
  ) {
    const { requestingUserId, includeCartelaSummary = true } = options;
    const slot = session.gameSlot;
    const latestCalledNumber = session.calledNumbers?.[0] || null;

    // Calculate player-facing status
    const playerStatus =
      slot.status === GameStatus.NEXT || session.status === GameStatus.READY
        ? 'registrationOpen'
        : session.status === GameStatus.PLAYING
          ? 'playing'
          : session.status === GameStatus.WINNER_WINDOW
            ? 'winnerWindow'
            : session.status === GameStatus.CHECKING
              ? 'checking'
              : session.status === GameStatus.FINISHED
                ? 'finished'
                : 'cancelled';

    const winningCartelas =
      session.gameCartelas?.filter(
        (cartela: { isWinner: boolean }) => cartela.isWinner,
      ) ?? [];
    const winnerPayoutsSummary =
      winningCartelas.length > 0 && session.prizeAmount
        ? serializeWinnerPayoutsSummary(
            winningCartelas,
            session.prizeAmount,
            session.status === GameStatus.FINISHED
              ? requestingUserId
              : undefined,
          )
        : undefined;

    return {
      slotId: slot.id,
      sessionId: session.id,
      staticCode: slot.staticCode,
      playCode: session.playCode,
      rawStatus: session.status,
      playerStatus,
      operationStatus,
      gameRule: slot.gameRule,
      entryFee: session.entryFee?.toString() ?? '0',
      prizePerCartela: slot.prizePerCartela?.toString() ?? '0',
      prizeAmount: session.prizeAmount?.toString() ?? '0',
      companyRevenue: session.companyRevenue?.toString() ?? '0',
      registeredCartelasCount: session._count?.gameCartelas ?? 0,
      calledNumbersCount: session._count?.calledNumbers ?? 0,
      sortOrder: slot.sortOrder,
      winnerCartelaId: session.winnerCartelaId ?? null,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      operationMode: slot.operationMode ?? GameOperationMode.MANUAL,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      scheduledStartAt: session.scheduledStartAt ?? null,
      registrationOpen: session.status === GameStatus.READY || slot.status === GameStatus.NEXT,
      canStart:
        slot.operationMode !== GameOperationMode.AUTO &&
        (slot.status === GameStatus.NEXT || session.status === GameStatus.READY),
      canRegister: canRegisterForOperationMode(
        slot.operationMode ?? GameOperationMode.MANUAL,
        session.status,
      ),
      canCallNumber: session.status === GameStatus.PLAYING,
      canClaimBingo:
        session.status === GameStatus.PLAYING ||
        session.status === GameStatus.WINNER_WINDOW,
      winnerWindowStartedAt: session.winnerWindowStartedAt ?? null,
      winnerWindowEndsAt: session.winnerWindowEndsAt ?? null,
      latestCalledNumber,
      ...(options.isAdmin && session.status === GameStatus.PLAYING
        ? {
            autoCallEnabled: session.autoCallEnabled ?? false,
            autoCallIntervalMs:
              session.autoCallIntervalMs ?? 7000,
          }
        : {}),
      registeredCartelasSummary:
        includeCartelaSummary && session.gameCartelas
          ? buildRegisteredCartelasSummary(
              session.gameCartelas,
              session.gameCartelaReservations ?? [],
              requestingUserId,
            )
          : undefined,
      ...(options.isAdmin &&
      session.status === GameStatus.WINNER_WINDOW &&
      session.gameCartelas
        ? {
            winnerCartelasSummary: session.gameCartelas
              .filter((cartela: { isWinner: boolean }) => cartela.isWinner)
              .map((cartela: Parameters<typeof serializeWinnerCartelaSummary>[0]) =>
                serializeWinnerCartelaSummary(cartela),
              ),
          }
        : {}),
      ...((session.status === GameStatus.FINISHED ||
        (options.isAdmin && session.status === GameStatus.WINNER_WINDOW)) &&
      winnerPayoutsSummary
        ? { winnerPayoutsSummary }
        : {}),
    };
  }

  /**
   * Build GameOperationItem from a GameSlot (NEXT status, no active session)
   */
  private buildSlotOperationItem(
    slot: any,
    operationStatus: 'registration' | 'queue',
    options: {
      requestingUserId?: string;
      isAdmin?: boolean;
      includeCartelaSummary?: boolean;
    } = {},
  ) {
    const { requestingUserId, includeCartelaSummary = false } = options;
    const latestSession = slot.sessions?.[0];
    const hasActiveRegistrationSession =
      latestSession?.status === GameStatus.READY;

    return {
      slotId: slot.id,
      sessionId: hasActiveRegistrationSession
        ? (latestSession?.id ?? null)
        : null,
      staticCode: slot.staticCode,
      playCode: hasActiveRegistrationSession
        ? (latestSession?.playCode ?? null)
        : null,
      rawStatus: slot.status,
      playerStatus: 'registrationOpen' as const,
      operationStatus,
      gameRule: slot.gameRule,
      entryFee: slot.entryFee?.toString() ?? '0',
      prizePerCartela: slot.prizePerCartela?.toString() ?? '0',
      prizeAmount: hasActiveRegistrationSession
        ? (latestSession?.prizeAmount?.toString() ?? '0')
        : '0',
      companyRevenue: hasActiveRegistrationSession
        ? (latestSession?.companyRevenue?.toString() ?? '0')
        : '0',
      registeredCartelasCount: hasActiveRegistrationSession
        ? (latestSession?._count?.gameCartelas ?? 0)
        : 0,
      calledNumbersCount: hasActiveRegistrationSession
        ? (latestSession?._count?.calledNumbers ?? 0)
        : 0,
      sortOrder: slot.sortOrder,
      winnerCartelaId: hasActiveRegistrationSession
        ? (latestSession?.winnerCartelaId ?? null)
        : null,
      startedAt: hasActiveRegistrationSession
        ? (latestSession?.startedAt ?? null)
        : null,
      finishedAt: hasActiveRegistrationSession
        ? (latestSession?.finishedAt ?? null)
        : null,
      operationMode: slot.operationMode ?? GameOperationMode.MANUAL,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      scheduledStartAt: hasActiveRegistrationSession
        ? (latestSession?.scheduledStartAt ?? null)
        : null,
      registrationOpen: true,
      canStart: slot.operationMode !== GameOperationMode.AUTO,
      canRegister: hasActiveRegistrationSession
        ? canRegisterForOperationMode(
            slot.operationMode ?? GameOperationMode.MANUAL,
            latestSession!.status,
          )
        : true,
      canCallNumber: false,
      canClaimBingo: false,
      winnerWindowStartedAt: null,
      winnerWindowEndsAt: null,
      latestCalledNumber: null,
      registeredCartelasSummary:
        includeCartelaSummary &&
        hasActiveRegistrationSession &&
        latestSession?.gameCartelas
          ? buildRegisteredCartelasSummary(
              latestSession.gameCartelas,
              latestSession.gameCartelaReservations ?? [],
              requestingUserId,
            )
          : undefined,
    };
  }

  async getSlotDetail(slotId: string) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: gameSlotSelect,
    });
    if (!slot) throw new NotFoundException('Slot not found');
    return serializeGameSlotForPlayer(slot);
  }

  async getSessionDetail(sessionId: string, requestingUserId?: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });
    if (!session) throw new NotFoundException('Session not found');

    // Include cartela summary if requesting user is provided
    if (requestingUserId) {
      return serializeGameSessionWithCartelaSummary(session, requestingUserId);
    }

    return serializeGameSessionForPlayer(session);
  }

  async cancelOrphanedSession(sessionId: string, actorId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUnique({
        where: { id: sessionId },
        select: gameSessionSelect,
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

      const cancelledSession = await tx.gameSession.update({
        where: { id: sessionId },
        data: {
          status: GameStatus.CANCELLED,
          autoCallEnabled: false,
          nextAutoCallAt: null,
        },
        select: gameSessionSelect,
      });

      await this.gameQueueService.moveSlotToBack(
        tx,
        cancelledSession.gameSlotId,
      );

      const updatedSlot = await tx.gameSlot.findUnique({
        where: { id: cancelledSession.gameSlotId },
        select: gameSlotSelect,
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.session.force_cancel',
          entity: 'GameSession',
          entityId: sessionId,
          metadata: { previousStatus: session.status },
        });
      }

      return {
        cancelledSession,
        updatedSlot,
      };
    });

    const sessionPayload = serializeGameSession(result.cancelledSession);
    const playerSessionPayload = toPlayerGameSession(sessionPayload);

    this.realtimeService.emitToGame(
      sessionId,
      'game:status_changed',
      playerSessionPayload,
    );
    this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
    this.realtimeService.emitToPublicGames(
      'game:status_changed',
      playerSessionPayload,
    );

    if (result.updatedSlot) {
      const adminSlotPayload = withTerminalSessionContextForAdminSlot(
        serializeGameSlot(result.updatedSlot),
        sessionPayload,
      );
      const publicSlotPayload = withTerminalSessionContextForPlayerSlot(
        toPlayerGameSlot(adminSlotPayload),
        playerSessionPayload,
      );

      this.realtimeService.emitGameOperationUpdate({
        slotId: result.cancelledSession.gameSlotId,
        sessionId,
        adminPayload: adminSlotPayload,
        publicPayload: publicSlotPayload,
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

  startAutoCall(sessionId: string) {
    return this.autoCallService.startAutoCall(sessionId);
  }

  stopAutoCall(sessionId: string) {
    return this.autoCallService.stopAutoCall(sessionId);
  }

  async getCalledNumbers(sessionId: string) {
    return this.calledNumbersService.getCalledNumbers(sessionId);
  }

  async claimBingo(
    sessionId: string,
    userId: string,
    createBingoClaimDto: CreateBingoClaimDto,
  ) {
    this.userActionRateLimitService.assertWithinLimit(
      'bingo_claim',
      userId,
      sessionId,
    );

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

  private sortOperationalSlots<
    T extends { status: GameStatus; sortOrder: number | null },
  >(slots: T[]): T[] {
    const statusOrder: Record<GameStatus, number> = {
      [GameStatus.PLAYING]: 0,
      [GameStatus.WINNER_WINDOW]: 0,
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

  private buildSessionPrizeUpdatedPayload(
    session: Prisma.GameSessionGetPayload<{
      select: typeof registrationSessionMetricsSelect;
    }>,
  ) {
    return {
      sessionId: session.id,
      id: session.id,
      prizeAmount: session.prizeAmount.toString(),
      registeredCartelasCount: session._count.gameCartelas,
      calledNumbersCount: session._count.calledNumbers,
    };
  }

  private emitRegistrationSideEffects(params: {
    sessionId: string;
    userId: string;
    gameCartela: Prisma.GameCartelaGetPayload<{
      select: typeof myGameCartelaSelect;
    }>;
    updatedSession: Prisma.GameSessionGetPayload<{
      select: typeof registrationSessionMetricsSelect;
    }>;
  }) {
    const { sessionId, userId, gameCartela, updatedSession } = params;
    const prizePayload = this.buildSessionPrizeUpdatedPayload(updatedSession);

    this.realtimeService.emitToGame(sessionId, 'session:prize_updated', prizePayload);
    this.realtimeService.emitToAdmin('session:prize_updated', prizePayload);
    this.realtimeService.emitToPublicGames('session:prize_updated', prizePayload);

    const myCartelaPayload = serializeRegisteredCartelaSummary(
      {
        id: gameCartela.id,
        cartelaId: gameCartela.cartelaId,
        userId: gameCartela.userId,
        status: gameCartela.status,
        isWinner: gameCartela.isWinner,
        cartela: {
          id: gameCartela.cartela.id,
          number: gameCartela.cartela.number,
        },
      },
      userId,
    );
    this.realtimeService.emitToUser(userId, 'my_cartela:registered', {
      cartela: myCartelaPayload,
      sessionId,
      prizeAmount: updatedSession.prizeAmount.toString(),
      registeredCartelasCount: updatedSession._count.gameCartelas,
    });

    void this.notifySessionCartelasUpdated(sessionId);
    void this.emitWalletUpdated(userId);
  }

  private async loadSessionCartelaSummaries(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return new Map<
        string,
        Prisma.GameSessionGetPayload<{
          select: typeof sessionCartelaSummarySelect;
        }>
      >();
    }

    const summaries = await this.prisma.gameSession.findMany({
      where: { id: { in: sessionIds } },
      select: sessionCartelaSummarySelect,
    });

    return new Map(summaries.map((summary) => [summary.id, summary]));
  }

  private mergeSessionCartelaSummary<
    T extends { id: string },
  >(
    session: T,
    summaries: Map<
      string,
      Prisma.GameSessionGetPayload<{
        select: typeof sessionCartelaSummarySelect;
      }>
    >,
  ) {
    const summary = summaries.get(session.id);
    if (!summary) {
      return session;
    }

    return {
      ...session,
      gameCartelas: summary.gameCartelas,
      gameCartelaReservations: summary.gameCartelaReservations,
    };
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
