import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GameCartelaStatus,
  GameCategory,
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
import {
  BulkRegisterCartelaItemDto,
  BulkRegisterCartelasDto,
} from './dto/bulk-register-cartelas.dto';
import { BulkReserveCartelasDto } from './dto/bulk-reserve-cartelas.dto';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { UpdateSlotEntryFeeDto } from './dto/update-slot-entry-fee.dto';
import { UpdateBigGameScheduleDto } from './dto/update-big-game-schedule.dto';
import { UpdateSlotOperationModeDto } from './dto/update-slot-operation-mode.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { AutoCallService } from './auto-call.service';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import {
  buildSessionMoneyConfig,
  cartelaPoolForCategory,
  compareCategoryPriority,
  compareSortOrder,
  getBonusCartelaLimit,
  getRuntimeQueuePriority,
  isBonusLikeCategory,
  isBonusCategory,
  isBigGameCategory,
  isBigGotdCategory,
  isFreeEntryCategory,
  isFixedPrizeCategory,
  isStandardQueueCategory,
  liveCartelaPoolCategoryFilter,
} from './game-category.util';
import { GameLifecycleService } from './game-lifecycle.service';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { GameOperationRepairService } from './game-operation-repair.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import {
  assertBigGameRegistrationAllowed,
  assertRegistrationAllowed,
  canRegisterForBigGameWindow,
  canRegisterForOperationMode,
} from './games.operation-mode';
import {
  serializeGameSlot,
  serializeGameSession,
  serializeGameSlotForPlayer,
  serializeGameSessionForPlayer,
  serializeGameCartela,
  serializeMyAttendedHistoryItem,
  serializeGameSessionWithCartelaSummary,
  serializeRegisteredCartelaSummary,
  serializeReservedCartelaSummary,
  buildRegisteredCartelasSummary,
  buildSessionCartelaChange,
  serializeWinnerPayoutsSummary,
  toPlayerGameSession,
  toPlayerGameSlot,
  type SessionCartelaChange,
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
import { buildSessionOutcomeSummary } from './session-outcome-summary.builder';
import { buildSessionWinnerResults } from './session-winner-results.builder';

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

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
    private readonly autoReadyCountdownRepairService: AutoReadyCountdownRepairService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
    private readonly invariantsService: GameOperationInvariantsService,
    private readonly repairService: GameOperationRepairService,
  ) {}

  async createGameSlot(createGameDto: CreateGameDto, actorId?: string) {
    const gameRule = await this.gameRulesService.getActiveGameRuleOrThrow(
      createGameDto.gameRuleId,
    );
    const category = createGameDto.category ?? GameCategory.NORMAL;
    const isBigGotd = isBigGotdCategory(category);
    const isBonusLike = isBonusLikeCategory(category);
    const isBigGame = isBigGameCategory(category);
    const operationMode =
      createGameDto.operationMode ?? GameOperationMode.MANUAL;
    const fixedPrizeAmount = isFixedPrizeCategory(category)
      ? this.parsePositiveMoneyOrThrow(
          createGameDto.fixedPrizeAmount,
          'fixedPrizeAmount',
        )
      : null;
    const maxCartelasPerPlayer = isBonusLike
      ? getBonusCartelaLimit(createGameDto.maxCartelasPerPlayer)
      : isBigGame
        ? this.parsePositiveIntOrThrow(
            createGameDto.maxCartelasPerPlayer,
            'maxCartelasPerPlayer',
            'big games',
          )
        : null;
    const fixedPrizeEntryFee =
      isBigGame || isBigGotd
        ? this.parsePositiveMoneyOrThrow(createGameDto.entryFee, 'entryFee')
        : null;
    const registrationOpensAt = isBigGame
      ? this.parseDateTimeOrThrow(
          createGameDto.registrationOpensAt,
          'registrationOpensAt',
          'big games',
        )
      : null;
    const playStartAt = isBigGame
      ? this.parseDateTimeOrThrow(
          createGameDto.playStartAt,
          'playStartAt',
          'big games',
        )
      : null;
    if (isBigGame && registrationOpensAt!.getTime() >= playStartAt!.getTime()) {
      throw new BadRequestException(
        'registrationOpensAt must be before playStartAt for big games',
      );
    }
    const defaultRegistrationDurationSeconds =
      await this.gameTimingConfigService.getRegistrationDurationSeconds();
    const defaultAutoCallIntervalSeconds =
      await this.gameTimingConfigService.getAutoCallIntervalSeconds();
    const registrationDurationSeconds = isBigGame
      ? null
      : operationMode === GameOperationMode.AUTO
        ? (createGameDto.registrationDurationSeconds ??
          defaultRegistrationDurationSeconds)
        : null;
    const autoCallIntervalSeconds = isBigGame
      ? null
      : operationMode === GameOperationMode.AUTO
        ? (createGameDto.autoCallIntervalSeconds ??
          defaultAutoCallIntervalSeconds)
        : null;

    const { slot, autoSessionId } = await this.prisma.$transaction(
      async (tx) => {
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
            status: isBigGame ? GameStatus.READY : GameStatus.NEXT,
            category,
            ...(isBigGame || isBigGotd
              ? {
                  entryFee: fixedPrizeEntryFee!,
                  prizePerCartela: new Prisma.Decimal(0),
                }
              : {}),
            fixedPrizeAmount,
            maxCartelasPerPlayer,
            removeAfterFinish: isBonusLike || isBigGame,
            operationMode,
            registrationDurationSeconds,
            autoCallIntervalSeconds,
          },
          select: gameSlotSelect,
        });

        let createdAutoSessionId: string | null = null;

        if (operationMode === GameOperationMode.AUTO || isBigGame) {
          const scheduledStartAt = isBigGame
            ? playStartAt!
            : new Date(Date.now() + registrationDurationSeconds! * 1000);
          const sessionMoneyConfig = buildSessionMoneyConfig(createdSlot);

          const createdAutoSession = await tx.gameSession.create({
            data: {
              gameSlotId: createdSlot.id,
              playCode: this.generatePlayCode(),
              entryFee: sessionMoneyConfig.entryFee,
              prizePerCartela: sessionMoneyConfig.prizePerCartela,
              companyFeePerCartela: sessionMoneyConfig.companyFeePerCartela,
              prizeAmount: sessionMoneyConfig.prizeAmount,
              companyRevenue: sessionMoneyConfig.companyRevenue,
              status: GameStatus.READY,
              registrationOpensAt: isBigGame ? registrationOpensAt : null,
              scheduledStartAt,
            },
            select: { id: true },
          });
          createdAutoSessionId = createdAutoSession.id;

          this.lifecycleLogger?.sessionCreated?.({
            sessionId: createdAutoSession.id,
            slotId: createdSlot.id,
            slotStatus: createdSlot.status,
            sessionStatus: GameStatus.READY,
            category: createdSlot.category,
            operationMode: createdSlot.operationMode,
            reason: 'admin_create_slot',
            scheduledStartAt,
          });
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
              category,
              fixedPrizeAmount: fixedPrizeAmount?.toString() ?? null,
              entryFee: fixedPrizeEntryFee?.toString() ?? null,
              maxCartelasPerPlayer,
              registrationOpensAt: registrationOpensAt?.toISOString() ?? null,
              playStartAt: playStartAt?.toISOString() ?? null,
              operationMode,
              registrationDurationSeconds,
              autoCallIntervalSeconds,
            },
          });
        }

        return { slot: createdSlot, autoSessionId: createdAutoSessionId };
      },
    );

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
        category: true,
        fixedPrizeAmount: true,
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
                  ? new Date(Date.now() + registrationDurationSeconds! * 1000)
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
            const sessionMoneyConfig = buildSessionMoneyConfig(slot);

            const createdSession = await tx.gameSession.create({
              data: {
                gameSlotId: slotId,
                playCode: this.generatePlayCode(),
                entryFee: sessionMoneyConfig.entryFee,
                prizePerCartela: sessionMoneyConfig.prizePerCartela,
                companyFeePerCartela: sessionMoneyConfig.companyFeePerCartela,
                prizeAmount: sessionMoneyConfig.prizeAmount,
                companyRevenue: sessionMoneyConfig.companyRevenue,
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

    if (targetMode === GameOperationMode.AUTO && sessionId) {
      await this.autoReadyCountdownRepairService.ensureAutoReadySessionHasCountdown(
        sessionId,
      );
    }

    if (sessionId) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: gameSessionSelect,
      });

      if (!session) {
        throw new NotFoundException(
          'Session not found after operation mode switch',
        );
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
      throw new NotFoundException(
        'Game slot not found after operation mode switch',
      );
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
      select: { id: true, gameRuleId: true, category: true },
    });

    if (slots.length !== slotIds.length) {
      throw new BadRequestException('One or more queue slots were not found');
    }

    if (slots.some((slot) => isBigGameCategory(slot.category))) {
      throw new BadRequestException(
        'Big Game slots are scheduled separately and cannot be reordered in the queue',
      );
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
          category: { not: GameCategory.BIG_GAME },
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
        category: { not: GameCategory.BIG_GAME },
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
        category: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (
      slot.status !== GameStatus.NEXT &&
      !(slot.status === GameStatus.READY && isBigGameCategory(slot.category))
    ) {
      throw new BadRequestException(
        'Entry fee can only be updated for upcoming queued games or scheduled big games before play starts',
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

    if (isFreeEntryCategory(slot.category)) {
      throw new BadRequestException(
        'Entry fee cannot be changed for bonus games',
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

  async updateBigGameSchedule(
    slotId: string,
    updateBigGameScheduleDto: UpdateBigGameScheduleDto,
    actorId?: string,
  ) {
    if (
      !updateBigGameScheduleDto.registrationOpensAt &&
      !updateBigGameScheduleDto.playStartAt
    ) {
      throw new BadRequestException(
        'At least one of registrationOpensAt or playStartAt must be provided',
      );
    }

    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        category: true,
        status: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (!isBigGameCategory(slot.category)) {
      throw new BadRequestException(
        'Schedule can only be updated for big game slots',
      );
    }

    const session = await this.prisma.gameSession.findFirst({
      where: { gameSlotId: slotId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        registrationOpensAt: true,
        scheduledStartAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Big game session not found');
    }

    if (session.status !== GameStatus.READY) {
      throw new BadRequestException(
        'Big game schedule can only be updated before play starts',
      );
    }

    const registrationOpensAt = updateBigGameScheduleDto.registrationOpensAt
      ? this.parseDateTimeOrThrow(
          updateBigGameScheduleDto.registrationOpensAt,
          'registrationOpensAt',
          'big games',
        )
      : session.registrationOpensAt;
    const playStartAt = updateBigGameScheduleDto.playStartAt
      ? this.parseDateTimeOrThrow(
          updateBigGameScheduleDto.playStartAt,
          'playStartAt',
          'big games',
        )
      : session.scheduledStartAt;

    if (!registrationOpensAt || !playStartAt) {
      throw new BadRequestException(
        'Both registrationOpensAt and playStartAt must be set on the big game session',
      );
    }

    if (registrationOpensAt.getTime() >= playStartAt.getTime()) {
      throw new BadRequestException(
        'registrationOpensAt must be before playStartAt for big games',
      );
    }

    const updatedSession = await this.prisma.$transaction(async (tx) => {
      const savedSession = await tx.gameSession.update({
        where: { id: session.id },
        data: {
          registrationOpensAt,
          scheduledStartAt: playStartAt,
        },
        select: gameSessionSelect,
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.big_game_schedule_update',
          entity: 'GameSession',
          entityId: session.id,
          metadata: {
            registrationOpensAt: registrationOpensAt.toISOString(),
            playStartAt: playStartAt.toISOString(),
          },
        });
      }

      return savedSession;
    });

    this.operationsCacheService.invalidate();

    const payload = serializeGameSession(updatedSession);
    const publicPayload = toPlayerGameSession(payload);

    this.realtimeService.emitToSlot(slotId, 'session:updated', publicPayload);
    this.realtimeService.emitToAdmin('session:updated', payload);
    this.realtimeService.emitToPublicGames('session:updated', publicPayload);
    this.realtimeService.emitGameOperationUpdate({
      slotId,
      sessionId: session.id,
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
        const now = new Date();
        const session = await tx.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            playCode: true,
            entryFee: true,
            prizePerCartela: true,
            companyFeePerCartela: true,
            status: true,
            registrationOpensAt: true,
            scheduledStartAt: true,
            gameSlot: {
              select: {
                operationMode: true,
                category: true,
                maxCartelasPerPlayer: true,
              },
            },
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        this.assertSessionRegistrationAllowed(session);

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
          session.gameSlot.category,
        );
        await this.assertCategoryCartelaLimit(
          tx,
          session.id,
          userId,
          session.gameSlot.category,
          session.gameSlot.maxCartelasPerPlayer,
        );

        const activeReservation = await tx.gameCartelaReservation.findFirst({
          where: {
            gameSessionId: session.id,
            cartelaId: cartela.id,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: {
            id: true,
            userId: true,
          },
        });

        if (activeReservation && activeReservation.userId !== userId) {
          throw new ConflictException(
            'Another player is choosing this cartela',
          );
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

        const walletSnapshot = isFreeEntryCategory(session.gameSlot.category)
          ? undefined
          : await this.walletService.debitWallet(tx, userId, session.entryFee, {
              type: WalletTransactionType.GAME_ENTRY,
              referenceType: 'GAME_CARTELA',
              referenceId: gameCartela.id,
              description: `Game entry fee for ${session.playCode}`,
            });

        const updatedSession = isBonusCategory(session.gameSlot.category)
          ? await tx.gameSession.findUnique({
              where: { id: session.id },
              select: registrationSessionMetricsSelect,
            })
          : await tx.gameSession.update({
              where: { id: session.id },
              data: {
                prizeAmount: { increment: session.prizePerCartela },
                companyRevenue: { increment: session.companyFeePerCartela },
              },
              select: registrationSessionMetricsSelect,
            });

        if (activeReservation?.userId === userId) {
          await tx.gameCartelaReservation.update({
            where: { id: activeReservation.id },
            data: { status: 'CONFIRMED' },
          });
        }

        return { gameCartela, updatedSession, walletSnapshot };
      });

      if (!result.updatedSession) {
        throw new NotFoundException('Game session not found');
      }

      this.emitRegistrationSideEffects({
        sessionId,
        userId,
        gameCartela: result.gameCartela,
        updatedSession: result.updatedSession,
        walletSnapshot: result.walletSnapshot,
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
    const session = await this.resolveRegistrationSessionForSlot(slotId);
    return this.registerCartela(session.id, userId, registerCartelaDto);
  }

  async registerCartelasForSlotBulk(
    slotId: string,
    userId: string,
    bulkRegisterCartelasDto: BulkRegisterCartelasDto,
  ) {
    return this.requestPerformance.run(
      {
        operation: 'registerCartelasForSlotBulk',
        userRole: UserRole.PLAYER,
      },
      () =>
        this.registerCartelasForSlotBulkInternal(
          slotId,
          userId,
          bulkRegisterCartelasDto,
        ),
      (result) => ({
        payloadBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
      }),
    );
  }

  private async registerCartelasForSlotBulkInternal(
    slotId: string,
    userId: string,
    bulkRegisterCartelasDto: BulkRegisterCartelasDto,
  ) {
    const session = await this.resolveRegistrationSessionForSlot(slotId);
    return this.registerCartelasBulkInternal(
      session.id,
      userId,
      bulkRegisterCartelasDto,
    );
  }

  private async registerCartelasBulkInternal(
    sessionId: string,
    userId: string,
    bulkRegisterCartelasDto: BulkRegisterCartelasDto,
  ) {
    let txResult:
      | {
          successes: Prisma.GameCartelaGetPayload<{
            select: typeof myGameCartelaSelect;
          }>[];
          failures: Array<{
            cartelaId: string;
            cartelaNumber: number;
            reason: string;
          }>;
          updatedSession: Prisma.GameSessionGetPayload<{
            select: typeof registrationSessionMetricsSelect;
          }> | null;
          walletSnapshot?:
            | Awaited<ReturnType<WalletService['debitWallet']>>
            | undefined;
        }
      | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        txResult = await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const session = await tx.gameSession.findUnique({
              where: { id: sessionId },
              select: {
                id: true,
                playCode: true,
                entryFee: true,
                prizePerCartela: true,
                companyFeePerCartela: true,
                status: true,
                registrationOpensAt: true,
                scheduledStartAt: true,
                gameSlot: {
                  select: {
                    operationMode: true,
                    category: true,
                    maxCartelasPerPlayer: true,
                  },
                },
              },
            });

            if (!session) {
              throw new NotFoundException('Game session not found');
            }

            this.assertSessionRegistrationAllowed(session, now);

            const bonusLikeCategory = isBonusLikeCategory(
              session.gameSlot.category,
            );
            const freeEntryCategory = isFreeEntryCategory(
              session.gameSlot.category,
            );
            const requestedCartelas = bulkRegisterCartelasDto.cartelas;
            const uniqueCartelaIds = [
              ...new Set(requestedCartelas.map((cartela) => cartela.cartelaId)),
            ];

            const liveLockedCartelaIds = await this.findLiveLockedCartelaIds(
              tx,
              session.id,
              uniqueCartelaIds,
              session.gameSlot.category,
              now,
            );

            const [
              myRegistrations,
              sessionRegistrations,
              cartelaRecords,
              activeReservations,
              myExistingRegistrationCount,
            ] = await Promise.all([
              tx.gameCartela.findMany({
                where: {
                  gameSessionId: sessionId,
                  userId,
                  cartelaId: { in: uniqueCartelaIds },
                },
                select: myGameCartelaSelect,
              }),
              tx.gameCartela.findMany({
                where: {
                  gameSessionId: sessionId,
                  cartelaId: { in: uniqueCartelaIds },
                  status: { not: GameCartelaStatus.CANCELLED },
                },
                select: { cartelaId: true, userId: true },
              }),
              tx.cartela.findMany({
                where: { id: { in: uniqueCartelaIds } },
                select: { id: true },
              }),
              tx.gameCartelaReservation.findMany({
                where: {
                  gameSessionId: session.id,
                  cartelaId: { in: uniqueCartelaIds },
                  status: 'ACTIVE',
                  expiresAt: { gt: now },
                },
                select: { id: true, cartelaId: true, userId: true },
              }),
              bonusLikeCategory
                ? tx.gameCartela.count({
                    where: {
                      gameSessionId: sessionId,
                      userId,
                      status: { not: GameCartelaStatus.CANCELLED },
                    },
                  })
                : Promise.resolve(0),
            ]);

            const myRegistrationByCartelaId = new Map(
              myRegistrations.map((registration) => [
                registration.cartelaId,
                registration,
              ]),
            );
            const sessionRegistrationByCartelaId = new Map(
              sessionRegistrations.map((registration) => [
                registration.cartelaId,
                registration,
              ]),
            );
            const knownCartelaIds = new Set(
              cartelaRecords.map((cartela) => cartela.id),
            );
            const reservationByCartelaId = new Map(
              activeReservations.map((reservation) => [
                reservation.cartelaId,
                reservation,
              ]),
            );

            const successes: Prisma.GameCartelaGetPayload<{
              select: typeof myGameCartelaSelect;
            }>[] = [];
            const failures: Array<{
              cartelaId: string;
              cartelaNumber: number;
              reason: string;
            }> = [];
            let walletSnapshot:
              | Awaited<ReturnType<WalletService['debitWallet']>>
              | undefined;
            let walletFailureMessage: string | null = null;
            let registeredInTx = 0;
            let remainingBonusSlots = bonusLikeCategory
              ? getBonusCartelaLimit(session.gameSlot.maxCartelasPerPlayer) -
                myExistingRegistrationCount
              : Number.POSITIVE_INFINITY;
            const reservationIdsToConfirm: string[] = [];

            for (const cartela of requestedCartelas) {
              if (walletFailureMessage != null) {
                failures.push(
                  this.buildBulkRegistrationFailure(
                    cartela,
                    walletFailureMessage,
                  ),
                );
                continue;
              }

              try {
                const existingRegistration = myRegistrationByCartelaId.get(
                  cartela.cartelaId,
                );

                if (existingRegistration) {
                  successes.push(existingRegistration);
                  continue;
                }

                const takenRegistration = sessionRegistrationByCartelaId.get(
                  cartela.cartelaId,
                );

                if (takenRegistration) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      'This cartela is already taken for this session',
                    ),
                  );
                  continue;
                }

                if (!knownCartelaIds.has(cartela.cartelaId)) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      'Cartela not found',
                    ),
                  );
                  continue;
                }

                if (liveLockedCartelaIds.has(cartela.cartelaId)) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      'This cartela is already in use in the current live game',
                    ),
                  );
                  continue;
                }

                if (bonusLikeCategory && remainingBonusSlots <= 0) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      isBigGotdCategory(session.gameSlot.category)
                        ? 'Big GOTD cartela limit reached for this session'
                        : 'Bonus cartela limit reached for this session',
                    ),
                  );
                  continue;
                }

                const activeReservation = reservationByCartelaId.get(
                  cartela.cartelaId,
                );

                if (activeReservation && activeReservation.userId !== userId) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      'This cartela is already taken for this session',
                    ),
                  );
                  continue;
                }

                let gameCartela: Prisma.GameCartelaGetPayload<{
                  select: typeof myGameCartelaSelect;
                }>;
                try {
                  gameCartela = await tx.gameCartela.create({
                    data: {
                      gameSessionId: session.id,
                      userId,
                      cartelaId: cartela.cartelaId,
                      status: GameCartelaStatus.REGISTERED,
                    },
                    select: myGameCartelaSelect,
                  });
                } catch (error) {
                  if (this.isUniqueConstraintError(error)) {
                    const duplicateRegistration =
                      await tx.gameCartela.findFirst({
                        where: {
                          gameSessionId: sessionId,
                          cartelaId: cartela.cartelaId,
                          userId,
                        },
                        select: myGameCartelaSelect,
                      });

                    if (duplicateRegistration) {
                      successes.push(duplicateRegistration);
                      myRegistrationByCartelaId.set(
                        cartela.cartelaId,
                        duplicateRegistration,
                      );
                      continue;
                    }

                    failures.push(
                      this.buildBulkRegistrationFailure(
                        cartela,
                        'This cartela is already taken for this session',
                      ),
                    );
                    continue;
                  }

                  throw error;
                }

                if (!freeEntryCategory) {
                  try {
                    walletSnapshot = await this.walletService.debitWallet(
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
                  } catch (error) {
                    await tx.gameCartela.delete({
                      where: { id: gameCartela.id },
                    });

                    if (
                      error instanceof BadRequestException ||
                      error instanceof NotFoundException
                    ) {
                      const message = this.extractExceptionMessage(error);
                      walletFailureMessage = message;
                      failures.push(
                        this.buildBulkRegistrationFailure(cartela, message),
                      );
                      continue;
                    }

                    throw error;
                  }
                }

                if (activeReservation?.userId === userId) {
                  reservationIdsToConfirm.push(activeReservation.id);
                }

                successes.push(gameCartela);
                myRegistrationByCartelaId.set(cartela.cartelaId, gameCartela);
                sessionRegistrationByCartelaId.set(cartela.cartelaId, {
                  cartelaId: cartela.cartelaId,
                  userId,
                });
                registeredInTx += 1;
                if (bonusLikeCategory) {
                  remainingBonusSlots -= 1;
                }
              } catch (error) {
                if (error instanceof ConflictException) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      'This cartela is already taken for this session',
                    ),
                  );
                  continue;
                }

                if (error instanceof BadRequestException) {
                  const message = this.extractExceptionMessage(error);
                  failures.push(
                    this.buildBulkRegistrationFailure(cartela, message),
                  );

                  if (this.isWalletBalanceMessage(message)) {
                    walletFailureMessage = message;
                  }
                  continue;
                }

                throw error;
              }
            }

            if (reservationIdsToConfirm.length > 0) {
              await tx.gameCartelaReservation.updateMany({
                where: { id: { in: reservationIdsToConfirm } },
                data: { status: 'CONFIRMED' },
              });
            }

            let updatedSession: Prisma.GameSessionGetPayload<{
              select: typeof registrationSessionMetricsSelect;
            }> | null = null;

            if (registeredInTx > 0) {
              updatedSession = freeEntryCategory
                ? await tx.gameSession.findUnique({
                    where: { id: session.id },
                    select: registrationSessionMetricsSelect,
                  })
                : await tx.gameSession.update({
                    where: { id: session.id },
                    data: {
                      prizeAmount: {
                        increment: session.prizePerCartela.mul(registeredInTx),
                      },
                      companyRevenue: {
                        increment:
                          session.companyFeePerCartela.mul(registeredInTx),
                      },
                    },
                    select: registrationSessionMetricsSelect,
                  });
            }

            return {
              successes,
              failures,
              updatedSession,
              walletSnapshot,
            };
          },
          {
            maxWait: 15_000,
            timeout: 30_000,
          },
        );
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!this.isBulkRegisterRetryablePrismaError(error) || attempt === 1) {
          if (this.isBulkRegisterRetryablePrismaError(error)) {
            throw new ServiceUnavailableException(
              'Registration is busy. Please try again.',
            );
          }
          throw error;
        }
      }
    }

    if (!txResult) {
      throw (
        lastError ??
        new ServiceUnavailableException(
          'Registration is busy. Please try again.',
        )
      );
    }

    if (txResult.successes.length > 0 && txResult.updatedSession) {
      try {
        this.emitBulkRegistrationSideEffects({
          sessionId,
          userId,
          gameCartelas: txResult.successes,
          updatedSession: txResult.updatedSession,
          walletSnapshot: txResult.walletSnapshot,
        });
      } catch (error) {
        this.logger.warn(
          `Bulk registration realtime emit failed for session ${sessionId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      sessionId,
      successes: txResult.successes.map((gameCartela) =>
        serializeGameCartela(gameCartela),
      ),
      failures: txResult.failures,
    };
  }

  private isBulkRegisterRetryablePrismaError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2028' || error.code === 'P2034')
    );
  }

  async getPlayerTimeConfig() {
    return this.gameTimingConfigService.getPlayerConfig();
  }

  async reserveCartela(
    sessionId: string,
    userId: string,
    cartelaId: string,
    options: {
      preserveOtherReservations?: boolean;
      holdMs?: number;
    } = {},
  ) {
    this.userActionRateLimitService.assertWithinLimit('reserve', userId);

    const preserveOtherReservations = options.preserveOtherReservations ?? true;
    const now = new Date();
    const reservationTtlMs =
      options.holdMs ?? (await this.gameTimingConfigService.getCartelaHoldMs());
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
          registrationOpensAt: true,
          scheduledStartAt: true,
          gameSlot: {
            select: {
              operationMode: true,
              category: true,
              maxCartelasPerPlayer: true,
            },
          },
        },
      });

      if (!session) {
        throw new NotFoundException('Game session not found');
      }

      this.assertSessionRegistrationAllowed(session, now);

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
        session.gameSlot.category,
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

      await this.assertCategoryCartelaLimit(
        tx,
        session.id,
        userId,
        session.gameSlot.category,
        session.gameSlot.maxCartelasPerPlayer,
      );

      const activeReservation = await tx.gameCartelaReservation.findFirst({
        where: {
          gameSessionId: sessionId,
          cartelaId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
        },
      });

      if (activeReservation && activeReservation.userId !== userId) {
        throw new ConflictException('Another player is choosing this cartela');
      }

      if (activeReservation && activeReservation.userId === userId) {
        return tx.gameCartelaReservation.update({
          where: { id: activeReservation.id },
          data: { expiresAt },
        });
      }

      if (!preserveOtherReservations) {
        await tx.gameCartelaReservation.updateMany({
          where: {
            gameSessionId: sessionId,
            userId,
            status: 'ACTIVE',
          },
          data: { status: 'CANCELLED' },
        });
      }

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

    const cartelaBoard = await this.prisma.cartela.findUnique({
      where: { id: cartelaId },
      select: cartelaSelect,
    });

    if (!cartelaBoard) {
      throw new NotFoundException('Cartela not found');
    }

    await this.notifySessionCartelasUpdated(sessionId, [
      buildSessionCartelaChange({
        cartelaId,
        cartelaNumber: cartelaBoard.number,
        kind: 'RESERVED',
        userId,
        expiresAt: reservation.expiresAt,
      }),
    ]);

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
    options: {
      preserveOtherReservations?: boolean;
      holdMs?: number;
    } = {},
  ) {
    const session = await this.resolveRegistrationSessionForSlot(slotId);
    return this.reserveCartela(session.id, userId, cartelaId, options);
  }

  async reserveCartelasBulk(
    sessionId: string,
    userId: string,
    bulkReserveCartelasDto: BulkReserveCartelasDto,
  ) {
    this.userActionRateLimitService.assertWithinLimit('reserve', userId);

    const uniqueCartelaIds = [...new Set(bulkReserveCartelasDto.cartelaIds)];
    const now = new Date();
    const reservationTtlMs =
      await this.gameTimingConfigService.getBulkSelectionHoldMs();
    const expiresAt = new Date(now.getTime() + reservationTtlMs);

    const txResult = await this.prisma.$transaction(
      async (tx) => {
        await tx.gameCartelaReservation.updateMany({
          where: {
            gameSessionId: sessionId,
            cartelaId: { in: uniqueCartelaIds },
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
            registrationOpensAt: true,
            scheduledStartAt: true,
            gameSlot: {
              select: {
                operationMode: true,
                category: true,
                maxCartelasPerPlayer: true,
              },
            },
          },
        });

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        this.assertSessionRegistrationAllowed(session, now);

        const cartelas = await tx.cartela.findMany({
          where: { id: { in: uniqueCartelaIds } },
          select: { id: true },
        });
        if (cartelas.length !== uniqueCartelaIds.length) {
          throw new NotFoundException('Cartela not found');
        }

        await this.assertCartelasNotLockedByLiveRound(
          tx,
          session.id,
          uniqueCartelaIds,
          session.gameSlot.category,
          now,
        );

        await this.assertCategoryCartelaLimit(
          tx,
          session.id,
          userId,
          session.gameSlot.category,
          session.gameSlot.maxCartelasPerPlayer,
        );

        const registeredCartelas = await tx.gameCartela.findMany({
          where: {
            gameSessionId: sessionId,
            cartelaId: { in: uniqueCartelaIds },
            status: { not: GameCartelaStatus.CANCELLED },
          },
          select: { cartelaId: true, userId: true },
        });
        const takenByOthers = registeredCartelas.filter(
          (registration) => registration.userId !== userId,
        );
        if (takenByOthers.length > 0) {
          throw new ConflictException(
            'This cartela is already registered for this session',
          );
        }

        const ownedCartelaIds = new Set(
          registeredCartelas
            .filter((registration) => registration.userId === userId)
            .map((registration) => registration.cartelaId),
        );
        const cartelaIdsToReserve = uniqueCartelaIds.filter(
          (cartelaId) => !ownedCartelaIds.has(cartelaId),
        );

        const activeReservations = await tx.gameCartelaReservation.findMany({
          where: {
            gameSessionId: sessionId,
            cartelaId: { in: cartelaIdsToReserve },
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
          select: {
            id: true,
            cartelaId: true,
            userId: true,
          },
        });
        const activeReservationByCartelaId = new Map(
          activeReservations.map((reservation) => [
            reservation.cartelaId,
            reservation,
          ]),
        );

        const reservations: Array<{
          id: string;
          cartelaId: string;
          expiresAt: Date;
          status: string;
        }> = [];

        for (const cartelaId of cartelaIdsToReserve) {
          const activeReservation = activeReservationByCartelaId.get(cartelaId);

          if (activeReservation && activeReservation.userId !== userId) {
            throw new ConflictException(
              'Another player is choosing this cartela',
            );
          }

          const reservation =
            activeReservation && activeReservation.userId === userId
              ? await tx.gameCartelaReservation.update({
                  where: { id: activeReservation.id },
                  data: { expiresAt },
                })
              : await (async () => {
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
                })();

          reservations.push({
            id: reservation.id,
            cartelaId: reservation.cartelaId,
            expiresAt: reservation.expiresAt,
            status: reservation.status,
          });
        }

        return { sessionId, reservations };
      },
      {
        maxWait: 15_000,
        timeout: 30_000,
      },
    );

    const cartelaBoards = await this.prisma.cartela.findMany({
      where: { id: { in: uniqueCartelaIds } },
      select: cartelaSelect,
    });
    const cartelaNumberById = new Map(
      cartelaBoards.map((board) => [board.id, board.number]),
    );

    await this.notifySessionCartelasUpdated(
      sessionId,
      txResult.reservations.map((reservation) =>
        buildSessionCartelaChange({
          cartelaId: reservation.cartelaId,
          cartelaNumber: cartelaNumberById.get(reservation.cartelaId) ?? 0,
          kind: 'RESERVED',
          userId,
          expiresAt: reservation.expiresAt,
        }),
      ),
    );

    return {
      sessionId: txResult.sessionId,
      reservations: txResult.reservations.map((reservation) => ({
        id: reservation.id,
        cartelaId: reservation.cartelaId,
        expiresAt: reservation.expiresAt.toISOString(),
        status: reservation.status,
      })),
    };
  }

  async reserveCartelasBulkForSlot(
    slotId: string,
    userId: string,
    bulkReserveCartelasDto: BulkReserveCartelasDto,
  ) {
    const session = await this.resolveRegistrationSessionForSlot(slotId);
    return this.reserveCartelasBulk(session.id, userId, bulkReserveCartelasDto);
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

        this.assertSessionRegistrationAllowed(session);

        await this.assertCartelaNotLockedByLiveRound(
          tx,
          session.id,
          reservation.cartelaId,
          session.gameSlot.category,
        );
        await this.assertCategoryCartelaLimit(
          tx,
          session.id,
          userId,
          session.gameSlot.category,
          session.gameSlot.maxCartelasPerPlayer,
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

        const walletSnapshot = isFreeEntryCategory(session.gameSlot.category)
          ? undefined
          : await this.walletService.debitWallet(tx, userId, session.entryFee, {
              type: WalletTransactionType.GAME_ENTRY,
              referenceType: 'GAME_CARTELA',
              referenceId: gameCartela.id,
              description: `Game entry fee for ${session.playCode}`,
            });

        const updatedSessionPromise = isBonusCategory(session.gameSlot.category)
          ? tx.gameSession.findUnique({
              where: { id: session.id },
              select: registrationSessionMetricsSelect,
            })
          : tx.gameSession.update({
              where: { id: session.id },
              data: {
                prizeAmount: { increment: session.prizePerCartela },
                companyRevenue: { increment: session.companyFeePerCartela },
              },
              select: registrationSessionMetricsSelect,
            });

        const [updatedSession] = await Promise.all([
          updatedSessionPromise,
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
        const reservation = await this.prisma.gameCartelaReservation.findUnique(
          {
            where: { id: reservationId },
            select: { gameSessionId: true, cartelaId: true },
          },
        );

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

    const reservation = await this.prisma.gameCartelaReservation.findUnique({
      where: { id: reservationId },
      select: {
        gameSessionId: true,
        cartelaId: true,
        cartela: { select: { number: true } },
      },
    });

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

    if (reservation) {
      await this.notifySessionCartelasUpdated(reservation.gameSessionId, [
        buildSessionCartelaChange({
          cartelaId: reservation.cartelaId,
          cartelaNumber: reservation.cartela.number,
          kind: 'AVAILABLE',
        }),
      ]);
    }

    return { success: true };
  }

  private async notifySessionCartelasUpdated(
    sessionId: string,
    changes?: SessionCartelaChange[],
  ) {
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
      ...(changes != null && changes.length > 0 ? { changes } : {}),
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
    this.realtimeService.emitToPublicGames(
      'slot:status_changed',
      publicPayload,
    );

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

  async getCurrentBigGame() {
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: {
          in: [
            GameStatus.READY,
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
        gameSlot: {
          category: GameCategory.BIG_GAME,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: gameSessionSelect,
    });

    if (sessions.length === 0) {
      return null;
    }

    return serializeGameSessionForPlayer(
      [...sessions].sort((left, right) =>
        this.compareBigGameSessions(left, right),
      )[0],
    );
  }

  /**
   * CANONICAL SOURCE OF TRUTH for current game operations.
   * Both Admin and Flutter MUST use this endpoint to ensure they display
   * the SAME game state. Frontend must NOT apply additional filtering/sorting.
   *
   * Selection logic (backend decides, frontend obeys):
   * 1. liveGame = first PLAYING session by slot sortOrder
   * 2. checkingGame = first CHECKING session by slot sortOrder
   * 3. registrationOpenGame = first READY session by slot sortOrder (null if none)
   * 4. queue = remaining READY + NEXT items by slot sortOrder
   *
   * Phase 2: READY = registration open, NEXT = queue only
   * registrationOpenGame will be null if no READY session exists
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
        await this.autoReadyCountdownRepairService.repairAllMissingAutoReadyCountdowns();
        const cacheKey = this.buildOperationsCacheKey(
          requestingUserId,
          requestingUserRole,
        );
        const cached = this.readOperationsCache(cacheKey);
        if (cached) {
          return this.stampOperationsServerNow(cached);
        }

        const result = await this.getCurrentOperationsInternal(
          requestingUserId,
          requestingUserRole,
        );
        this.writeOperationsCache(cacheKey, result);

        // Check invariants after building operations
        void this.invariantsService?.assertGameOperationInvariants?.();

        return this.stampOperationsServerNow(result);
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
        registeredCartelasSummaryCount: result.registeredCartelasSummary.length,
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
      select: {
        id: true,
        status: true,
        entryFee: true,
        gameSlot: {
          select: {
            category: true,
            fixedPrizeAmount: true,
            maxCartelasPerPlayer: true,
          },
        },
      },
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
      const poolCategoryFilter = liveCartelaPoolCategoryFilter(
        cartelaPoolForCategory(session.gameSlot.category),
      );
      const liveSessionWhere = {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
        gameSlot: {
          category: poolCategoryFilter,
        },
      };

      const [liveLockedCartelas, liveLockedReservations] = await Promise.all([
        this.prisma.gameCartela.findMany({
          where: {
            gameSessionId: { not: sessionId },
            status: { not: GameCartelaStatus.CANCELLED },
            gameSession: liveSessionWhere,
          },
          select: registeredCartelaSummarySelect,
        }),
        this.prisma.gameCartelaReservation.findMany({
          where: {
            gameSessionId: { not: sessionId },
            status: 'ACTIVE',
            expiresAt: { gt: now },
            gameSession: liveSessionWhere,
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
    const myRegisteredCartelasCount = myCartelaIds.length;

    return {
      sessionId,
      registeredCartelasSummary: mergedSummary,
      reservedCartelasSummary,
      myCartelaIds,
      category: session.gameSlot.category,
      entryFee: session.entryFee.toString(),
      fixedPrizeAmount: session.gameSlot.fixedPrizeAmount?.toString() ?? null,
      maxCartelasPerPlayer: session.gameSlot.maxCartelasPerPlayer,
      remainingFreeCartelas:
        isBonusCategory(session.gameSlot.category) && requestingUserId != null
          ? Math.max(
              getBonusCartelaLimit(session.gameSlot.maxCartelasPerPlayer) -
                myRegisteredCartelasCount,
              0,
            )
          : null,
    };
  }

  private async assertCartelaNotLockedByLiveRound(
    tx: Prisma.TransactionClient,
    sessionId: string,
    cartelaId: string,
    requestingCategory: GameCategory,
    now: Date = new Date(),
  ) {
    const liveSessionWhere = {
      status: {
        in: [GameStatus.PLAYING, GameStatus.CHECKING, GameStatus.WINNER_WINDOW],
      },
      gameSlot: {
        category: liveCartelaPoolCategoryFilter(
          cartelaPoolForCategory(requestingCategory),
        ),
      },
    };

    const [liveRegistration, liveReservation] = await Promise.all([
      tx.gameCartela.findFirst({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId,
          status: { not: GameCartelaStatus.CANCELLED },
          gameSession: liveSessionWhere,
        },
        select: { id: true },
      }),
      tx.gameCartelaReservation.findFirst({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          gameSession: liveSessionWhere,
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

  private async findLiveLockedCartelaIds(
    tx: Prisma.TransactionClient,
    sessionId: string,
    cartelaIds: string[],
    requestingCategory: GameCategory,
    now: Date = new Date(),
  ): Promise<Set<string>> {
    if (cartelaIds.length === 0) {
      return new Set();
    }

    const liveSessionWhere = {
      status: {
        in: [GameStatus.PLAYING, GameStatus.CHECKING, GameStatus.WINNER_WINDOW],
      },
      gameSlot: {
        category: liveCartelaPoolCategoryFilter(
          cartelaPoolForCategory(requestingCategory),
        ),
      },
    };

    const [liveRegistrations, liveReservations] = await Promise.all([
      tx.gameCartela.findMany({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId: { in: cartelaIds },
          status: { not: GameCartelaStatus.CANCELLED },
          gameSession: liveSessionWhere,
        },
        select: { cartelaId: true },
      }),
      tx.gameCartelaReservation.findMany({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId: { in: cartelaIds },
          status: 'ACTIVE',
          expiresAt: { gt: now },
          gameSession: liveSessionWhere,
        },
        select: { cartelaId: true },
      }),
    ]);

    return new Set([
      ...liveRegistrations.map((registration) => registration.cartelaId),
      ...liveReservations.map((reservation) => reservation.cartelaId),
    ]);
  }

  private async assertCartelasNotLockedByLiveRound(
    tx: Prisma.TransactionClient,
    sessionId: string,
    cartelaIds: string[],
    requestingCategory: GameCategory,
    now: Date = new Date(),
  ) {
    if (cartelaIds.length === 0) {
      return;
    }

    const liveSessionWhere = {
      status: {
        in: [GameStatus.PLAYING, GameStatus.CHECKING, GameStatus.WINNER_WINDOW],
      },
      gameSlot: {
        category: liveCartelaPoolCategoryFilter(
          cartelaPoolForCategory(requestingCategory),
        ),
      },
    };

    const [liveRegistrations, liveReservations] = await Promise.all([
      tx.gameCartela.findMany({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId: { in: cartelaIds },
          status: { not: GameCartelaStatus.CANCELLED },
          gameSession: liveSessionWhere,
        },
        select: { id: true },
        take: 1,
      }),
      tx.gameCartelaReservation.findMany({
        where: {
          gameSessionId: { not: sessionId },
          cartelaId: { in: cartelaIds },
          status: 'ACTIVE',
          expiresAt: { gt: now },
          gameSession: liveSessionWhere,
        },
        select: { id: true },
        take: 1,
      }),
    ]);

    if (liveRegistrations.length > 0 || liveReservations.length > 0) {
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

  private readOperationsCache(
    cacheKey: string,
  ): Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>> | null {
    return this.operationsCacheService.read(cacheKey);
  }

  private writeOperationsCache(
    cacheKey: string,
    payload: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): void {
    this.operationsCacheService.write(cacheKey, payload);
  }

  private stampOperationsServerNow<
    T extends Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  >(payload: T): T & { serverNow: string; timestamp: string } {
    const serverNow = new Date().toISOString();
    return {
      ...payload,
      serverNow,
      timestamp: serverNow,
    };
  }

  private async getCurrentOperationsInternal(
    _requestingUserId?: string,
    requestingUserRole: UserRole = UserRole.PLAYER,
  ): Promise<{
    liveGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
    checkingGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
    registrationOpenGame: ReturnType<
      GamesService['buildFastSessionSnapshot']
    > | null;
    queue: Array<
      | ReturnType<GamesService['buildFastSessionSnapshot']>
      | ReturnType<GamesService['buildFastQueueSlotSnapshot']>
    >;
    timestamp: string;
  }> {
    const isAdmin = requestingUserRole === UserRole.ADMIN;

    const [liveSession, checkingSession, readySessions, nextSlots] =
      await Promise.all([
        this.findFirstOperationsSession(
          [GameStatus.PLAYING, GameStatus.WINNER_WINDOW],
          isAdmin,
        ),
        this.findFirstOperationsSession([GameStatus.CHECKING], isAdmin),
        this.findQueueReadySessions([], isAdmin),
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

    const availableReadySessions = readySessions.filter(
      (session) => !usedSlotIds.has(session.gameSlot.id),
    );
    const readySlotIds = new Set(
      availableReadySessions.map((session) => session.gameSlot.id),
    );
    const queueNextSlots = nextSlots.filter(
      (slot) => !usedSlotIds.has(slot.id) && !readySlotIds.has(slot.id),
    );
    const registrationCandidate = this.pickRegistrationCandidate(
      availableReadySessions,
      queueNextSlots,
    );

    // Phase 2: registrationOpenGame is only a READY session, never a NEXT slot
    let registrationOpenGame: ReturnType<
      GamesService['buildFastSessionSnapshot']
    > | null = null;

    if (registrationCandidate?.kind === 'ready') {
      usedSlotIds.add(registrationCandidate.slotId);
      registrationOpenGame = this.sanitizeOperationItem(
        this.buildFastSessionSnapshot(
          registrationCandidate.session,
          'registration',
          { isAdmin, includePrizePerCartela: true },
        ),
        isAdmin,
      );
    }
    // If no READY session exists, registrationOpenGame is null
    // NEXT slots appear only in the queue

    const queueReadySessions = availableReadySessions.filter(
      (session) =>
        session.gameSlot.id !== registrationCandidate?.slotId &&
        isStandardQueueCategory(session.gameSlot.category),
    );
    const remainingQueueNextSlots = queueNextSlots.filter(
      (slot) =>
        slot.id !== registrationCandidate?.slotId &&
        isStandardQueueCategory(slot.category),
    );
    const queue = [
      ...remainingQueueNextSlots.map((slot) =>
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
    ].sort((left, right) => this.compareQueueItemsByPriority(left, right));

    const dedupedQueue = this.dedupeOperationQueueItems(queue);

    let liveWinnerPayoutsSummary:
      | ReturnType<typeof serializeWinnerPayoutsSummary>
      | undefined;
    let liveSessionOutcomeSummary:
      | Awaited<ReturnType<typeof buildSessionOutcomeSummary>>
      | undefined;

    if (
      liveSession &&
      (liveSession.status === GameStatus.WINNER_WINDOW ||
        liveSession.status === GameStatus.FINISHED)
    ) {
      liveSessionOutcomeSummary = await buildSessionOutcomeSummary(
        this.prisma,
        liveSession.id,
      );
    }

    if (
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
        _requestingUserId,
      );
    }

    const result = {
      liveGame: liveSession
        ? this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(liveSession, 'live', {
              isAdmin,
              winnerPayoutsSummary: liveWinnerPayoutsSummary,
              sessionOutcomeSummary: liveSessionOutcomeSummary,
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

    this.lifecycleLogger?.currentOperationsBuilt?.({
      hasLiveGame: !!liveSession,
      hasCheckingGame: !!checkingSession,
      hasRegistrationOpenGame: !!registrationOpenGame,
      queueLength: dedupedQueue.length,
      liveSessionId: liveSession?.id,
      checkingSessionId: checkingSession?.id,
      registrationSessionId:
        registrationCandidate?.kind === 'ready'
          ? registrationCandidate.session.id
          : undefined,
      registrationSlotId: registrationCandidate?.slotId,
    });

    return result;
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
    T extends {
      slotId: string;
      sessionId: string | null;
      sortOrder: number | null;
      category?: GameCategory | null;
    },
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

    return [...bySlotId.values()].sort((left, right) =>
      this.compareQueueItemsByPriority(left, right),
    );
  }

  private pickRegistrationCandidate(
    readySessions: any[],
    nextSlots: any[],
  ): {
    kind: 'ready';
    slotId: string;
    session: any;
  } | null {
    // Phase 2: READY = registration open, NEXT = queue only
    // Only READY sessions can be registration candidates
    const readyCandidates = readySessions
      .filter((session) => this.canRegisterForSession(session))
      .filter((session) => isStandardQueueCategory(session.gameSlot.category))
      .map((session) => ({
        kind: 'ready' as const,
        slotId: session.gameSlot.id,
        session,
        category: session.gameSlot.category,
        status: session.status,
        scheduledStartAt: session.scheduledStartAt,
        sortOrder: session.gameSlot.sortOrder,
      }));

    // NEXT slots are no longer registration candidates
    // They appear only in the queue/upcoming list

    const candidates = [...readyCandidates].sort((left, right) => {
      const now = new Date();
      const priorityDiff =
        getRuntimeQueuePriority(
          left.category,
          left.status,
          left.scheduledStartAt,
          now,
        ) -
        getRuntimeQueuePriority(
          right.category,
          right.status,
          right.scheduledStartAt,
          now,
        );
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const categoryDiff = compareCategoryPriority(
        left.category,
        right.category,
      );
      if (categoryDiff !== 0) {
        return categoryDiff;
      }

      return compareSortOrder(left.sortOrder, right.sortOrder);
    });

    const selected = candidates[0] ?? null;

    if (selected) {
      this.lifecycleLogger?.registrationCandidateSelected?.({
        kind: 'ready_session',
        slotId: selected.slotId,
        sessionId: selected.session.id,
        category: selected.category,
        sortOrder: selected.sortOrder ?? undefined,
      });
    } else {
      this.lifecycleLogger?.registrationCandidateSelected?.({
        kind: 'none',
      });
    }

    return selected;
  }

  private compareQueueItemsByPriority(
    left: {
      sortOrder: number | null;
      category?: GameCategory | null;
      status?: GameStatus | null;
      rawStatus?: GameStatus | null;
      scheduledStartAt?: Date | null;
    },
    right: {
      sortOrder: number | null;
      category?: GameCategory | null;
      status?: GameStatus | null;
      rawStatus?: GameStatus | null;
      scheduledStartAt?: Date | null;
    },
  ): number {
    const now = new Date();
    const priorityDiff =
      getRuntimeQueuePriority(
        left.category,
        left.status ?? left.rawStatus,
        left.scheduledStartAt,
        now,
      ) -
      getRuntimeQueuePriority(
        right.category,
        right.status ?? right.rawStatus,
        right.scheduledStartAt,
        now,
      );
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const categoryDiff = compareCategoryPriority(left.category, right.category);
    if (categoryDiff !== 0) {
      return categoryDiff;
    }

    return compareSortOrder(left.sortOrder, right.sortOrder);
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
      registrationOpensAt: Date | null;
      scheduledStartAt: Date | null;
      winnerWindowEndsAt: Date | null;
      noWinnerGraceEndsAt: Date | null;
      noWinnerReason: string | null;
      nextAutoCallAt: Date | null;
      companyRevenue?: Prisma.Decimal;
      autoCallEnabled?: boolean;
      autoCallIntervalMs?: number | null;
      gameSlot: {
        id: string;
        staticCode: string;
        sortOrder: number | null;
        category: GameCategory | null;
        fixedPrizeAmount?: Prisma.Decimal | null;
        maxCartelasPerPlayer?: number | null;
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
      sessionOutcomeSummary?: Awaited<
        ReturnType<typeof buildSessionOutcomeSummary>
      >;
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
              : session.status === GameStatus.FINISHED ||
                  session.status === GameStatus.NO_WINNER
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
      category: slot.category ?? GameCategory.NORMAL,
      isBonus: isBonusCategory(slot.category),
      isBigGame: isBigGameCategory(slot.category),
      fixedPrizeAmount: slot.fixedPrizeAmount?.toString() ?? null,
      maxCartelasPerPlayer: slot.maxCartelasPerPlayer ?? null,
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
      registrationOpensAt: session.registrationOpensAt,
      scheduledStartAt: session.scheduledStartAt,
      nextAutoCallAt: session.nextAutoCallAt,
      winnerWindowEndsAt: session.winnerWindowEndsAt,
      noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
      noWinnerReason: session.noWinnerReason,
      sortOrder: slot.sortOrder,
      canRegister: this.canRegisterForSession(session),
      canStart:
        slot.operationMode !== GameOperationMode.AUTO &&
        (slot.status === GameStatus.NEXT ||
          session.status === GameStatus.READY),
      canCallNumber: session.status === GameStatus.PLAYING,
      ...(options.sessionOutcomeSummary
        ? { sessionOutcomeSummary: options.sessionOutcomeSummary }
        : {}),
      ...(options.winnerPayoutsSummary
        ? { winnerPayoutsSummary: options.winnerPayoutsSummary }
        : {}),
      ...(options.isAdmin
        ? {
            companyRevenue: session.companyRevenue?.toString() ?? '0',
            autoCallEnabled: session.autoCallEnabled ?? false,
            autoCallIntervalMs: session.autoCallIntervalMs ?? 7000,
          }
        : {}),
    };
  }

  private buildFastRegistrationSlotSnapshot(slot: {
    id: string;
    staticCode: string;
    entryFee: Prisma.Decimal;
    prizePerCartela: Prisma.Decimal;
    category: GameCategory | null;
    fixedPrizeAmount?: Prisma.Decimal | null;
    maxCartelasPerPlayer?: number | null;
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
      category: slot.category ?? GameCategory.NORMAL,
      isBonus: isBonusCategory(slot.category),
      isBigGame: isBigGameCategory(slot.category),
      fixedPrizeAmount: slot.fixedPrizeAmount?.toString() ?? null,
      maxCartelasPerPlayer: slot.maxCartelasPerPlayer ?? null,
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
      registrationOpensAt: null,
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
    prizePerCartela: Prisma.Decimal;
    category: GameCategory | null;
    fixedPrizeAmount?: Prisma.Decimal | null;
    maxCartelasPerPlayer?: number | null;
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
      category: slot.category ?? GameCategory.NORMAL,
      isBonus: isBonusCategory(slot.category),
      isBigGame: isBigGameCategory(slot.category),
      fixedPrizeAmount: slot.fixedPrizeAmount?.toString() ?? null,
      maxCartelasPerPlayer: slot.maxCartelasPerPlayer ?? null,
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
      registrationOpensAt: null,
      sortOrder: slot.sortOrder,
      canRegister: false,
      canStart: false,
      canCallNumber: false,
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

  async getSessionWinnerResults(sessionId: string, requestingUserId?: string) {
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
      if (
        session.status !== GameStatus.FINISHED &&
        session.status !== GameStatus.NO_WINNER
      ) {
        throw new BadRequestException(
          'Winner results are available only for terminal sessions',
        );
      }
    }

    return {
      sessionId,
      winnerResults: results,
    };
  }

  /**
   * Public-safe winner result for post-game display.
   * Returns cartela number, winning cells, pattern name, and prize amount.
   * No sensitive user data (phone, wallet, etc.).
   */
  async getPublicWinnerResult(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        prizeAmount: true,
        winnerCartelaId: true,
        gameSlot: {
          select: {
            gameType: true,
            gameRule: {
              select: {
                name: true,
                key: true,
                patterns: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    if (
      session.status !== GameStatus.FINISHED &&
      session.status !== GameStatus.NO_WINNER
    ) {
      throw new BadRequestException(
        'Winner result is available only for terminal sessions',
      );
    }

    if (session.status === GameStatus.NO_WINNER) {
      return {
        sessionId,
        cartelaNumber: null,
        winningCells: [],
        patternName:
          session.gameSlot.gameRule?.name ?? session.gameSlot.gameType,
        prizeAmount: session.prizeAmount.toFixed(2),
        winnerDisplayName: null,
      };
    }

    // Get the primary winner cartela
    const winnerCartela = await this.prisma.gameCartela.findFirst({
      where: {
        gameSessionId: sessionId,
        isWinner: true,
        status: GameCartelaStatus.WINNER,
      },
      select: {
        id: true,
        cartela: {
          select: {
            id: true,
            number: true,
            b: true,
            i: true,
            n: true,
            g: true,
            o: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!winnerCartela) {
      return {
        sessionId,
        cartelaNumber: null,
        winningCells: [],
        patternName:
          session.gameSlot.gameRule?.name ?? session.gameSlot.gameType,
        prizeAmount: session.prizeAmount.toFixed(2),
        winnerDisplayName: null,
      };
    }

    // Get called numbers for pattern evaluation
    const calledNumbers = await this.prisma.calledNumber.findMany({
      where: { gameSessionId: sessionId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        letter: true,
        number: true,
        order: true,
      },
    });

    // Evaluate winning pattern
    const ruleKey = session.gameSlot.gameRule?.key ?? session.gameSlot.gameType;
    const evaluation = this.gameRuleEvaluationService.evaluate(
      winnerCartela.cartela,
      calledNumbers,
      ruleKey,
      session.gameSlot.gameRule?.patterns,
    );

    // Build winning cells from completed patterns
    // BoardCoord is [row, col] tuple, index = row * 5 + col for 5x5 bingo board
    const winningCells: number[] = [];
    if (evaluation.isWinner && evaluation.completedPatterns.length > 0) {
      for (const pattern of evaluation.completedPatterns) {
        const cells = pattern.cells ?? [];
        for (const cell of cells) {
          const cellIndex = cell[0] * 5 + cell[1]; // row * 5 + col
          if (!winningCells.includes(cellIndex)) {
            winningCells.push(cellIndex);
          }
        }
      }
    }

    // Sort cells for consistent display
    winningCells.sort((a, b) => a - b);

    return {
      sessionId,
      cartelaNumber: winnerCartela.cartela.number,
      winningCells,
      patternName: session.gameSlot.gameRule?.name ?? session.gameSlot.gameType,
      prizeAmount: session.prizeAmount.toFixed(2),
      winnerDisplayName: `Winner #${winnerCartela.cartela.number}`,
    };
  }

  /**
   * Admin force-cancel. Delegates to the unified lifecycle cancel which
   * refunds entry fees, cancels cartelas, requeues the slot and emits the
   * terminal events. Allows READY, PLAYING and CHECKING sessions;
   * WINNER_WINDOW must be finalized early instead.
   */
  async cancelOrphanedSession(sessionId: string, actorId?: string) {
    try {
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
    } catch (error) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });

      if (session?.status === GameStatus.CANCELLED) {
        return {
          success: true,
          sessionId,
          refundedCount: 0,
          alreadyCancelled: true,
        };
      }

      throw error;
    }
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

  async getMyAttendedSessionsHistory(
    userId: string,
    paginationQuery: PaginationQueryDto,
  ) {
    return this.requestPerformance.run(
      {
        operation: 'getMyAttendedSessionsHistory',
        userRole: UserRole.PLAYER,
      },
      async () => {
        const { page, pageSize, skip, take } =
          getPaginationParams(paginationQuery);
        const where = {
          status: {
            in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
          },
          gameCartelas: {
            some: { userId },
          },
        };

        const [sessions, totalItems] = await Promise.all([
          this.prisma.gameSession.findMany({
            where,
            select: gameSessionSelect,
            orderBy: { finishedAt: 'desc' },
            skip,
            take,
          }),
          this.prisma.gameSession.count({ where }),
        ]);

        const sessionIds = sessions.map((session) => session.id);
        const cartelas =
          sessionIds.length === 0
            ? []
            : await this.prisma.gameCartela.findMany({
                where: {
                  userId,
                  gameSessionId: { in: sessionIds },
                },
                select: myGameCartelaSelect,
                orderBy: [{ cartela: { number: 'asc' } }],
              });

        const cartelasBySession = new Map<string, typeof cartelas>();
        for (const cartela of cartelas) {
          const bucket = cartelasBySession.get(cartela.gameSessionId) ?? [];
          bucket.push(cartela);
          cartelasBySession.set(cartela.gameSessionId, bucket);
        }

        return {
          items: sessions.map((session) =>
            serializeMyAttendedHistoryItem(
              session,
              cartelasBySession.get(session.id) ?? [],
            ),
          ),
          pagination: buildPaginationMeta(page, pageSize, totalItems),
        };
      },
      (result) => ({
        itemCount: result.items.length,
      }),
    );
  }

  async getSessionsHistory(
    paginationQuery: PaginationQueryDto,
    options?: { forPlayer?: boolean },
  ) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const sessions = await this.prisma.gameSession.findMany({
      where: {
        status: {
          in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
        },
      },
      select: gameSessionSelect,
      orderBy: { finishedAt: 'desc' },
      skip,
      take,
    });

    const totalItems = await this.prisma.gameSession.count({
      where: {
        status: {
          in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
        },
      },
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
    T extends {
      status: GameStatus;
      sortOrder: number | null;
      category?: GameCategory | null;
    },
  >(slots: T[]): T[] {
    const statusOrder: Record<GameStatus, number> = {
      [GameStatus.PLAYING]: 0,
      [GameStatus.WINNER_WINDOW]: 0,
      [GameStatus.CHECKING]: 1,
      [GameStatus.READY]: 2,
      [GameStatus.NEXT]: 3,
      [GameStatus.FINISHED]: 4,
      [GameStatus.NO_WINNER]: 5,
      [GameStatus.CANCELLED]: 6,
    };

    return [...slots].sort((left, right) => {
      const statusDiff = statusOrder[left.status] - statusOrder[right.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }

      return this.compareQueueItemsByPriority(left, right);
    });
  }

  private parsePositiveMoneyOrThrow(value: string | undefined, field: string) {
    if (!value) {
      throw new BadRequestException(`${field} is required`);
    }

    const amount = new Prisma.Decimal(value);
    if (amount.lte(0)) {
      throw new BadRequestException(`${field} must be greater than zero`);
    }

    return amount;
  }

  private parsePositiveIntOrThrow(
    value: number | undefined,
    field: string,
    context: string,
  ) {
    if (value == null) {
      throw new BadRequestException(`${field} is required for ${context}`);
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }

    return value;
  }

  private parseDateTimeOrThrow(
    value: string | undefined,
    field: string,
    context: string,
  ) {
    if (!value) {
      throw new BadRequestException(`${field} is required for ${context}`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime`);
    }

    return parsed;
  }

  private compareBigGameSessions(
    left: {
      status: GameStatus;
      registrationOpensAt: Date | null;
      scheduledStartAt: Date | null;
      createdAt: Date;
    },
    right: {
      status: GameStatus;
      registrationOpensAt: Date | null;
      scheduledStartAt: Date | null;
      createdAt: Date;
    },
  ) {
    const statusPriority: Record<GameStatus, number> = {
      [GameStatus.PLAYING]: 0,
      [GameStatus.WINNER_WINDOW]: 1,
      [GameStatus.CHECKING]: 2,
      [GameStatus.READY]: 3,
      [GameStatus.NEXT]: 4,
      [GameStatus.FINISHED]: 5,
      [GameStatus.NO_WINNER]: 6,
      [GameStatus.CANCELLED]: 7,
    };

    const statusDiff =
      statusPriority[left.status] - statusPriority[right.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const registrationDiff =
      (left.registrationOpensAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.registrationOpensAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if (registrationDiff !== 0) {
      return registrationDiff;
    }

    const scheduledDiff =
      (left.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if (scheduledDiff !== 0) {
      return scheduledDiff;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  }

  private canRegisterForSession(session: {
    status: GameStatus;
    registrationOpensAt?: Date | null;
    scheduledStartAt?: Date | null;
    gameSlot: {
      operationMode?: GameOperationMode | null;
      category?: GameCategory | null;
    };
  }): boolean {
    if (isBigGameCategory(session.gameSlot.category)) {
      return (
        session.status === GameStatus.READY &&
        canRegisterForBigGameWindow(
          session.registrationOpensAt,
          session.scheduledStartAt,
        )
      );
    }

    return canRegisterForOperationMode(
      session.gameSlot.operationMode ?? GameOperationMode.MANUAL,
      session.status,
      session.scheduledStartAt,
    );
  }

  private assertSessionRegistrationAllowed(
    session: {
      status: GameStatus;
      registrationOpensAt?: Date | null;
      scheduledStartAt?: Date | null;
      gameSlot: {
        operationMode?: GameOperationMode | null;
        category?: GameCategory | null;
      };
    },
    now: Date = new Date(),
  ): void {
    if (isBigGameCategory(session.gameSlot.category)) {
      if (session.status !== GameStatus.READY) {
        throw new BadRequestException({
          message: 'Big Game registration is closed',
          code: 'BIG_GAME_REGISTRATION_CLOSED',
        });
      }

      assertBigGameRegistrationAllowed(
        session.registrationOpensAt,
        session.scheduledStartAt,
        now,
      );
      return;
    }

    assertRegistrationAllowed(
      session.gameSlot.operationMode ?? GameOperationMode.MANUAL,
      session.status,
      session.scheduledStartAt,
    );
  }

  private async assertCategoryCartelaLimit(
    tx: Prisma.TransactionClient,
    sessionId: string,
    userId: string,
    category?: GameCategory | null,
    maxCartelasPerPlayer?: number | null,
  ) {
    if (!isBonusLikeCategory(category) && !isBigGameCategory(category)) {
      return;
    }

    const existingCartelas = await tx.gameCartela.count({
      where: {
        gameSessionId: sessionId,
        userId,
        status: { not: GameCartelaStatus.CANCELLED },
      },
    });

    if (
      isBonusLikeCategory(category) &&
      existingCartelas >= getBonusCartelaLimit(maxCartelasPerPlayer)
    ) {
      throw new BadRequestException({
        message: isBigGotdCategory(category)
          ? 'Big GOTD cartela limit reached for this session'
          : 'Bonus cartela limit reached for this session',
        code: isBigGotdCategory(category)
          ? 'BIG_GOTD_CARTELA_LIMIT_REACHED'
          : 'BONUS_CARTELA_LIMIT_REACHED',
      });
    }

    if (
      isBigGameCategory(category) &&
      maxCartelasPerPlayer != null &&
      existingCartelas >= maxCartelasPerPlayer
    ) {
      throw new BadRequestException({
        message: 'Big Game cartela limit reached for this session',
        code: 'BIG_GAME_CARTELA_LIMIT_REACHED',
      });
    }
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

  private async resolveRegistrationSessionForSlot(slotId: string) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        entryFee: true,
        prizePerCartela: true,
        category: true,
        fixedPrizeAmount: true,
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
        registrationOpensAt: true,
        scheduledStartAt: true,
      },
    });

    if (!session && slot.status === GameStatus.NEXT) {
      if (isBigGameCategory(slot.category)) {
        throw new BadRequestException('No active session found for this slot');
      }

      // Validate slot before creating session
      const slotValidation =
        await this.repairService.isSlotValidForReadySession(slotId);
      if (!slotValidation.valid) {
        this.lifecycleLogger?.invalidSessionCreationBlocked?.({
          slotId,
          reason: slotValidation.reason!,
          attemptedStatus: GameStatus.READY,
        });
        throw new BadRequestException(
          `Cannot create session: ${slotValidation.reason}`,
        );
      }

      const playCode = this.generatePlayCode();
      const sessionMoneyConfig = buildSessionMoneyConfig(slot);

      session = await this.prisma.gameSession.create({
        data: {
          gameSlotId: slotId,
          playCode,
          entryFee: sessionMoneyConfig.entryFee,
          prizePerCartela: sessionMoneyConfig.prizePerCartela,
          companyFeePerCartela: sessionMoneyConfig.companyFeePerCartela,
          prizeAmount: sessionMoneyConfig.prizeAmount,
          companyRevenue: sessionMoneyConfig.companyRevenue,
          status: GameStatus.READY,
        },
        select: {
          id: true,
          playCode: true,
          entryFee: true,
          prizePerCartela: true,
          companyFeePerCartela: true,
          status: true,
          registrationOpensAt: true,
          scheduledStartAt: true,
        },
      });

      this.lifecycleLogger?.sessionCreated?.({
        sessionId: session.id,
        slotId,
        slotStatus: slot.status,
        sessionStatus: GameStatus.READY,
        category: slot.category,
        operationMode: slot.operationMode,
        reason: 'first_registration',
      });

      this.lifecycleLogger?.registrationOpened?.({
        sessionId: session.id,
        slotId,
        category: slot.category,
        operationMode: slot.operationMode,
        reason: 'first_player_registration',
      });

      await this.emitSessionCreatedForSlot(slotId, session.id);
    }

    if (!session) {
      throw new BadRequestException('No active session found for this slot');
    }

    this.assertSessionRegistrationAllowed({
      ...session,
      gameSlot: {
        operationMode: slot.operationMode,
        category: slot.category,
      },
    });

    return session;
  }

  private async emitSessionCreatedForSlot(slotId: string, sessionId: string) {
    const fullSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!fullSession) {
      return;
    }

    const payload = serializeGameSession(fullSession);
    const playerPayload = toPlayerGameSession(payload);
    this.realtimeService.emitToSession(
      sessionId,
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
      sessionId,
      adminPayload: payload,
      publicPayload: playerPayload,
    });
  }

  private buildBulkRegistrationFailure(
    cartela: BulkRegisterCartelaItemDto,
    reason: string,
  ) {
    return {
      cartelaId: cartela.cartelaId,
      cartelaNumber: cartela.cartelaNumber,
      reason,
    };
  }

  private extractExceptionMessage(error: BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }

    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const message = response.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && typeof message[0] === 'string') {
        return message[0];
      }
    }

    return error.message;
  }

  private isWalletBalanceMessage(message: string) {
    return message.toLowerCase().includes('insufficient wallet balance');
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

    this.realtimeService.emitToGame(
      sessionId,
      'session:prize_updated',
      prizePayload,
    );
    this.realtimeService.emitToAdmin('session:prize_updated', prizePayload);
    this.realtimeService.emitToPublicGames(
      'session:prize_updated',
      prizePayload,
    );

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
      changes: [
        buildSessionCartelaChange({
          cartelaId: gameCartela.cartelaId,
          cartelaNumber: gameCartela.cartela.number,
          kind: 'REGISTERED',
          userId,
        }),
      ],
    });

    if (walletSnapshot) {
      this.realtimeService.emitToUser(userId, 'wallet:updated', walletSnapshot);
      this.realtimeService.emitToAdmin('wallet:updated', walletSnapshot);
    } else {
      void this.emitWalletUpdated(userId);
    }
  }

  private emitBulkRegistrationSideEffects(params: {
    sessionId: string;
    userId: string;
    gameCartelas: Prisma.GameCartelaGetPayload<{
      select: typeof myGameCartelaSelect;
    }>[];
    updatedSession: Prisma.GameSessionGetPayload<{
      select: typeof registrationSessionMetricsSelect;
    }>;
    walletSnapshot?: Awaited<ReturnType<WalletService['debitWallet']>>;
  }) {
    const { sessionId, userId, gameCartelas, updatedSession, walletSnapshot } =
      params;
    const prizePayload = this.buildSessionPrizeUpdatedPayload(updatedSession);

    this.realtimeService.emitToGame(
      sessionId,
      'session:prize_updated',
      prizePayload,
    );
    this.realtimeService.emitToAdmin('session:prize_updated', prizePayload);
    this.realtimeService.emitToPublicGames(
      'session:prize_updated',
      prizePayload,
    );

    for (const gameCartela of gameCartelas) {
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
    }

    this.operationsCacheService.invalidate();
    this.realtimeService.emitSessionCartelasUpdated({
      sessionId,
      slotId: updatedSession.gameSlotId,
      prizeAmount: updatedSession.prizeAmount.toString(),
      registeredCartelasCount: updatedSession._count.gameCartelas,
      changes: gameCartelas.map((gameCartela) =>
        buildSessionCartelaChange({
          cartelaId: gameCartela.cartelaId,
          cartelaNumber: gameCartela.cartela.number,
          kind: 'REGISTERED',
          userId,
        }),
      ),
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
