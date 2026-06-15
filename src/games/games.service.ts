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
import {
  RequestPerformanceContext,
  resolvePerformanceRole,
} from '../common/performance/request-performance.context';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { GameEngineService } from '../game-engine/game-engine.service';
import { GameRuleEvaluationService } from '../game-rules/game-rule-evaluation.service';
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
import { GameLifecycleService } from './game-lifecycle.service';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import {
  assertRegistrationAllowed,
  canRegisterForOperationMode,
} from './games.operation-mode';
import {
  serializeGameSlot,
  serializeGameSession,
  serializeGameSlotForPlayer,
  serializeGameSessionForPlayer,
  serializeGameCartela,
  serializeGameSessionWithCartelaSummary,
  serializeRegisteredCartelaSummary,
  serializeReservedCartelaSummary,
  buildRegisteredCartelasSummary,
  serializeWinnerPayoutsSummary,
  toPlayerGameSession,
  toPlayerGameSlot,
} from './games.mapper';
import { OperationsCacheService } from './operations-cache.service';
import {
  activeCartelaReservationSummarySelect,
  gameSlotSelect,
  gameSessionSelect,
  myGameCartelaSelect,
  operationsGameSlotSelect,
  operationsQueueSlotSelect,
  operationsSessionAdminExtraSelect,
  operationsSnapshotSessionSelect,
  registeredCartelaSummarySelect,
  registrationSessionMetricsSelect,
  reservationConfirmSelect,
} from './games.select';
import { buildSessionWinnerResults } from './session-winner-results.builder';

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gameEngineService: GameEngineService,
    private readonly calledNumbersService: CalledNumbersService,
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly gameRulesService: GameRulesService,
    private readonly gameRuleEvaluationService: GameRuleEvaluationService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly gameQueueService: GameQueueService,
    private readonly gameLifecycleService: GameLifecycleService,
    private readonly autoCallService: AutoCallService,
    private readonly userActionRateLimitService: UserActionRateLimitService,
    private readonly requestPerformance: RequestPerformanceContext,
    private readonly operationsCacheService: OperationsCacheService,
    private readonly gameTimingConfigService: GameTimingConfigService,
  ) {}

  async createGameSlot(createGameDto: CreateGameDto, actorId?: string) {
    const gameRule = await this.gameRulesService.getActiveGameRuleOrThrow(
      createGameDto.gameRuleId,
    );
    const operationMode =
      createGameDto.operationMode ?? GameOperationMode.MANUAL;
    const defaultRegistrationDurationSeconds =
      await this.gameTimingConfigService.getRegistrationDurationSeconds();
    const defaultAutoCallIntervalSeconds =
      await this.gameTimingConfigService.getAutoCallIntervalSeconds();
    const registrationDurationSeconds =
      operationMode === GameOperationMode.AUTO
        ? (createGameDto.registrationDurationSeconds ??
          defaultRegistrationDurationSeconds)
        : null;
    const autoCallIntervalSeconds =
      operationMode === GameOperationMode.AUTO
        ? (createGameDto.autoCallIntervalSeconds ??
          defaultAutoCallIntervalSeconds)
        : null;

    const { slot, autoSessionId } = await this.prisma.$transaction(async (tx) => {
      const sortOrder = await this.gameQueueService.assignSortOrderOnCreate(
        tx,
        gameRule.id,
      );
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
    const defaultRegistrationDurationSeconds =
      await this.gameTimingConfigService.getRegistrationDurationSeconds();
    const defaultAutoCallIntervalSeconds =
      await this.gameTimingConfigService.getAutoCallIntervalSeconds();
    const registrationDurationSeconds =
      targetMode === GameOperationMode.AUTO
        ? (dto.registrationDurationSeconds ??
          defaultRegistrationDurationSeconds)
        : null;
    const autoCallIntervalSeconds =
      targetMode === GameOperationMode.AUTO
        ? (dto.autoCallIntervalSeconds ?? defaultAutoCallIntervalSeconds)
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

    if (latestSession?.status === GameStatus.WINNER_WINDOW) {
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
    const slots = await this.prisma.gameSlot.findMany({
      where: { id: { in: slotIds } },
      select: { id: true, gameRuleId: true },
    });

    if (slots.length !== slotIds.length) {
      throw new BadRequestException('One or more queue slots were not found');
    }

    const slotById = new Map(slots.map((slot) => [slot.id, slot]));
    this.gameQueueService.assertReorderRuleDiversity(
      slotIds.map((slotId) => slotById.get(slotId)?.gameRuleId),
    );

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

  async clearQueue(actorId?: string) {
    const protectedSlotIds = new Set(
      (
        await this.prisma.gameSession.findMany({
          where: {
            status: {
              in: [
                GameStatus.PLAYING,
                GameStatus.WINNER_WINDOW,
                GameStatus.CHECKING,
              ],
            },
          },
          select: { gameSlotId: true },
        })
      ).map((session) => session.gameSlotId),
    );

    const registrationSession = await this.prisma.gameSession.findFirst({
      where: {
        status: GameStatus.READY,
        ...(protectedSlotIds.size > 0
          ? { gameSlotId: { notIn: [...protectedSlotIds] } }
          : {}),
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      orderBy: { gameSlot: { sortOrder: 'asc' } },
      select: {
        id: true,
        gameSlotId: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: GameCartelaStatus.CANCELLED } },
            },
          },
        },
      },
    });

    let cancelledEmptyRegistration = false;
    let keptRegistration = false;
    let registrationSlotIdToKeep: string | null = null;

    let emptyRegistrationSlotId: string | null = null;

    if (registrationSession) {
      if (registrationSession._count.gameCartelas === 0) {
        await this.gameLifecycleService.cancelSession(
          registrationSession.id,
          'queue_cleared',
          { actorId, requeueSlot: false },
        );

        emptyRegistrationSlotId = registrationSession.gameSlotId;
        cancelledEmptyRegistration = true;
      } else {
        keptRegistration = true;
        registrationSlotIdToKeep = registrationSession.gameSlotId;
      }
    }

    const excludedSlotIds = [
      ...protectedSlotIds,
      ...(registrationSlotIdToKeep ? [registrationSlotIdToKeep] : []),
    ];

    const batchClearResult = await this.prisma.gameSlot.updateMany({
      where: {
        status: GameStatus.NEXT,
        ...(excludedSlotIds.length > 0
          ? { id: { notIn: [...excludedSlotIds] } }
          : {}),
      },
      data: { status: GameStatus.CANCELLED },
    });

    let clearedSlotsCount = batchClearResult.count;

    if (
      emptyRegistrationSlotId &&
      !excludedSlotIds.includes(emptyRegistrationSlotId)
    ) {
      const nonNextClearResult = await this.prisma.gameSlot.updateMany({
        where: {
          id: emptyRegistrationSlotId,
          status: { notIn: [GameStatus.CANCELLED, GameStatus.NEXT] },
        },
        data: { status: GameStatus.CANCELLED },
      });
      clearedSlotsCount += nonNextClearResult.count;
    }

    if (actorId && (clearedSlotsCount > 0 || cancelledEmptyRegistration)) {
      await this.auditLogService.create(this.prisma, {
        actorId,
        action: 'admin.queue.clear',
        entity: 'GameSlot',
        metadata: {
          clearedSlotsCount,
          cancelledEmptyRegistration,
          keptRegistration,
        },
      });
    }

    this.operationsCacheService.invalidate();
    this.realtimeService.emitToAdmin('game:operation_updated', {
      updatedReason: 'queue_cleared',
      clearedSlotsCount,
      cancelledEmptyRegistration,
      keptRegistration,
      timestamp: new Date().toISOString(),
    });
    this.realtimeService.emitToPublicGames('game:operation_updated', {
      updatedReason: 'queue_cleared',
      timestamp: new Date().toISOString(),
    });

    return {
      clearedSlotsCount,
      cancelledEmptyRegistration,
      keptRegistration,
    };
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
            scheduledStartAt: true,
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
          session.scheduledStartAt,
        );

        const cartela = await tx.cartela.findUnique({
          where: { id: registerCartelaDto.cartelaId },
          select: { id: true },
        });

        if (!cartela) {
          throw new NotFoundException('Cartela not found');
        }

        await this.assertCartelaNotLockedByLiveRound(
          tx,
          session.id,
          cartela.id,
        );

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
    return this.requestPerformance.run(
      {
        operation: 'registerCartelaForSlot',
        userRole: UserRole.PLAYER,
      },
      () =>
        this.registerCartelaForSlotInternal(slotId, userId, registerCartelaDto),
      (result) => ({
        payloadBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
      }),
    );
  }

  private async registerCartelaForSlotInternal(
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
        scheduledStartAt: true,
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
          scheduledStartAt: true,
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

    assertRegistrationAllowed(
      slot.operationMode,
      session.status,
      session.scheduledStartAt,
    );

    // Delegate to the existing registerCartela method
    return this.registerCartela(session.id, userId, registerCartelaDto);
  }

  async getPlayerTimeConfig() {
    return this.gameTimingConfigService.getPlayerConfig();
  }

  async reserveCartela(
    sessionId: string,
    userId: string,
    cartelaId: string,
  ) {
    this.userActionRateLimitService.assertWithinLimit('reserve', userId);

    const now = new Date();
    const reservationTtlMs =
      await this.gameTimingConfigService.getCartelaHoldMs();
    const expiresAt = new Date(now.getTime() + reservationTtlMs);

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
          scheduledStartAt: true,
          gameSlot: { select: { operationMode: true } },
        },
      });

      if (!session) {
        throw new NotFoundException('Game session not found');
      }

      assertRegistrationAllowed(
        session.gameSlot.operationMode,
        session.status,
        session.scheduledStartAt,
      );

      const cartela = await tx.cartela.findUnique({
        where: { id: cartelaId },
        select: { id: true },
      });

      if (!cartela) {
        throw new NotFoundException('Cartela not found');
      }

      await this.assertCartelaNotLockedByLiveRound(
        tx,
        session.id,
        cartela.id,
        now,
      );

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
      select: { id: true, status: true, scheduledStartAt: true },
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
        select: { id: true, status: true, scheduledStartAt: true },
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

    assertRegistrationAllowed(
      slot.operationMode,
      session.status,
      session.scheduledStartAt,
    );

    return this.reserveCartela(session.id, userId, cartelaId);
  }

  async confirmReservation(reservationId: string, userId: string) {
    return this.requestPerformance.run(
      {
        operation: 'confirmReservation',
        userRole: UserRole.PLAYER,
      },
      () => this.confirmReservationInternal(reservationId, userId),
      (result) => ({
        payloadBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
      }),
    );
  }

  private async confirmReservationInternal(
    reservationId: string,
    userId: string,
  ) {
    this.userActionRateLimitService.assertWithinLimit('confirm', userId);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.gameCartelaReservation.findUnique({
          where: { id: reservationId },
          select: reservationConfirmSelect,
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

        const session = reservation.gameSession;
        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        assertRegistrationAllowed(
          session.gameSlot.operationMode,
          session.status,
          session.scheduledStartAt,
        );

        await this.assertCartelaNotLockedByLiveRound(
          tx,
          session.id,
          reservation.cartelaId,
        );

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: reservation.cartelaId,
            status: GameCartelaStatus.REGISTERED,
          },
          select: myGameCartelaSelect,
        });

        const walletSnapshot = await this.walletService.debitWallet(
          tx,
          userId,
          session.entryFee,
          {
            type: WalletTransactionType.GAME_ENTRY,
            referenceType: 'GAME_CARTELA',
            referenceId: gameCartela.id,
            description: `Game entry fee for ${session.playCode}`,
          },
        );

        const [updatedSession] = await Promise.all([
          tx.gameSession.update({
            where: { id: session.id },
            data: {
              prizeAmount: { increment: session.prizePerCartela },
              companyRevenue: { increment: session.companyFeePerCartela },
            },
            select: registrationSessionMetricsSelect,
          }),
          tx.gameCartelaReservation.update({
            where: { id: reservationId },
            data: { status: 'CONFIRMED' },
          }),
        ]);

        return { gameCartela, updatedSession, walletSnapshot };
      });

      if (!result.updatedSession) {
        throw new NotFoundException('Game session not found');
      }

      this.emitRegistrationSideEffects({
        sessionId: result.updatedSession.id,
        userId,
        gameCartela: result.gameCartela,
        updatedSession: result.updatedSession,
        walletSnapshot: result.walletSnapshot ?? undefined,
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
        _count: {
          select: {
            gameCartelas: { where: { status: { not: 'CANCELLED' } } },
          },
        },
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

    // When cancelling a slot, resolve every active session through the
    // unified lifecycle cancel so entry fees are refunded and cartelas are
    // cancelled. The slot itself is being removed, so it is not requeued.
    if (updateGameStatusDto.status === GameStatus.CANCELLED) {
      const blockingWinnerWindow = await this.prisma.gameSession.findFirst({
        where: { gameSlotId: slotId, status: GameStatus.WINNER_WINDOW },
        select: { id: true },
      });

      if (blockingWinnerWindow) {
        throw new BadRequestException(
          'Finalize the winner window before cancelling this game',
        );
      }

      const activeSessions = await this.prisma.gameSession.findMany({
        where: {
          gameSlotId: slotId,
          status: {
            in: [GameStatus.READY, GameStatus.PLAYING, GameStatus.CHECKING],
          },
        },
        select: { id: true },
      });

      for (const activeSession of activeSessions) {
        await this.gameLifecycleService.cancelSession(
          activeSession.id,
          'admin_cancelled',
          { actorId, requeueSlot: false },
        );
      }
    }

    const updatedSlot = await this.prisma.$transaction(async (tx) => {
      await tx.gameSlot.update({
        where: { id: slotId },
        data: {
          status: updateGameStatusDto.status,
        },
      });

      // When finishing a slot, resolve in-flight sessions so they don't
      // orphan and block future game starts.
      if (updateGameStatusDto.status === GameStatus.FINISHED) {
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

    this.operationsCacheService.invalidate();

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
  ) {
    const userRole = resolvePerformanceRole(
      requestingUserId,
      requestingUserRole,
    );

    return this.requestPerformance.run(
      {
        operation: 'getCurrentOperations',
        userRole,
      },
      async () => {
        const cacheKey = this.buildOperationsCacheKey(
          requestingUserId,
          requestingUserRole,
        );
        const cached = this.readOperationsCache(cacheKey);
        if (cached) {
          return cached;
        }

        const result = await this.getCurrentOperationsInternal(
          requestingUserId,
          requestingUserRole,
        );
        this.writeOperationsCache(cacheKey, result);
        return result;
      },
    );
  }

  async getRegistrationState(sessionId: string, requestingUserId?: string) {
    const userRole = resolvePerformanceRole(requestingUserId);

    return this.requestPerformance.run(
      {
        operation: 'getRegistrationState',
        userRole,
      },
      () => this.getRegistrationStateInternal(sessionId, requestingUserId),
      (result) => ({
        registeredCartelasSummaryCount:
          result.registeredCartelasSummary.length,
        myCartelaIdsCount: result.myCartelaIds.length,
      }),
    );
  }

  private async getRegistrationStateInternal(
    sessionId: string,
    requestingUserId?: string,
  ) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true },
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    const now = new Date();
    const [gameCartelas, gameCartelaReservations] = await Promise.all([
      this.prisma.gameCartela.findMany({
        where: {
          gameSessionId: sessionId,
          status: { not: GameCartelaStatus.CANCELLED },
        },
        select: registeredCartelaSummarySelect,
      }),
      this.prisma.gameCartelaReservation.findMany({
        where: {
          gameSessionId: sessionId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
        select: activeCartelaReservationSummarySelect,
      }),
    ]);

    const registeredCartelasSummary = buildRegisteredCartelasSummary(
      gameCartelas,
      gameCartelaReservations,
      requestingUserId,
    );
    let mergedSummary = registeredCartelasSummary;

    if (session.status === GameStatus.READY) {
      const [liveLockedCartelas, liveLockedReservations] = await Promise.all([
        this.prisma.gameCartela.findMany({
          where: {
            gameSessionId: { not: sessionId },
            status: { not: GameCartelaStatus.CANCELLED },
            gameSession: {
              status: {
                in: [
                  GameStatus.PLAYING,
                  GameStatus.CHECKING,
                  GameStatus.WINNER_WINDOW,
                ],
              },
            },
          },
          select: registeredCartelaSummarySelect,
        }),
        this.prisma.gameCartelaReservation.findMany({
          where: {
            gameSessionId: { not: sessionId },
            status: 'ACTIVE',
            expiresAt: { gt: now },
            gameSession: {
              status: {
                in: [
                  GameStatus.PLAYING,
                  GameStatus.CHECKING,
                  GameStatus.WINNER_WINDOW,
                ],
              },
            },
          },
          select: activeCartelaReservationSummarySelect,
        }),
      ]);

      if (liveLockedCartelas.length > 0 || liveLockedReservations.length > 0) {
        const summaryByCartelaId = new Map(
          registeredCartelasSummary.map((item) => [item.cartelaId, item]),
        );

        for (const item of liveLockedCartelas) {
          if (!summaryByCartelaId.has(item.cartelaId)) {
            summaryByCartelaId.set(
              item.cartelaId,
              serializeRegisteredCartelaSummary(item, requestingUserId),
            );
          }
        }

        for (const item of liveLockedReservations) {
          if (!summaryByCartelaId.has(item.cartelaId)) {
            summaryByCartelaId.set(
              item.cartelaId,
              serializeReservedCartelaSummary(item, requestingUserId),
            );
          }
        }

        mergedSummary = [...summaryByCartelaId.values()];
      }
    }

    const reservedCartelasSummary = mergedSummary.filter(
      (item) => item.status === 'RESERVED',
    );
    const myCartelaIds =
      requestingUserId == null
        ? []
        : gameCartelas
            .filter((cartela) => cartela.userId === requestingUserId)
            .map((cartela) => cartela.cartelaId);

    return {
      sessionId,
      registeredCartelasSummary: mergedSummary,
      reservedCartelasSummary,
      myCartelaIds,
    };
  }

  private async assertCartelaNotLockedByLiveRound(
    tx: Prisma.TransactionClient,
    sessionId: string,
    cartelaId: string,
    now: Date = new Date(),
  ) {
    const [liveRegistration, liveReservation] = await Promise.all([
      tx.gameCartela.findFirst({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId,
          status: { not: GameCartelaStatus.CANCELLED },
          gameSession: {
            status: {
              in: [
                GameStatus.PLAYING,
                GameStatus.CHECKING,
                GameStatus.WINNER_WINDOW,
              ],
            },
          },
        },
        select: { id: true },
      }),
      tx.gameCartelaReservation.findFirst({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          gameSession: {
            status: {
              in: [
                GameStatus.PLAYING,
                GameStatus.CHECKING,
                GameStatus.WINNER_WINDOW,
              ],
            },
          },
        },
        select: { id: true },
      }),
    ]);

    if (liveRegistration || liveReservation) {
      throw new ConflictException(
        'This cartela is already in use in the current live game',
      );
    }
  }

  private buildOperationsCacheKey(
    requestingUserId: string | undefined,
    requestingUserRole: UserRole,
  ): string {
    const role =
      requestingUserRole === UserRole.ADMIN ? UserRole.ADMIN : 'player';
    return `${role}:${requestingUserId ?? 'guest'}`;
  }

  private readOperationsCache(cacheKey: string):
    | Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>
    | null {
    return this.operationsCacheService.read(cacheKey);
  }

  private writeOperationsCache(
    cacheKey: string,
    payload: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): void {
    this.operationsCacheService.write(cacheKey, payload);
  }

  private async getCurrentOperationsInternal(
    _requestingUserId?: string,
    requestingUserRole: UserRole = UserRole.PLAYER,
  ): Promise<{
    liveGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
    checkingGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
    registrationOpenGame:
      | ReturnType<GamesService['buildFastSessionSnapshot']>
      | ReturnType<GamesService['buildFastRegistrationSlotSnapshot']>
      | null;
    queue: Array<
      | ReturnType<GamesService['buildFastSessionSnapshot']>
      | ReturnType<GamesService['buildFastQueueSlotSnapshot']>
    >;
    timestamp: string;
  }> {
    const isAdmin = requestingUserRole === UserRole.ADMIN;

    const [liveSession, checkingSession, registrationReadySession, nextSlots] =
      await Promise.all([
        this.findFirstOperationsSession(
          [GameStatus.PLAYING, GameStatus.WINNER_WINDOW],
          isAdmin,
        ),
        this.findFirstOperationsSession([GameStatus.CHECKING], isAdmin),
        this.findFirstOperationsSession([GameStatus.READY], isAdmin),
        this.prisma.gameSlot.findMany({
          where: { status: GameStatus.NEXT },
          select: operationsQueueSlotSelect,
          orderBy: { sortOrder: 'asc' },
        }),
      ]);

    const usedSlotIds = new Set<string>();
    if (liveSession) {
      usedSlotIds.add(liveSession.gameSlot.id);
    }
    if (checkingSession) {
      usedSlotIds.add(checkingSession.gameSlot.id);
    }

    let registrationOpenGame:
      | ReturnType<GamesService['buildFastSessionSnapshot']>
      | ReturnType<GamesService['buildFastRegistrationSlotSnapshot']>
      | null = null;

    if (
      registrationReadySession &&
      !usedSlotIds.has(registrationReadySession.gameSlot.id)
    ) {
      usedSlotIds.add(registrationReadySession.gameSlot.id);
      registrationOpenGame = this.sanitizeOperationItem(
        this.buildFastSessionSnapshot(
          registrationReadySession,
          'registration',
          { isAdmin, includePrizePerCartela: true },
        ),
        isAdmin,
      );
    } else if (nextSlots.length > 0) {
      const registrationSlot = nextSlots.find((slot) => !usedSlotIds.has(slot.id));
      if (registrationSlot) {
        usedSlotIds.add(registrationSlot.id);
        const readySession = await this.prisma.gameSession.findFirst({
          where: {
            gameSlotId: registrationSlot.id,
            status: GameStatus.READY,
          },
          orderBy: { createdAt: 'desc' },
          select: this.getOperationsSnapshotSelect(isAdmin),
        });

        registrationOpenGame = readySession
          ? this.sanitizeOperationItem(
              this.buildFastSessionSnapshot(readySession, 'registration', {
                isAdmin,
                includePrizePerCartela: true,
              }),
              isAdmin,
            )
          : this.sanitizeOperationItem(
              this.buildFastRegistrationSlotSnapshot(registrationSlot),
              isAdmin,
            );
      }
    }

    const queueReadySessions = await this.findQueueReadySessions(
      [...usedSlotIds],
      isAdmin,
    );

    const queueReadySlotIds = new Set(
      queueReadySessions.map((session) => session.gameSlot.id),
    );
    const queueNextSlots = nextSlots.filter(
      (slot) => !usedSlotIds.has(slot.id) && !queueReadySlotIds.has(slot.id),
    );
    const queue = [
      ...queueNextSlots.map((slot) =>
        this.sanitizeOperationItem(
          this.buildFastQueueSlotSnapshot(slot),
          isAdmin,
        ),
      ),
      ...queueReadySessions.map((session) =>
        this.sanitizeOperationItem(
          this.buildFastSessionSnapshot(session, 'queue', { isAdmin }),
          isAdmin,
        ),
      ),
    ].sort(
      (left, right) =>
        this.getSortOrderValue(left.sortOrder) -
        this.getSortOrderValue(right.sortOrder),
    );

    const dedupedQueue = this.dedupeOperationQueueItems(queue);

    let liveWinnerPayoutsSummary:
      | ReturnType<typeof serializeWinnerPayoutsSummary>
      | undefined;
    if (
      isAdmin &&
      liveSession?.status === GameStatus.WINNER_WINDOW &&
      liveSession.prizeAmount
    ) {
      const winners = await this.prisma.gameCartela.findMany({
        where: {
          gameSessionId: liveSession.id,
          isWinner: true,
          status: GameCartelaStatus.WINNER,
        },
        select: registeredCartelaSummarySelect,
      });
      liveWinnerPayoutsSummary = serializeWinnerPayoutsSummary(
        winners,
        liveSession.prizeAmount,
      );
    }

    return {
      liveGame: liveSession
        ? this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(liveSession, 'live', {
              isAdmin,
              winnerPayoutsSummary: liveWinnerPayoutsSummary,
            }),
            isAdmin,
          )
        : null,
      checkingGame: checkingSession
        ? this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(checkingSession, 'checking', {
              isAdmin,
            }),
            isAdmin,
          )
        : null,
      registrationOpenGame,
      queue: dedupedQueue,
      timestamp: new Date().toISOString(),
    };
  }

  private getOperationsSnapshotSelect(isAdmin: boolean) {
    return {
      ...operationsSnapshotSessionSelect,
      ...(isAdmin ? operationsSessionAdminExtraSelect : {}),
    };
  }

  private async findFirstOperationsSession(
    statuses: GameStatus[],
    isAdmin: boolean,
    excludeSlotIds: string[] = [],
  ) {
    return this.prisma.gameSession.findFirst({
      where: {
        status: { in: statuses },
        ...(excludeSlotIds.length > 0
          ? { gameSlotId: { notIn: excludeSlotIds } }
          : {}),
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      orderBy: { gameSlot: { sortOrder: 'asc' } },
      select: this.getOperationsSnapshotSelect(isAdmin),
    });
  }

  private async findQueueReadySessions(
    excludeSlotIds: string[],
    isAdmin: boolean,
  ) {
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: GameStatus.READY,
        ...(excludeSlotIds.length > 0
          ? { gameSlotId: { notIn: excludeSlotIds } }
          : {}),
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      orderBy: { gameSlot: { sortOrder: 'asc' } },
      select: this.getOperationsSnapshotSelect(isAdmin),
    });

    const seenSlotIds = new Set<string>();
    return sessions.filter((session) => {
      const slotId = session.gameSlot.id;
      if (seenSlotIds.has(slotId)) {
        return false;
      }

      seenSlotIds.add(slotId);
      return true;
    });
  }

  private getSortOrderValue(sortOrder: number | null | undefined): number {
    return sortOrder ?? Number.MAX_SAFE_INTEGER;
  }

  private dedupeOperationQueueItems<
    T extends { slotId: string; sessionId: string | null; sortOrder: number | null },
  >(items: T[]): T[] {
    const bySlotId = new Map<string, T>();

    for (const item of items) {
      const existing = bySlotId.get(item.slotId);
      if (!existing) {
        bySlotId.set(item.slotId, item);
        continue;
      }

      if (!existing.sessionId && item.sessionId) {
        bySlotId.set(item.slotId, item);
      }
    }

    return [...bySlotId.values()].sort(
      (left, right) =>
        this.getSortOrderValue(left.sortOrder) -
        this.getSortOrderValue(right.sortOrder),
    );
  }

  private sanitizeOperationItem<T extends Record<string, unknown>>(
    item: T,
    isAdmin: boolean,
  ): T {
    if (isAdmin) {
      return item;
    }

    const {
      companyRevenue: _companyRevenue,
      winnerPayoutsSummary: _winnerPayoutsSummary,
      autoCallEnabled: _autoCallEnabled,
      autoCallIntervalMs: _autoCallIntervalMs,
      ...playerSafeItem
    } = item;

    return playerSafeItem as T;
  }

  private buildFastSessionSnapshot(
    session: {
      id: string;
      playCode: string;
      entryFee: Prisma.Decimal;
      prizePerCartela: Prisma.Decimal;
      prizeAmount: Prisma.Decimal;
      status: GameStatus;
      scheduledStartAt: Date | null;
      winnerWindowEndsAt: Date | null;
      nextAutoCallAt: Date | null;
      companyRevenue?: Prisma.Decimal;
      autoCallEnabled?: boolean;
      autoCallIntervalMs?: number | null;
      gameSlot: {
        id: string;
        staticCode: string;
        sortOrder: number | null;
        operationMode: GameOperationMode | null;
        status: GameStatus;
        registrationDurationSeconds?: number | null;
        autoCallIntervalSeconds?: number | null;
        gameRule: { id: string; name: string; key: string } | null;
      };
      calledNumbers?: Array<{
        letter: string;
        number: number;
        order: number;
      }>;
      _count: { gameCartelas: number; calledNumbers: number };
    },
    operationStatus: 'live' | 'checking' | 'registration' | 'queue',
    options: {
      isAdmin: boolean;
      includePrizePerCartela?: boolean;
      winnerPayoutsSummary?: ReturnType<typeof serializeWinnerPayoutsSummary>;
    },
  ) {
    const slot = session.gameSlot;
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

    return {
      slotId: slot.id,
      sessionId: session.id,
      staticCode: slot.staticCode,
      playCode: session.playCode,
      rawStatus: session.status,
      playerStatus,
      operationStatus,
      operationMode: slot.operationMode ?? GameOperationMode.MANUAL,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      gameRule: slot.gameRule
        ? {
            id: slot.gameRule.id,
            key: slot.gameRule.key,
            name: slot.gameRule.name,
          }
        : null,
      entryFee: session.entryFee.toString(),
      ...(options.includePrizePerCartela
        ? { prizePerCartela: session.prizePerCartela.toString() }
        : {}),
      prizeAmount: session.prizeAmount.toString(),
      registeredCartelasCount: session._count.gameCartelas,
      calledNumbersCount: session._count.calledNumbers,
      latestCalledNumber: session.calledNumbers?.[0] ?? null,
      scheduledStartAt: session.scheduledStartAt,
      nextAutoCallAt: session.nextAutoCallAt,
      winnerWindowEndsAt: session.winnerWindowEndsAt,
      sortOrder: slot.sortOrder,
      canRegister: canRegisterForOperationMode(
        slot.operationMode ?? GameOperationMode.MANUAL,
        session.status,
        session.scheduledStartAt,
      ),
      canStart:
        slot.operationMode !== GameOperationMode.AUTO &&
        (slot.status === GameStatus.NEXT || session.status === GameStatus.READY),
      canCallNumber: session.status === GameStatus.PLAYING,
      ...(options.isAdmin
        ? {
            companyRevenue: session.companyRevenue?.toString() ?? '0',
            autoCallEnabled: session.autoCallEnabled ?? false,
            autoCallIntervalMs: session.autoCallIntervalMs ?? 7000,
            ...(options.winnerPayoutsSummary
              ? { winnerPayoutsSummary: options.winnerPayoutsSummary }
              : {}),
          }
        : {}),
    };
  }

  private buildFastRegistrationSlotSnapshot(slot: {
    id: string;
    staticCode: string;
    entryFee: Prisma.Decimal;
    prizePerCartela: Prisma.Decimal;
    sortOrder: number | null;
    operationMode: GameOperationMode | null;
    status: GameStatus;
    registrationDurationSeconds?: number | null;
    autoCallIntervalSeconds?: number | null;
    gameRule: { id: string; name: string; key: string } | null;
  }) {
    return {
      slotId: slot.id,
      sessionId: null,
      staticCode: slot.staticCode,
      playCode: null,
      rawStatus: slot.status,
      playerStatus: 'registrationOpen' as const,
      operationStatus: 'registration' as const,
      operationMode: slot.operationMode ?? GameOperationMode.MANUAL,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      gameRule: slot.gameRule
        ? {
            id: slot.gameRule.id,
            key: slot.gameRule.key,
            name: slot.gameRule.name,
          }
        : null,
      entryFee: slot.entryFee.toString(),
      prizePerCartela: slot.prizePerCartela.toString(),
      prizeAmount: '0',
      registeredCartelasCount: 0,
      calledNumbersCount: 0,
      latestCalledNumber: null,
      scheduledStartAt: null,
      nextAutoCallAt: null,
      winnerWindowEndsAt: null,
      sortOrder: slot.sortOrder,
      canRegister: true,
      canStart: slot.operationMode !== GameOperationMode.AUTO,
      canCallNumber: false,
    };
  }

  private buildFastQueueSlotSnapshot(slot: {
    id: string;
    staticCode: string;
    entryFee: Prisma.Decimal;
    sortOrder: number | null;
    operationMode: GameOperationMode | null;
    status: GameStatus;
    registrationDurationSeconds?: number | null;
    autoCallIntervalSeconds?: number | null;
    gameRule: { id: string; name: string; key: string } | null;
  }) {
    return {
      slotId: slot.id,
      sessionId: null,
      staticCode: slot.staticCode,
      rawStatus: slot.status,
      playerStatus: 'registrationOpen' as const,
      operationStatus: 'queue' as const,
      operationMode: slot.operationMode ?? GameOperationMode.MANUAL,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      gameRule: slot.gameRule
        ? {
            id: slot.gameRule.id,
            key: slot.gameRule.key,
            name: slot.gameRule.name,
          }
        : null,
      entryFee: slot.entryFee.toString(),
      sortOrder: slot.sortOrder,
      status: slot.status,
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

  async getSessionWinnerResults(
    sessionId: string,
    requestingUserId?: string,
  ) {
    const results = await buildSessionWinnerResults(
      this.prisma,
      sessionId,
      this.gameRuleEvaluationService,
      requestingUserId,
    );

    if (results.length === 0) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true },
      });
      if (!session) {
        throw new NotFoundException('Game session not found');
      }
      if (session.status !== GameStatus.FINISHED) {
        throw new BadRequestException(
          'Winner results are available only for finished sessions',
        );
      }
    }

    return {
      sessionId,
      winnerResults: results,
    };
  }

  /**
   * Admin force-cancel. Delegates to the unified lifecycle cancel which
   * refunds entry fees, cancels cartelas, requeues the slot and emits the
   * terminal events. Allows READY, PLAYING and CHECKING sessions;
   * WINNER_WINDOW must be finalized early instead.
   */
  async cancelOrphanedSession(sessionId: string, actorId?: string) {
    const result = await this.gameLifecycleService.cancelSession(
      sessionId,
      'admin_cancelled',
      { actorId },
    );

    if (result.aborted) {
      throw new ConflictException('Session could not be cancelled');
    }

    return {
      success: true,
      sessionId,
      refundedCount: result.refundedCount,
      alreadyCancelled: result.alreadyCancelled ?? false,
    };
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
    return this.requestPerformance.run(
      {
        operation: 'getMyCartelas',
        userRole: UserRole.PLAYER,
      },
      async () => {
        const gameCartelas = await this.prisma.gameCartela.findMany({
          where: {
            gameSessionId: sessionId,
            userId,
          },
          orderBy: { createdAt: 'desc' },
          select: myGameCartelaSelect,
        });

        return gameCartelas.map(serializeGameCartela);
      },
      (result) => ({
        cartelaCount: result.length,
      }),
    );
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
    walletSnapshot?: Awaited<ReturnType<WalletService['debitWallet']>>;
  }) {
    const { sessionId, userId, gameCartela, updatedSession, walletSnapshot } =
      params;
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

    this.operationsCacheService.invalidate();
    this.realtimeService.emitSessionCartelasUpdated({
      sessionId,
      slotId: updatedSession.gameSlotId,
      prizeAmount: updatedSession.prizeAmount.toString(),
      registeredCartelasCount: updatedSession._count.gameCartelas,
    });

    if (walletSnapshot) {
      this.realtimeService.emitToUser(userId, 'wallet:updated', walletSnapshot);
      this.realtimeService.emitToAdmin('wallet:updated', walletSnapshot);
    } else {
      void this.emitWalletUpdated(userId);
    }
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
