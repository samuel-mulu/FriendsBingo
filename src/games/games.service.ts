import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  CartelaPaymentSource,
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
import { isValidForceBigGameCartelaCount } from '../bingo-claims/force-big-game-tickets.util';
import { splitPrizeAmount } from '../bingo-claims/prize-split.util';
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
import { RegistrationStateView } from './dto/registration-state-query.dto';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { UpdateSlotEntryFeeDto } from './dto/update-slot-entry-fee.dto';
import { UpdateSlotEconomicsDto } from './dto/update-slot-economics.dto';
import { UpdateBigGameScheduleDto } from './dto/update-big-game-schedule.dto';
import { UpdateSlotOperationModeDto } from './dto/update-slot-operation-mode.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { AutoCallService } from './auto-call.service';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import { BigGameTicketService } from './big-game-ticket.service';
import { BigGameRoundService } from './big-game-round.service';
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';
import { lockGameSessionRow, lockGameSlotRow } from './game-row-lock';
import {
  BULK_COMMIT_CHUNK_SIZE,
  chunkCartelaItems,
  MAX_BULK_CARTELAS_PER_REQUEST,
} from './registration-limits';
import {
  buildSessionMoneyConfig,
  cartelaPoolForCategory,
  compareSortOrder,
  getBonusCartelaLimit,
  getRuntimeQueuePriority,
  canForceBigGameTickets,
  canUseBonusCartelaBalance,
  categoryCartelaLimitError,
  exposedMaxCartelasPerPlayer,
  isBonusLikeCategory,
  isBonusCategory,
  isBigGameCategory,
  isBigGotdCategory,
  isChainGameCategory,
  isFreeEntryCategory,
  isFixedPrizeCategory,
  isNormalCategory,
  isStandardQueueCategory,
  liveCartelaPoolCategoryFilter,
  remainingCategoryCartelaSlots,
} from './game-category.util';
import {
  BIG_GAME_MAX_INTER_ROUND_DELAY_SECONDS,
  BIG_GAME_MIN_INTER_ROUND_DELAY_SECONDS,
  CHAIN_GAME_MAX_INTER_ROUND_DELAY_SECONDS,
  CHAIN_GAME_MIN_INTER_ROUND_DELAY_SECONDS,
  buildChainRoundSeedData,
} from './chain-round.util';
import { ChainRoundService } from './chain-round.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { GameQueueService } from './game-queue.service';
import { assertValidGameStatusTransition } from './game-status.rules';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { GameOperationRepairService } from './game-operation-repair.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { computeNormalEconomicsFromStrings } from './normal-economics.util';
import { AppDisplayConfigService } from '../app-display-config/app-display-config.service';
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
  stampWinnerPayoutOwners,
  countRegistrationPaymentSources,
  countRegistrationPaymentSourcesFromGroups,
  toPlayerGameSession,
  toPlayerGameSlot,
  type SessionCartelaChange,
} from './games.mapper';
import {
  OperationsCacheRoleKey,
  OperationsCacheService,
} from './operations-cache.service';
import {
  isLiveRegistrationLockSourceStatus,
  RegistrationStateCacheService,
} from './registration-state-cache.service';
import {
  buildRegistrationStateForUser,
  SharedRegistrationSnapshot,
} from './registration-state.builder';
import {
  activeCartelaReservationSummarySelect,
  bigGameCurrentSessionSelect,
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
  type ActiveCartelaReservationSummaryRecord,
  type GameSessionRecord,
  type RegisteredCartelaSummaryRecord,
} from './games.select';
import { buildSessionOutcomeSummary } from './session-outcome-summary.builder';
import { buildSessionWinnerResults } from './session-winner-results.builder';
import {
  RegistrationAccounting,
  resolveRegistrationAccounting,
  toGameCartelaPaymentData,
} from './registration-payment.util';

type CachedOperationsSnapshot = {
  liveGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
  checkingGame: ReturnType<GamesService['buildFastSessionSnapshot']> | null;
  registrationOpenGame: ReturnType<
    GamesService['buildFastSessionSnapshot']
  > | null;
  queue: Array<
    | ReturnType<GamesService['buildFastSessionSnapshot']>
    | ReturnType<GamesService['buildFastQueueSlotSnapshot']>
  >;
  operationsState: 'active' | 'handoff' | 'idle';
  operationsVersion: number;
  timestamp: string;
  bigGameLiveElsewhere?: {
    sessionId: string;
    phase: 'live' | 'held';
  };
  /** Big Game READY next round while an earlier Big Game round is still live. */
  bigGameNextRegistration?: {
    sessionId: string;
    slotId: string;
    roundIndex: number;
    roundCount: number | null;
    scheduledStartAt: string | null;
    registrationOpensAt: string | null;
    registeredCartelasCount: number;
    playCode: string;
    staticCode: string;
  };
  __winnerOwnershipByCartelaId?: Record<string, string>;
};

@Injectable()
export class GamesService {
  private static readonly OPERATIONS_TRANSIENT_IDLE_GRACE_MS = 15000;
  private operationsSnapshotVersion = 0;
  private readonly recentNonIdleOperationsByCacheKey = new Map<
    OperationsCacheRoleKey,
    {
      capturedAt: number;
      payload: CachedOperationsSnapshot;
    }
  >();
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
    private readonly registrationStateCache: RegistrationStateCacheService,
    private readonly gameTimingConfigService: GameTimingConfigService,
    private readonly appDisplayConfigService: AppDisplayConfigService,
    private readonly autoReadyCountdownRepairService: AutoReadyCountdownRepairService,
    private readonly postGameRegistrationOpenerService: PostGameRegistrationOpenerService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
    private readonly invariantsService: GameOperationInvariantsService,
    private readonly repairService: GameOperationRepairService,
    private readonly bigGameTicketService: BigGameTicketService,
    private readonly bigGameRoundService: BigGameRoundService,
    private readonly chainRoundService: ChainRoundService,
  ) {}

  async createGameSlot(createGameDto: CreateGameDto, actorId?: string) {
    const gameRule = await this.gameRulesService.getActiveGameRuleOrThrow(
      createGameDto.gameRuleId,
    );
    const category = createGameDto.category ?? GameCategory.NORMAL;
    const isBigGotd = isBigGotdCategory(category);
    const isBonusLike = isBonusLikeCategory(category);
    const isBigGame = isBigGameCategory(category);
    // Chain Game pauses between rounds and resumes itself, which only works when
    // the server owns the calling cadence.
    const isChainGame = isChainGameCategory(category);
    const operationMode =
      isBigGame || isChainGame
        ? GameOperationMode.AUTO
        : (createGameDto.operationMode ?? GameOperationMode.MANUAL);
    const fixedPrizeAmount = isFixedPrizeCategory(category)
      ? this.parsePositiveMoneyOrThrow(
          createGameDto.fixedPrizeAmount,
          'fixedPrizeAmount',
        )
      : null;
    const maxCartelasPerPlayer = isBonusLike
      ? getBonusCartelaLimit(createGameDto.maxCartelasPerPlayer)
      : isChainGame
        ? this.parsePositiveIntOrThrow(
            createGameDto.maxCartelasPerPlayer,
            'maxCartelasPerPlayer',
            'chain games',
          )
        : null;
    const fixedPrizeEntryFee =
      isBigGame || isBigGotd || isChainGame
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

    const roundConfig = isBigGame
      ? await this.parseBigGameRoundConfigOrThrow(
          createGameDto,
          fixedPrizeAmount!,
          gameRule.id,
        )
      : isChainGame
        ? await this.parseChainGameRoundConfigOrThrow(
            createGameDto,
            fixedPrizeAmount!,
            gameRule.id,
          )
        : null;

    const forceConfig =
      canForceBigGameTickets(category) &&
      createGameDto.forceBigGameEnabled === true
        ? await this.parseForceBigGameConfigOrThrow(createGameDto)
        : { forceBigGameEnabled: false, forceBigGameCartelaCount: null as number | null };

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
    // Big Game always auto-calls after play starts (butter-flow).
    const autoCallIntervalSeconds =
      isBigGame || operationMode === GameOperationMode.AUTO
        ? (createGameDto.autoCallIntervalSeconds ??
          defaultAutoCallIntervalSeconds)
        : null;
    const normalDefaultEconomics = isNormalCategory(category)
      ? await this.gameTimingConfigService.getNormalDefaultEconomics()
      : null;

    const { slot, autoSessionId } = await this.prisma.$transaction(
      async (tx) => {
        if (isBigGame) {
          const existingBigGame = await tx.gameSession.findFirst({
            where: {
              gameSlot: {
                category: GameCategory.BIG_GAME,
                status: { not: GameStatus.CANCELLED },
              },
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
            select: { id: true },
          });

          if (existingBigGame) {
            throw new ConflictException({
              message: 'A Big Game is already scheduled',
              code: 'BIG_GAME_ALREADY_SCHEDULED',
            });
          }
        }

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
            ...(isBigGame || isBigGotd || isChainGame
              ? {
                  entryFee: fixedPrizeEntryFee!,
                  prizePerCartela: new Prisma.Decimal(0),
                }
              : normalDefaultEconomics
                ? {
                    entryFee: normalDefaultEconomics.entryFee,
                    prizePerCartela: normalDefaultEconomics.prizePerCartela,
                  }
                : {}),
            fixedPrizeAmount,
            maxCartelasPerPlayer,
            removeAfterFinish: true,
            ...(roundConfig
              ? {
                  roundCount: roundConfig.roundCount,
                  roundPrizes: roundConfig.roundPrizes,
                  roundGameRuleIds: roundConfig.roundGameRuleIds,
                  interRoundDelaySeconds: roundConfig.interRoundDelaySeconds,
                  currentRound: 1,
                }
              : {}),
            forceBigGameEnabled: forceConfig.forceBigGameEnabled,
            forceBigGameCartelaCount: forceConfig.forceBigGameCartelaCount,
            operationMode,
            registrationDurationSeconds,
            autoCallIntervalSeconds,
          },
          select: gameSlotSelect,
        });

        let createdAutoSessionId: string | null = null;

        // Only BIG_GAME opens READY immediately. Standard-queue AUTO stays NEXT
        // until PostGameRegistrationOpenerService opens the true queue head.
        if (isBigGame) {
          const scheduledStartAt = playStartAt!;
          const sessionMoneyConfig = buildSessionMoneyConfig(createdSlot, {
            prizeAmountOverride: roundConfig!.roundPrizeDecimals[0],
          });

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
              registrationOpensAt,
              scheduledStartAt,
              roundIndex: 1,
              gameRuleId: roundConfig!.roundGameRuleIds[0] ?? gameRule.id,
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
              roundCount: roundConfig?.roundCount ?? 1,
              roundPrizes: roundConfig?.roundPrizes ?? null,
              roundGameRuleIds: roundConfig?.roundGameRuleIds ?? null,
              interRoundDelaySeconds:
                roundConfig?.interRoundDelaySeconds ?? null,
              forceBigGameEnabled: forceConfig.forceBigGameEnabled,
              forceBigGameCartelaCount: forceConfig.forceBigGameCartelaCount,
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
    this.operationsCacheService.invalidate();

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

    if (
      operationMode === GameOperationMode.AUTO &&
      !isBigGameCategory(slot.category)
    ) {
      await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
        { ignoreReviewGrace: true },
      );
    }

    const operations =
      actorId != null
        ? await this.getAdminOperationsSnapshot(actorId)
        : await this.getCurrentOperations();

    return {
      ...payload,
      operations,
    };
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
    } else if (targetMode === GameOperationMode.AUTO) {
      await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
        { ignoreReviewGrace: true },
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

    // Promote next AUTO queue head after clear (clear previously left a gap).
    await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration({
      ignoreReviewGrace: true,
    });

    const operations =
      actorId != null
        ? await this.getAdminOperationsSnapshot(actorId)
        : await this.getCurrentOperations();

    return {
      clearedSlotsCount,
      cancelledEmptyRegistration,
      keptRegistration,
      operations,
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

    if (isNormalCategory(slot.category)) {
      throw new BadRequestException(
        'Use the economics endpoint to update entry fee and commission for normal games',
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

  async updateSlotEconomics(
    slotId: string,
    updateSlotEconomicsDto: UpdateSlotEconomicsDto,
    actorId?: string,
  ) {
    const economics = computeNormalEconomicsFromStrings(
      updateSlotEconomicsDto.entryFee,
      updateSlotEconomicsDto.companyFeePerCartela,
    );

    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        status: true,
        category: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    if (!isNormalCategory(slot.category)) {
      throw new BadRequestException(
        'Economics can only be updated for normal games',
      );
    }

    if (slot.status !== GameStatus.NEXT && slot.status !== GameStatus.READY) {
      throw new BadRequestException(
        'Economics can only be updated for upcoming normal games before play starts',
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
        'Economics cannot be changed after players have registered',
      );
    }

    const updatedSlot = await this.prisma.$transaction(async (tx) => {
      const savedSlot = await tx.gameSlot.update({
        where: { id: slotId },
        data: {
          entryFee: economics.entryFee,
          prizePerCartela: economics.prizePerCartela,
        },
        select: gameSlotSelect,
      });

      await tx.gameSession.updateMany({
        where: {
          gameSlotId: slotId,
          status: GameStatus.READY,
        },
        data: {
          entryFee: economics.entryFee,
          prizePerCartela: economics.prizePerCartela,
          companyFeePerCartela: economics.companyFeePerCartela,
        },
      });

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.slot.economics_update',
          entity: 'GameSlot',
          entityId: slotId,
          metadata: {
            entryFee: economics.entryFee.toString(),
            prizePerCartela: economics.prizePerCartela.toString(),
            companyFeePerCartela: economics.companyFeePerCartela.toString(),
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

    this.operationsCacheService.invalidate();

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

  async startBigGameNextRound(slotId: string, actorId?: string) {
    return this.bigGameRoundService.startNextRoundNow(slotId, actorId);
  }

  /** Player-facing Chain Game round ladder (pattern + prize per round). */
  async getChainRoundPlan(sessionId: string) {
    return this.chainRoundService.getRoundPlan(sessionId);
  }

  /** Admin: skip the rest of a Chain Game inter-round pause. */
  async continueChainRoundNow(slotId: string, actorId?: string) {
    const sessionId = await this.requirePausedChainSessionId(slotId);
    const resumeAt = await this.chainRoundService.continueNow(sessionId);

    await this.auditLogService.create(this.prisma, {
      actorId: actorId ?? null,
      action: 'admin.chain_round.continue_now',
      entity: 'GameSession',
      entityId: sessionId,
      metadata: { slotId, resumeAt: resumeAt.toISOString() },
    });

    this.operationsCacheService.invalidate();
    return { success: true, sessionId, resumeAt: resumeAt.toISOString() };
  }

  /** Admin: hold the Chain Game winner reveal open a bit longer. */
  async extendChainRoundPause(
    slotId: string,
    seconds: number,
    actorId?: string,
  ) {
    const sessionId = await this.requirePausedChainSessionId(slotId);
    const resumeAt = await this.chainRoundService.extendPause(
      sessionId,
      seconds,
    );

    await this.auditLogService.create(this.prisma, {
      actorId: actorId ?? null,
      action: 'admin.chain_round.extend_pause',
      entity: 'GameSession',
      entityId: sessionId,
      metadata: { slotId, seconds, resumeAt: resumeAt.toISOString() },
    });

    this.operationsCacheService.invalidate();
    return { success: true, sessionId, resumeAt: resumeAt.toISOString() };
  }

  private async requirePausedChainSessionId(slotId: string): Promise<string> {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: { id: true, category: true },
    });

    if (!slot || !isChainGameCategory(slot.category)) {
      throw new NotFoundException('Chain Game slot not found');
    }

    const session = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: GameStatus.PLAYING,
        roundPausedUntil: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!session) {
      throw new BadRequestException({
        code: 'CHAIN_GAME_NOT_PAUSED',
        message: 'Chain Game is not between rounds',
      });
    }

    return session.id;
  }

  /**
   * Admin escape hatch: force Round-1 Big Game to PLAYING now.
   * Distinct from start-next-round (FINISHED + nextRoundStartsAt).
   */
  async startBigGameNow(slotId: string, actorId?: string) {
    const slot = await this.prisma.gameSlot.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        category: true,
        status: true,
        staticCode: true,
      },
    });

    if (!slot || slot.category !== GameCategory.BIG_GAME) {
      throw new NotFoundException('Big Game slot not found');
    }

    if (slot.status === GameStatus.CANCELLED) {
      throw new BadRequestException('Big Game is cancelled');
    }

    const readySession = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: GameStatus.READY,
      },
      select: {
        id: true,
        scheduledStartAt: true,
      },
    });

    if (!readySession) {
      throw new BadRequestException({
        code: 'BIG_GAME_NOT_READY',
        message: 'Big Game must be READY to start now',
      });
    }

    const blockingSession = await this.findBlockingNonBigGameSession(true);
    if (blockingSession) {
      const summary = this.buildBlockingLiveGameSummary(blockingSession);
      throw new BadRequestException({
        code: 'BIG_GAME_HELD_BY_LIVE',
        message: `Close or cancel live game ${summary.staticCode} before starting the Big Game`,
        blockingLiveGame: summary,
      });
    }

    const now = new Date();
    if (
      readySession.scheduledStartAt == null ||
      readySession.scheduledStartAt.getTime() > now.getTime()
    ) {
      await this.prisma.gameSession.update({
        where: { id: readySession.id },
        data: { scheduledStartAt: now },
      });
    }

    const started = await this.gameEngineService.startGame(
      slotId,
      actorId,
      undefined,
      {
        forceBigGameStart: true,
      },
    );

    const intervalSeconds =
      (await this.prisma.gameSlot.findUnique({
        where: { id: slotId },
        select: { autoCallIntervalSeconds: true },
      }))?.autoCallIntervalSeconds ??
      (await this.gameTimingConfigService.getAutoCallIntervalSeconds());

    await this.prisma.gameSession.update({
      where: { id: started.id },
      data: { autoCallIntervalMs: intervalSeconds * 1000 },
    });
    await this.autoCallService.startAutoCall(started.id, {
      callFirstImmediately: true,
    });

    return started;
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
        const session = await this.getSessionForRegistrationWrite(tx, sessionId);

        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        await this.assertSessionRegistrationAllowed(session, { db: tx });

        const cartela = await tx.cartela.findUnique({
          where: { id: registerCartelaDto.cartelaId },
          select: { id: true },
        });

        if (!cartela) {
          throw new NotFoundException('Cartela not found');
        }

        if (this.shouldLockCartelasAgainstLiveRound(session)) {
          await this.assertCartelaNotLockedByLiveRound(
            tx,
            session.id,
            cartela.id,
            session.gameSlot.category,
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

        const paymentPlan = await this.resolveRegistrationPaymentPlan(
          tx,
          userId,
          session,
          registerCartelaDto.paymentSource,
        );

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: cartela.id,
            status: GameCartelaStatus.REGISTERED,
            ...toGameCartelaPaymentData(paymentPlan),
          },
          select: myGameCartelaSelect,
        });

        const walletSnapshot = paymentPlan.isFreeEntry
          ? undefined
          : await this.applyRegistrationPayment(
              tx,
              userId,
              session,
              gameCartela.id,
              paymentPlan,
            );

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
    this.assertBulkCartelasWithinLimit(bulkRegisterCartelasDto.cartelas.length);

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
    this.assertBulkCartelasWithinLimit(bulkRegisterCartelasDto.cartelas.length);

    const chunks = chunkCartelaItems(
      bulkRegisterCartelasDto.cartelas,
      BULK_COMMIT_CHUNK_SIZE,
    );
    const allSuccesses: Prisma.GameCartelaGetPayload<{
      select: typeof myGameCartelaSelect;
    }>[] = [];
    const allFailures: Array<{
      cartelaId: string;
      cartelaNumber: number;
      reason: string;
    }> = [];
    let lastUpdatedSession: Prisma.GameSessionGetPayload<{
      select: typeof registrationSessionMetricsSelect;
    }> | null = null;
    let lastWalletSnapshot:
      | Awaited<ReturnType<WalletService['debitWallet']>>
      | undefined;
    let registrationClosedReason: string | null = null;

    for (const chunk of chunks) {
      if (registrationClosedReason != null) {
        allFailures.push(
          ...chunk.map((cartela) =>
            this.buildBulkRegistrationFailure(
              cartela,
              registrationClosedReason!,
            ),
          ),
        );
        continue;
      }

      try {
        const chunkResult = await this.registerCartelasBulkChunkWithRetry(
          sessionId,
          userId,
          chunk,
          bulkRegisterCartelasDto.paymentSource,
        );
        allSuccesses.push(...chunkResult.successes);
        allFailures.push(...chunkResult.failures);
        if (chunkResult.updatedSession) {
          lastUpdatedSession = chunkResult.updatedSession;
        }
        if (chunkResult.walletSnapshot) {
          lastWalletSnapshot = chunkResult.walletSnapshot;
        }
      } catch (error) {
        const closedReason = this.extractRegistrationClosedReason(error);
        if (closedReason) {
          registrationClosedReason = closedReason;
          allFailures.push(
            ...chunk.map((cartela) =>
              this.buildBulkRegistrationFailure(cartela, closedReason),
            ),
          );
          continue;
        }

        throw error;
      }
    }

    if (allSuccesses.length > 0 && lastUpdatedSession) {
      try {
        this.emitBulkRegistrationSideEffects({
          sessionId,
          userId,
          gameCartelas: allSuccesses,
          updatedSession: lastUpdatedSession,
          walletSnapshot: lastWalletSnapshot,
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
      successes: allSuccesses.map((gameCartela) =>
        serializeGameCartela(gameCartela),
      ),
      failures: allFailures,
    };
  }

  private async registerCartelasBulkChunkWithRetry(
    sessionId: string,
    userId: string,
    chunkCartelas: BulkRegisterCartelaItemDto[],
    preferredPaymentSource?: CartelaPaymentSource | null,
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
            const session = await this.getSessionForRegistrationWrite(
              tx,
              sessionId,
            );

            if (!session) {
              throw new NotFoundException('Game session not found');
            }

            await this.assertSessionRegistrationAllowed(session, {
              now,
              db: tx,
            });

            const freeEntryCategory = isFreeEntryCategory(
              session.gameSlot.category,
            );
            const usesBonusCartelaBalance = canUseBonusCartelaBalance(
              session.gameSlot.category,
            );
            const requestedCartelas = chunkCartelas;
            const uniqueCartelaIds = [
              ...new Set(requestedCartelas.map((cartela) => cartela.cartelaId)),
            ];

            const liveLockedCartelaIds =
              this.shouldLockCartelasAgainstLiveRound(session)
                ? await this.findLiveLockedCartelaIds(
                    tx,
                    session.id,
                    uniqueCartelaIds,
                    session.gameSlot.category,
                    now,
                  )
                : new Set<string>();

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
              tx.gameCartela.count({
                where: {
                  gameSessionId: sessionId,
                  userId,
                  status: { not: GameCartelaStatus.CANCELLED },
                },
              }),
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
            let remainingCategorySlots = remainingCategoryCartelaSlots({
              category: session.gameSlot.category,
              maxCartelasPerPlayer: session.gameSlot.maxCartelasPerPlayer,
              existingCount: myExistingRegistrationCount,
            });
            const reservationIdsToConfirm: string[] = [];

            let remainingBonusCartelaBalance: number | null = null;
            if (!freeEntryCategory && usesBonusCartelaBalance) {
              const wallet = await this.walletService.getWalletOrThrow(
                tx,
                userId,
              );
              remainingBonusCartelaBalance = wallet.bonusCartelaBalance;
            }

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

                if (remainingCategorySlots <= 0) {
                  failures.push(
                    this.buildBulkRegistrationFailure(
                      cartela,
                      categoryCartelaLimitError(session.gameSlot.category)
                        .message,
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

                const paymentPlan =
                  remainingBonusCartelaBalance !== null
                    ? this.resolveRegistrationPaymentPlanFromBonusBalance(
                        session,
                        remainingBonusCartelaBalance,
                        preferredPaymentSource,
                      )
                    : await this.resolveRegistrationPaymentPlan(
                        tx,
                        userId,
                        session,
                        preferredPaymentSource,
                      );

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
                      ...toGameCartelaPaymentData(paymentPlan),
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

                if (!paymentPlan.isFreeEntry) {
                  try {
                    walletSnapshot = await this.applyRegistrationPayment(
                      tx,
                      userId,
                      session,
                      gameCartela.id,
                      paymentPlan,
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

                  if (
                    paymentPlan.paymentSource ===
                      CartelaPaymentSource.BONUS_CARTELA &&
                    remainingBonusCartelaBalance !== null
                  ) {
                    remainingBonusCartelaBalance -= 1;
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
                if (Number.isFinite(remainingCategorySlots)) {
                  remainingCategorySlots -= 1;
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

    return txResult;
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

      await this.assertSessionRegistrationAllowed(session, { now, db: tx });

      const cartela = await tx.cartela.findUnique({
        where: { id: cartelaId },
        select: { id: true },
      });

      if (!cartela) {
        throw new NotFoundException('Cartela not found');
      }

      if (this.shouldLockCartelasAgainstLiveRound(session)) {
        await this.assertCartelaNotLockedByLiveRound(
          tx,
          session.id,
          cartela.id,
          session.gameSlot.category,
          now,
        );
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
    this.assertBulkCartelasWithinLimit(
      bulkReserveCartelasDto.cartelaIds.length,
    );

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

        await this.assertSessionRegistrationAllowed(session, { now, db: tx });

        const cartelas = await tx.cartela.findMany({
          where: { id: { in: uniqueCartelaIds } },
          select: { id: true },
        });
        const knownCartelaIds = new Set(cartelas.map((cartela) => cartela.id));

        const liveLockedCartelaIds = this.shouldLockCartelasAgainstLiveRound(
          session,
        )
          ? await this.findLiveLockedCartelaIds(
              tx,
              session.id,
              uniqueCartelaIds,
              session.gameSlot.category,
              now,
            )
          : new Set<string>();

        const registeredCartelas = await tx.gameCartela.findMany({
          where: {
            gameSessionId: sessionId,
            cartelaId: { in: uniqueCartelaIds },
            status: { not: GameCartelaStatus.CANCELLED },
          },
          select: { cartelaId: true, userId: true },
        });
        const registeredByCartelaId = new Map(
          registeredCartelas.map((registration) => [
            registration.cartelaId,
            registration,
          ]),
        );

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
        const failures: Array<{ cartelaId: string; reason: string }> = [];

        for (const cartelaId of uniqueCartelaIds) {
          if (!knownCartelaIds.has(cartelaId)) {
            failures.push({
              cartelaId,
              reason: 'Cartela not found',
            });
            continue;
          }

          if (ownedCartelaIds.has(cartelaId)) {
            continue;
          }

          const registration = registeredByCartelaId.get(cartelaId);
          if (registration && registration.userId !== userId) {
            failures.push({
              cartelaId,
              reason: 'This cartela is already registered for this session',
            });
            continue;
          }

          if (liveLockedCartelaIds.has(cartelaId)) {
            failures.push({
              cartelaId,
              reason: 'This cartela is already in use in the current live game',
            });
            continue;
          }

          if (!cartelaIdsToReserve.includes(cartelaId)) {
            continue;
          }

          const activeReservation = activeReservationByCartelaId.get(cartelaId);

          if (activeReservation && activeReservation.userId !== userId) {
            failures.push({
              cartelaId,
              reason: 'Another player is choosing this cartela',
            });
            continue;
          }

          try {
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
          } catch (error) {
            if (error instanceof ConflictException) {
              failures.push({
                cartelaId,
                reason: 'Another player is choosing this cartela',
              });
              continue;
            }

            throw error;
          }
        }

        return { sessionId, reservations, failures };
      },
      {
        maxWait: 15_000,
        timeout: 30_000,
      },
    );

    const reservedCartelaIds = txResult.reservations.map(
      (reservation) => reservation.cartelaId,
    );
    const cartelaBoards = await this.prisma.cartela.findMany({
      where: { id: { in: reservedCartelaIds } },
      select: cartelaSelect,
    });
    const cartelaNumberById = new Map(
      cartelaBoards.map((board) => [board.id, board.number]),
    );

    if (txResult.reservations.length > 0) {
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
    }

    return {
      sessionId: txResult.sessionId,
      reservations: txResult.reservations.map((reservation) => ({
        id: reservation.id,
        cartelaId: reservation.cartelaId,
        expiresAt: reservation.expiresAt.toISOString(),
        status: reservation.status,
      })),
      failures: txResult.failures,
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

        const session = await this.getSessionForRegistrationWrite(
          tx,
          reservation.gameSessionId,
        );
        if (!session) {
          throw new NotFoundException('Game session not found');
        }

        await this.assertSessionRegistrationAllowed(session, { db: tx });

        if (this.shouldLockCartelasAgainstLiveRound(session)) {
          await this.assertCartelaNotLockedByLiveRound(
            tx,
            session.id,
            reservation.cartelaId,
            session.gameSlot.category,
          );
        }
        await this.assertCategoryCartelaLimit(
          tx,
          session.id,
          userId,
          session.gameSlot.category,
          session.gameSlot.maxCartelasPerPlayer,
        );

        const paymentPlan = await this.resolveRegistrationPaymentPlan(
          tx,
          userId,
          session,
        );

        const gameCartela = await tx.gameCartela.create({
          data: {
            gameSessionId: session.id,
            userId,
            cartelaId: reservation.cartelaId,
            status: GameCartelaStatus.REGISTERED,
            ...toGameCartelaPaymentData(paymentPlan),
          },
          select: myGameCartelaSelect,
        });

        const walletSnapshot = paymentPlan.isFreeEntry
          ? undefined
          : await this.applyRegistrationPayment(
              tx,
              userId,
              session,
              gameCartela.id,
              paymentPlan,
            );

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
        status: true,
        gameSlotId: true,
        prizeAmount: true,
        gameSlot: { select: { category: true } },
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

    await this.invalidateRegistrationStateAfterCommittedMutation(
      sessionId,
      session.status,
      session.gameSlot.category,
    );

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
        category: true,
      },
    });

    if (!slot) {
      throw new NotFoundException('Game slot not found');
    }

    assertValidGameStatusTransition(slot.status, updateGameStatusDto.status);

    const previousSlotStatus = slot.status;
    const shouldPromoteAfterCancel =
      updateGameStatusDto.status === GameStatus.CANCELLED &&
      (previousSlotStatus === GameStatus.NEXT ||
        previousSlotStatus === GameStatus.READY);

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

      // No live/READY session (e.g. finished round waiting on next) still needs
      // Big Ticket expiry + clearing nextRoundStartsAt so the event disappears.
      if (
        slot.category === GameCategory.BIG_GAME &&
        activeSessions.length === 0
      ) {
        await this.prisma.$transaction(async (tx) => {
          await this.bigGameRoundService.tearDownEventArtifacts(tx, slotId);
        });
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
            status: {
              in: [
                GameStatus.PLAYING,
                GameStatus.CHECKING,
                GameStatus.WINNER_WINDOW,
              ],
            },
          },
          data: {
            status: updateGameStatusDto.status,
            finishedAt: new Date(),
          },
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

    if (shouldPromoteAfterCancel) {
      await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
        { ignoreReviewGrace: true },
      );
    }

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
      this.logger.warn(
        `[game_snapshot_null] endpoint=current/live user=${requestingUserId ?? 'guest'} operationsState=${operations.operationsState}`,
      );
      return null;
    }

    if (current.sessionId) {
      return this.getSessionDetail(current.sessionId, requestingUserId);
    }

    return this.getSlotDetail(current.slotId);
  }

  async getCurrentBigGame(requestingUserId?: string) {
    const leanSessions = await this.findActiveBigGameSessions();
    if (leanSessions.length === 0) {
      return null;
    }

    const sorted = [...leanSessions].sort((left, right) =>
      this.compareBigGameSessions(left, right),
    );
    const leanSession = sorted[0];

    const primaryPayload = await this.buildCurrentBigGameSessionPayload({
      sessionId: leanSession.id,
      requestingUserId,
      includePreviousRound: true,
    });
    if (!primaryPayload) {
      return null;
    }

    const primaryRound = primaryPayload.roundIndex ?? 1;
    const isPrimaryLive =
      primaryPayload.status === GameStatus.PLAYING ||
      primaryPayload.status === GameStatus.CHECKING ||
      primaryPayload.status === GameStatus.WINNER_WINDOW;

    // Option A: Round N+1 becomes the primary READY after handoff. Only attach
    // nextRoundRegistration while live if a legacy overlapped READY still exists.
    let nextRoundRegistration: Awaited<
      ReturnType<GamesService['buildCurrentBigGameSessionPayload']>
    > | null = null;

    if (isPrimaryLive) {
      const nextLean = sorted.find(
        (session) =>
          session.status === GameStatus.READY &&
          (session.roundIndex ?? 1) === primaryRound + 1,
      );
      if (nextLean) {
        nextRoundRegistration = await this.buildCurrentBigGameSessionPayload({
          sessionId: nextLean.id,
          requestingUserId,
          includePreviousRound: true,
          previousRoundAllowLive: true,
        });
      }
    }

    return {
      ...primaryPayload,
      ...(nextRoundRegistration
        ? { nextRoundRegistration }
        : {}),
    };
  }

  private async buildCurrentBigGameSessionPayload(params: {
    sessionId: string;
    requestingUserId?: string;
    includePreviousRound: boolean;
    previousRoundAllowLive?: boolean;
  }) {
    const [session, paymentGroups] = await Promise.all([
      this.prisma.gameSession.findUnique({
        where: { id: params.sessionId },
        select: bigGameCurrentSessionSelect,
      }),
      this.prisma.gameCartela.groupBy({
        by: ['paymentSource'],
        where: {
          gameSessionId: params.sessionId,
          status: { not: GameCartelaStatus.CANCELLED },
        },
        _count: { _all: true },
      }),
    ]);
    if (!session) {
      return null;
    }

    const paymentCounts =
      countRegistrationPaymentSourcesFromGroups(paymentGroups);
    const serialized = serializeGameSessionForPlayer({
      ...session,
      gameCartelas: [],
      gameCartelaReservations: [],
      // Chain-only fields; a Big Game session never has them.
      roundResults: [],
      roundPausedUntil: null,
      roundPrizeAmount: null,
    } as GameSessionRecord);
    const blockingSession = await this.findBlockingNonBigGameSession(false);
    const heldState = this.resolveBigGameHeldState(session, blockingSession);

    const ticketFields = params.requestingUserId
      ? await this.bigGameTicketService.getWalletTicketFields(
          params.requestingUserId,
        )
      : {
          bigGameTicketBalance: 0,
          bigGameTicketSlotId: null as string | null,
          bigGameName: null as string | null,
        };

    const previousRound = params.includePreviousRound
      ? await this.resolveBigGamePreviousRoundSummary({
          gameSlotId: session.gameSlotId,
          roundIndex: session.roundIndex ?? 1,
          status: session.status,
          requestingUserId: params.requestingUserId,
          allowLivePrevious: params.previousRoundAllowLive === true,
        })
      : null;

    const finishedRounds =
      (session.roundIndex ?? 1) > 1
        ? await this.resolveBigGameFinishedRounds({
            gameSlotId: session.gameSlotId,
            beforeRoundIndex: session.roundIndex ?? 1,
          })
        : [];

    return {
      ...serialized,
      ...paymentCounts,
      // Inter-round clients historically used nextRoundStartsAt for countdown;
      // when the next READY session is open, scheduledStartAt is the play time.
      nextRoundStartsAt:
        session.status === GameStatus.READY &&
        (session.roundIndex ?? 1) > 1 &&
        session.scheduledStartAt
          ? session.scheduledStartAt
          : serialized.nextRoundStartsAt,
      heldWaitingForLiveSlot: heldState.heldWaitingForLiveSlot,
      ...(heldState.blockingLiveGame
        ? { blockingLiveGame: heldState.blockingLiveGame }
        : {}),
      ...(previousRound ? { previousRound } : {}),
      ...(finishedRounds.length > 0 ? { finishedRounds } : {}),
      bigGameTicketBalance: ticketFields.bigGameTicketBalance,
      bigGameTicketSlotId: ticketFields.bigGameTicketSlotId,
      bigGameName: ticketFields.bigGameName,
    };
  }

  private async resolveBigGameSessionWinners(params: {
    sessionId: string;
    prizeAmount: Prisma.Decimal;
  }): Promise<
    Array<{
      userId: string;
      fullName: string;
      cartelaNumber: number;
      amount: string;
    }>
  > {
    const winners = await this.prisma.gameCartela.findMany({
      where: {
        gameSessionId: params.sessionId,
        OR: [
          { isWinner: true },
          { status: GameCartelaStatus.WINNER },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        user: { select: { fullName: true } },
        cartela: { select: { number: true } },
      },
    });

    if (winners.length === 0) {
      return [];
    }

    const shares = splitPrizeAmount(params.prizeAmount, winners.length);
    return winners.map((winner, index) => ({
      userId: winner.userId,
      fullName: winner.user.fullName,
      cartelaNumber: winner.cartela.number,
      amount: shares[index]?.toString() ?? '0',
    }));
  }

  private async resolveBigGameFinishedRounds(params: {
    gameSlotId: string;
    beforeRoundIndex: number;
  }): Promise<
    Array<{
      sessionId: string;
      roundIndex: number;
      status: GameStatus;
      playCode: string | null;
      finishedAt: Date | null;
      prizeAmount: string;
      winners: Array<{
        userId: string;
        fullName: string;
        cartelaNumber: number;
        amount: string;
      }>;
    }>
  > {
    if (params.beforeRoundIndex <= 1) {
      return [];
    }

    const sessions = await this.prisma.gameSession.findMany({
      where: {
        gameSlotId: params.gameSlotId,
        roundIndex: { lt: params.beforeRoundIndex, gte: 1 },
        status: {
          in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
        },
      },
      orderBy: [{ roundIndex: 'asc' }, { finishedAt: 'desc' }],
      select: {
        id: true,
        roundIndex: true,
        status: true,
        playCode: true,
        finishedAt: true,
        prizeAmount: true,
      },
    });

    const byRound = new Map<number, (typeof sessions)[number]>();
    for (const session of sessions) {
      const round = session.roundIndex ?? 1;
      if (!byRound.has(round)) {
        byRound.set(round, session);
      }
    }

    const ordered = [...byRound.values()].sort(
      (left, right) => (left.roundIndex ?? 1) - (right.roundIndex ?? 1),
    );

    return Promise.all(
      ordered.map(async (session) => ({
        sessionId: session.id,
        roundIndex: session.roundIndex ?? 1,
        status: session.status,
        playCode: session.playCode,
        finishedAt: session.finishedAt,
        prizeAmount: session.prizeAmount.toString(),
        winners: await this.resolveBigGameSessionWinners({
          sessionId: session.id,
          prizeAmount: session.prizeAmount,
        }),
      })),
    );
  }

  /**
   * Prior-round context for Round 2+ READY (finished or still-live overlap)
   * so Flutter can show missed-style "you missed Round N / register Round N+1".
   */
  private async resolveBigGamePreviousRoundSummary(params: {
    gameSlotId: string;
    roundIndex: number;
    status: GameStatus;
    requestingUserId?: string;
    allowLivePrevious?: boolean;
  }) {
    const {
      gameSlotId,
      roundIndex,
      status,
      requestingUserId,
      allowLivePrevious,
    } = params;
    if (
      roundIndex <= 1 ||
      (status !== GameStatus.READY && status !== GameStatus.NEXT)
    ) {
      return null;
    }

    const previousStatuses: GameStatus[] = allowLivePrevious
      ? [
          GameStatus.PLAYING,
          GameStatus.CHECKING,
          GameStatus.WINNER_WINDOW,
          GameStatus.FINISHED,
          GameStatus.NO_WINNER,
          GameStatus.CANCELLED,
        ]
      : [GameStatus.FINISHED, GameStatus.NO_WINNER, GameStatus.CANCELLED];

    const previous = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId,
        roundIndex: roundIndex - 1,
        status: { in: previousStatuses },
      },
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
      select: {
        id: true,
        roundIndex: true,
        status: true,
        playCode: true,
        finishedAt: true,
        prizeAmount: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: GameCartelaStatus.CANCELLED } },
            },
          },
        },
      },
    });

    if (!previous) {
      return null;
    }

    let playerOwnedPreviousRound = false;
    if (requestingUserId) {
      const owned = await this.prisma.gameCartela.findFirst({
        where: {
          gameSessionId: previous.id,
          userId: requestingUserId,
          status: { not: GameCartelaStatus.CANCELLED },
        },
        select: { id: true },
      });
      playerOwnedPreviousRound = owned != null;
    }

    const winners = await this.resolveBigGameSessionWinners({
      sessionId: previous.id,
      prizeAmount: previous.prizeAmount,
    });

    return {
      sessionId: previous.id,
      roundIndex: previous.roundIndex ?? roundIndex - 1,
      status: previous.status,
      playCode: previous.playCode,
      finishedAt: previous.finishedAt,
      registeredCartelasCount: previous._count.gameCartelas,
      playerOwnedPreviousRound,
      winners,
    };
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
        const cacheKey = this.buildOperationsCacheKey(requestingUserRole);
        const cached = this.readOperationsCache(cacheKey);
        if (
          cached &&
          !(
            requestingUserRole === UserRole.ADMIN &&
            this.isQueueGapOperationsSnapshot(cached)
          )
        ) {
          this.rememberRecentNonIdleOperationsSnapshot(cacheKey, cached);
          return this.stampOperationsServerNow(
            this.applyOperationsResponseOverlay(
              cached,
              requestingUserId,
              requestingUserRole,
            ),
          );
        }

        const { value: loaded } = await this.operationsCacheService.coalesce(
          cacheKey,
          async () => {
            let cacheWriteGeneration =
              this.operationsCacheService.getGeneration();
            let result = await this.getCurrentOperationsInternal(
              requestingUserRole,
            );

            if (
              requestingUserRole === UserRole.ADMIN &&
              this.isQueueGapOperationsSnapshot(result)
            ) {
              try {
                await this.repairService.repairAllInvalidReadySessions();
                const opened =
                  await this.postGameRegistrationOpenerService.openNextAutoQueueRegistration(
                    { ignoreReviewGrace: true },
                  );
                if (opened) {
                  this.logger.log(
                    `[queue_gap_healed] queueLength=${result.queue.length} requestingUserId=${requestingUserId ?? 'unknown'}`,
                  );
                  this.operationsCacheService.invalidate();
                  cacheWriteGeneration =
                    this.operationsCacheService.getGeneration();
                  result = await this.getCurrentOperationsInternal(
                    requestingUserRole,
                  );
                }
              } catch (error) {
                this.logger.warn(
                  `[queue_gap_heal_failed] ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }

            const stabilized = this.stabilizeTransientIdleOperations(
              cacheKey,
              result,
            );
            if (this.shouldCacheOperationsSnapshot(stabilized)) {
              this.writeOperationsCache(
                cacheKey,
                stabilized,
                cacheWriteGeneration,
              );
            }

            return stabilized;
          },
        );

        void this.invariantsService?.assertGameOperationInvariants?.();

        return this.stampOperationsServerNow(
          this.applyOperationsResponseOverlay(
            loaded,
            requestingUserId,
            requestingUserRole,
          ),
        );
      },
    );
  }

  async getRegistrationState(
    sessionId: string,
    requestingUserId?: string,
    view: RegistrationStateView = 'full',
  ) {
    const userRole = resolvePerformanceRole(requestingUserId);

    return this.requestPerformance.run(
      {
        operation: 'getRegistrationState',
        userRole,
      },
      async () => {
        const snapshot = await this.registrationStateCache.load(
          sessionId,
          () => this.loadSharedRegistrationSnapshot(sessionId),
        );
        return buildRegistrationStateForUser(
          snapshot,
          requestingUserId,
          view,
        );
      },
      (result) => ({
        registeredCartelasSummaryCount: result.registeredCartelasSummary.length,
        myCartelaIdsCount: result.myCartelaIds.length,
      }),
    );
  }

  private async loadSharedRegistrationSnapshot(
    sessionId: string,
  ): Promise<SharedRegistrationSnapshot> {
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

    let liveLockedCartelas: RegisteredCartelaSummaryRecord[] = [];
    let liveLockedReservations: ActiveCartelaReservationSummaryRecord[] = [];

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

      [liveLockedCartelas, liveLockedReservations] = await Promise.all([
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
    }

    return {
      sessionId,
      session,
      gameCartelas,
      gameCartelaReservations,
      liveLockedCartelas,
      liveLockedReservations,
    };
  }

  private async invalidateRegistrationStateAfterCommittedMutation(
    sessionId: string,
    sessionStatus: GameStatus,
    category?: GameCategory,
  ): Promise<void> {
    this.registrationStateCache.invalidate(sessionId);

    if (!isLiveRegistrationLockSourceStatus(sessionStatus)) {
      return;
    }

    const resolvedCategory =
      category ??
      (
        await this.prisma.gameSession.findUnique({
          where: { id: sessionId },
          select: { gameSlot: { select: { category: true } } },
        })
      )?.gameSlot.category;

    if (resolvedCategory) {
      await this.registrationStateCache.invalidateReadySessionsInPool(
        this.prisma,
        resolvedCategory,
      );
    }
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
    requestingUserRole: UserRole,
  ): OperationsCacheRoleKey {
    return requestingUserRole === UserRole.ADMIN ? 'admin' : 'player';
  }

  private async getAdminOperationsSnapshot(actorId: string) {
    return this.getCurrentOperations(actorId, UserRole.ADMIN);
  }

  private readOperationsCache(
    cacheKey: OperationsCacheRoleKey,
  ): CachedOperationsSnapshot | null {
    return this.operationsCacheService.read<CachedOperationsSnapshot>(cacheKey);
  }

  private writeOperationsCache(
    cacheKey: OperationsCacheRoleKey,
    payload: CachedOperationsSnapshot,
    loaderGeneration: number,
  ): void {
    this.operationsCacheService.write(cacheKey, payload, loaderGeneration);
  }

  private applyOperationsResponseOverlay<
    T extends CachedOperationsSnapshot,
  >(
    snapshot: T,
    requestingUserId: string | undefined,
    requestingUserRole: UserRole,
  ): Omit<T, '__winnerOwnershipByCartelaId'> {
    const {
      __winnerOwnershipByCartelaId: winnerOwnershipByCartelaId,
      ...publicSnapshot
    } = snapshot;

    if (
      requestingUserRole !== UserRole.ADMIN ||
      publicSnapshot.liveGame?.winnerPayoutsSummary == null
    ) {
      return publicSnapshot;
    }

    return {
      ...publicSnapshot,
      liveGame: {
        ...publicSnapshot.liveGame,
        winnerPayoutsSummary: stampWinnerPayoutOwners(
          publicSnapshot.liveGame.winnerPayoutsSummary,
          requestingUserId,
          winnerOwnershipByCartelaId,
        ),
      },
    };
  }

  private stampOperationsServerNow<
    T extends Omit<CachedOperationsSnapshot, '__winnerOwnershipByCartelaId'>,
  >(payload: T): T & { serverNow: string; timestamp: string } {
    const serverNow = new Date().toISOString();
    return {
      ...payload,
      serverNow,
      timestamp: serverNow,
    };
  }

  private async getCurrentOperationsInternal(
    requestingUserRole: UserRole = UserRole.PLAYER,
  ): Promise<CachedOperationsSnapshot> {
    const isAdmin = requestingUserRole === UserRole.ADMIN;

    const [
      finishedResultDisplaySeconds,
      liveSession,
      checkingSession,
      readySessions,
      nextSlots,
      bigGameSessions,
    ] = await Promise.all([
      this.gameTimingConfigService.getFinishedResultDisplaySeconds(),
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
      this.findActiveBigGameSessions(),
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
    const hasActiveBlockingSession =
      liveSession != null || checkingSession != null;
    const readySlotIds = new Set(
      availableReadySessions.map((session) => session.gameSlot.id),
    );
    const queueNextSlots = nextSlots.filter(
      (slot) => !usedSlotIds.has(slot.id) && !readySlotIds.has(slot.id),
    );
    const registrationCandidate = this.pickRegistrationCandidate(
      availableReadySessions,
      queueNextSlots,
      { hasActiveBlockingSession },
    );

    let effectiveLiveSession = liveSession;
    let effectiveCheckingSession = checkingSession;
    let terminalFallbackSlotId: string | null = null;

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
          {
            isAdmin,
            hasActiveBlockingSession,
            includePrizePerCartela: true,
          },
        ),
        isAdmin,
      );
    }

    // Final guard for in-flight READY -> PLAYING handoff races:
    // if this request started before the transition committed, do one last
    // spot-check on the chosen registration session and upgrade it to live
    // before returning stale READY state to the client.
    if (
      effectiveLiveSession == null &&
      effectiveCheckingSession == null &&
      registrationCandidate?.kind === 'ready'
    ) {
      const transitionedSession = await this.prisma.gameSession.findUnique({
        where: { id: registrationCandidate.session.id },
        select: this.getOperationsSnapshotSelect(isAdmin),
      });

      if (
        transitionedSession?.status === GameStatus.PLAYING ||
        transitionedSession?.status === GameStatus.WINNER_WINDOW
      ) {
        effectiveLiveSession = transitionedSession;
        registrationOpenGame = null;
      } else if (transitionedSession?.status === GameStatus.CHECKING) {
        effectiveCheckingSession = transitionedSession;
        registrationOpenGame = null;
      }
    }

    // Guard for slot/session desync windows:
    // if slot is already claimed operationally but the selected session
    // snapshot still reports READY (or wasn't selected as registration),
    // promote that slot to live/checking so clients never see all-null
    // during active transitions.
    if (
      effectiveLiveSession == null &&
      effectiveCheckingSession == null &&
      registrationOpenGame == null
    ) {
      const claimedSession =
        await this.findClaimedOperationalSlotSession(isAdmin);
      if (claimedSession != null) {
        const normalizedClaimed =
          this.normalizeClaimedOperationalSession(claimedSession);
        if (normalizedClaimed.status === GameStatus.CHECKING) {
          effectiveCheckingSession = normalizedClaimed;
        } else {
          effectiveLiveSession = normalizedClaimed;
        }
      }
    }

    // Keep operations monotonic during FINISHED -> next READY handoff.
    // If no live/checking/registration exists yet, surface a very recent
    // terminal session so clients do not momentarily drop to game=null.
    if (
      effectiveLiveSession == null &&
      effectiveCheckingSession == null &&
      registrationOpenGame == null
    ) {
      const terminalFallbackCutoff = new Date(
        Date.now() - finishedResultDisplaySeconds * 1000,
      );
      const recentTerminalSession = await this.findRecentTerminalSession(
        terminalFallbackCutoff,
        isAdmin,
      );
      if (recentTerminalSession) {
        effectiveLiveSession = recentTerminalSession;
        terminalFallbackSlotId = recentTerminalSession.gameSlot.id;
      }
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
          this.buildFastSessionSnapshot(session, 'queue', {
            isAdmin,
            hasActiveBlockingSession,
          }),
          isAdmin,
        ),
      ),
    ].sort((left, right) => this.compareQueueItemsByPriority(left, right));

    const dedupedQueue = this.dedupeOperationQueueItems(queue);
    const effectiveQueue =
      terminalFallbackSlotId == null
        ? dedupedQueue
        : dedupedQueue.filter((item) => item.slotId !== terminalFallbackSlotId);

    // Final race guard: if a request still resolves to all-null with no queue,
    // do one last lightweight re-check before returning true idle.
    if (
      effectiveLiveSession == null &&
      effectiveCheckingSession == null &&
      registrationOpenGame == null &&
      effectiveQueue.length === 0
    ) {
      const [recheckedLive, recheckedChecking, recheckedReady] =
        await Promise.all([
          this.findFirstOperationsSession(
            [GameStatus.PLAYING, GameStatus.WINNER_WINDOW],
            isAdmin,
          ),
          this.findFirstOperationsSession([GameStatus.CHECKING], isAdmin),
          this.findQueueReadySessions([], isAdmin),
        ]);

      if (recheckedLive != null) {
        effectiveLiveSession = recheckedLive;
      } else if (recheckedChecking != null) {
        effectiveCheckingSession = recheckedChecking;
      } else {
        const recoveredRegistration = this.pickRegistrationCandidate(
          recheckedReady,
          [],
          { hasActiveBlockingSession: false },
        );
        if (recoveredRegistration?.kind === 'ready') {
          registrationOpenGame = this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(
              recoveredRegistration.session,
              'registration',
              {
                isAdmin,
                hasActiveBlockingSession: false,
                includePrizePerCartela: true,
              },
            ),
            isAdmin,
          );
        }
      }
    }

    let liveWinnerPayoutsSummary:
      | ReturnType<typeof serializeWinnerPayoutsSummary>
      | undefined;
    let liveWinnerOwnershipByCartelaId:
      | Record<string, string>
      | undefined;
    let liveSessionOutcomeSummary:
      | Awaited<ReturnType<typeof buildSessionOutcomeSummary>>
      | undefined;

    if (
      effectiveLiveSession &&
      (effectiveLiveSession.status === GameStatus.WINNER_WINDOW ||
        effectiveLiveSession.status === GameStatus.FINISHED)
    ) {
      liveSessionOutcomeSummary = await buildSessionOutcomeSummary(
        this.prisma,
        effectiveLiveSession.id,
      );
    }

    if (
      effectiveLiveSession?.status === GameStatus.WINNER_WINDOW &&
      effectiveLiveSession.prizeAmount
    ) {
      const winners = await this.prisma.gameCartela.findMany({
        where: {
          gameSessionId: effectiveLiveSession.id,
          isWinner: true,
          status: GameCartelaStatus.WINNER,
        },
        select: registeredCartelaSummarySelect,
      });
      if (winners.length > 0) {
        liveWinnerOwnershipByCartelaId = Object.fromEntries(
          winners.map((winner) => [winner.cartelaId, winner.userId]),
        );
      }
      liveWinnerPayoutsSummary = serializeWinnerPayoutsSummary(
        winners,
        effectiveLiveSession.prizeAmount,
      );
    }

    const blockingNonBigGameSession =
      effectiveLiveSession &&
      !isBigGameCategory(effectiveLiveSession.gameSlot.category)
        ? effectiveLiveSession
        : effectiveCheckingSession &&
            !isBigGameCategory(effectiveCheckingSession.gameSlot.category)
          ? effectiveCheckingSession
          : null;
    const bigGameLiveElsewhere = this.resolveBigGameLiveElsewhere(
      bigGameSessions,
      blockingNonBigGameSession,
    );
    const bigGameNextRegistration =
      await this.resolveBigGameNextRegistration(bigGameSessions);

    const result: CachedOperationsSnapshot = {
      liveGame: effectiveLiveSession
        ? this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(effectiveLiveSession, 'live', {
              isAdmin,
              winnerPayoutsSummary: liveWinnerPayoutsSummary,
              sessionOutcomeSummary: liveSessionOutcomeSummary,
            }),
            isAdmin,
          )
        : null,
      checkingGame: effectiveCheckingSession
        ? this.sanitizeOperationItem(
            this.buildFastSessionSnapshot(
              effectiveCheckingSession,
              'checking',
              {
                isAdmin,
              },
            ),
            isAdmin,
          )
        : null,
      registrationOpenGame,
      queue: effectiveQueue,
      operationsState: this.resolveOperationsState({
        hasLiveGame: effectiveLiveSession != null,
        hasCheckingGame: effectiveCheckingSession != null,
        hasRegistrationOpenGame: registrationOpenGame != null,
        queueLength: effectiveQueue.length,
      }),
      operationsVersion: ++this.operationsSnapshotVersion,
      timestamp: new Date().toISOString(),
      ...(bigGameLiveElsewhere ? { bigGameLiveElsewhere } : {}),
      ...(bigGameNextRegistration ? { bigGameNextRegistration } : {}),
      ...(isAdmin && liveWinnerOwnershipByCartelaId
        ? { __winnerOwnershipByCartelaId: liveWinnerOwnershipByCartelaId }
        : {}),
    };

    this.lifecycleLogger?.currentOperationsBuilt?.({
      hasLiveGame: !!effectiveLiveSession,
      hasCheckingGame: !!effectiveCheckingSession,
      hasRegistrationOpenGame: !!registrationOpenGame,
      queueLength: effectiveQueue.length,
      liveSessionId: effectiveLiveSession?.id,
      checkingSessionId: effectiveCheckingSession?.id,
      registrationSessionId:
        registrationOpenGame != null && registrationCandidate?.kind === 'ready'
          ? registrationCandidate.session.id
          : undefined,
      registrationSlotId:
        registrationOpenGame != null
          ? registrationCandidate?.slotId
          : undefined,
    });

    return result;
  }

  private async findRecentTerminalSession(
    finishedAfter: Date,
    isAdmin: boolean,
  ) {
    return this.prisma.gameSession.findFirst({
      where: {
        status: {
          in: [GameStatus.FINISHED, GameStatus.NO_WINNER],
        },
        OR: [
          {
            finishedAt: {
              gte: finishedAfter,
            },
          },
          {
            finishedAt: null,
            updatedAt: {
              gte: finishedAfter,
            },
          },
        ],
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
        },
      },
      orderBy: [{ finishedAt: 'desc' }, { updatedAt: 'desc' }],
      select: this.getOperationsSnapshotSelect(isAdmin),
    });
  }

  private async findClaimedOperationalSlotSession(isAdmin: boolean) {
    return this.prisma.gameSession.findFirst({
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
          status: {
            in: [
              GameStatus.PLAYING,
              GameStatus.CHECKING,
              GameStatus.WINNER_WINDOW,
            ],
          },
        },
      },
      orderBy: { gameSlot: { sortOrder: 'asc' } },
      select: this.getOperationsSnapshotSelect(isAdmin),
    });
  }

  private normalizeClaimedOperationalSession<
    T extends {
      status: GameStatus;
      gameSlot: { status: GameStatus };
    },
  >(session: T): T {
    if (session.status !== GameStatus.READY) {
      return session;
    }

    const claimedStatus = session.gameSlot.status;
    if (
      claimedStatus !== GameStatus.PLAYING &&
      claimedStatus !== GameStatus.CHECKING &&
      claimedStatus !== GameStatus.WINNER_WINDOW
    ) {
      return session;
    }

    return {
      ...session,
      status: claimedStatus,
    };
  }

  private shouldCacheOperationsSnapshot(
    snapshot: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): boolean {
    return !(
      snapshot.liveGame == null &&
      snapshot.checkingGame == null &&
      snapshot.registrationOpenGame == null &&
      snapshot.queue.length === 0
    );
  }

  private rememberRecentNonIdleOperationsSnapshot(
    cacheKey: OperationsCacheRoleKey,
    snapshot: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): void {
    if (this.isIdleOperationsSnapshot(snapshot)) {
      this.recentNonIdleOperationsByCacheKey.delete(cacheKey);
      return;
    }

    if (this.isQueueGapOperationsSnapshot(snapshot)) {
      return;
    }

    this.recentNonIdleOperationsByCacheKey.set(cacheKey, {
      capturedAt: Date.now(),
      payload: snapshot,
    });
  }

  private stabilizeTransientIdleOperations(
    cacheKey: OperationsCacheRoleKey,
    snapshot: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>> {
    const isIdleSnapshot = this.isIdleOperationsSnapshot(snapshot);
    const isQueueGapSnapshot = this.isQueueGapOperationsSnapshot(snapshot);
    const now = Date.now();

    if (!isIdleSnapshot && !isQueueGapSnapshot) {
      this.rememberRecentNonIdleOperationsSnapshot(cacheKey, snapshot);
      return snapshot;
    }

    const previous = this.recentNonIdleOperationsByCacheKey.get(cacheKey);
    if (
      previous != null &&
      now - previous.capturedAt <=
        GamesService.OPERATIONS_TRANSIENT_IDLE_GRACE_MS
    ) {
      if (isQueueGapSnapshot) {
        this.logger.warn(
          `[operation_gap_detected] cacheKey=${cacheKey} queueLength=${snapshot.queue.length} preservedPreviousSession=${previous.payload.liveGame?.sessionId ?? previous.payload.checkingGame?.sessionId ?? previous.payload.registrationOpenGame?.sessionId ?? 'none'}`,
        );
      } else {
        this.logger.warn(
          `[game_snapshot_handoff] cacheKey=${cacheKey} preservedPreviousSession=${previous.payload.liveGame?.sessionId ?? previous.payload.checkingGame?.sessionId ?? previous.payload.registrationOpenGame?.sessionId ?? 'none'}`,
        );
      }
      return {
        ...previous.payload,
        operationsState: 'handoff',
        operationsVersion: ++this.operationsSnapshotVersion,
        timestamp: new Date().toISOString(),
      };
    }

    if (isQueueGapSnapshot) {
      this.logger.warn(
        `[operation_gap_detected] cacheKey=${cacheKey} queueLength=${snapshot.queue.length} preservedPreviousSession=none`,
      );
      return snapshot;
    }

    this.recentNonIdleOperationsByCacheKey.delete(cacheKey);
    this.logger.warn(
      `[game_snapshot_null] cacheKey=${cacheKey} operationsState=${snapshot.operationsState} liveGame=null checkingGame=null registrationOpenGame=null queueLength=0`,
    );
    return snapshot;
  }

  private isIdleOperationsSnapshot(
    snapshot: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): boolean {
    return (
      snapshot.operationsState === 'idle' &&
      snapshot.liveGame == null &&
      snapshot.checkingGame == null &&
      snapshot.registrationOpenGame == null &&
      snapshot.queue.length === 0
    );
  }

  private isQueueGapOperationsSnapshot(
    snapshot: Awaited<ReturnType<GamesService['getCurrentOperationsInternal']>>,
  ): boolean {
    return (
      snapshot.liveGame == null &&
      snapshot.checkingGame == null &&
      snapshot.registrationOpenGame == null &&
      snapshot.queue.length > 0
    );
  }

  private resolveOperationsState(input: {
    hasLiveGame: boolean;
    hasCheckingGame: boolean;
    hasRegistrationOpenGame: boolean;
    queueLength: number;
  }): 'active' | 'handoff' | 'idle' {
    if (
      input.hasLiveGame ||
      input.hasCheckingGame ||
      input.hasRegistrationOpenGame
    ) {
      return 'active';
    }

    if (input.queueLength > 0) {
      return 'handoff';
    }

    return 'idle';
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
          // Guard the READY -> PLAYING handoff: once a slot has already been
          // claimed into a live/checking state, do not keep surfacing the old
          // READY session as a registration candidate during the transition.
          status: {
            in: [GameStatus.NEXT, GameStatus.READY],
          },
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
    options?: { hasActiveBlockingSession?: boolean },
  ): {
    kind: 'ready';
    slotId: string;
    session: any;
  } | null {
    // Phase 2: READY = registration open, NEXT = queue only
    // Only READY sessions can be registration candidates
    const hasActiveBlockingSession = options?.hasActiveBlockingSession ?? false;
    const readyCandidates = readySessions
      .filter((session) =>
        this.canRegisterForSession(session, { hasActiveBlockingSession }),
      )
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

    const now = new Date();
    const candidates = [...readyCandidates].sort((left, right) => {
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
      companyFeePerCartela: _companyFeePerCartela,
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
      companyFeePerCartela?: Prisma.Decimal;
      prizeAmount: Prisma.Decimal;
      status: GameStatus;
      registrationOpensAt: Date | null;
      scheduledStartAt: Date | null;
      winnerWindowEndsAt: Date | null;
      noWinnerGraceEndsAt: Date | null;
      noWinnerReason: string | null;
      nextAutoCallAt: Date | null;
      roundIndex?: number | null;
      companyRevenue?: Prisma.Decimal;
      autoCallEnabled?: boolean;
      autoCallIntervalMs?: number | null;
      gameRule?: { id: string; name: string; key: string } | null;
      gameSlot: {
        id: string;
        staticCode: string;
        sortOrder: number | null;
        category: GameCategory | null;
        fixedPrizeAmount?: Prisma.Decimal | null;
        maxCartelasPerPlayer?: number | null;
        roundCount?: number | null;
        roundPrizes?: unknown;
        roundGameRuleIds?: unknown;
        currentRound?: number | null;
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
      gameCartelas?: Array<{
        paymentSource?: CartelaPaymentSource | null;
      }>;
    },
    operationStatus: 'live' | 'checking' | 'registration' | 'queue',
    options: {
      isAdmin: boolean;
      hasActiveBlockingSession?: boolean;
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

    const paymentCounts =
      options.isAdmin &&
      isBigGameCategory(slot.category) &&
      (session.gameCartelas?.length ?? 0) > 0
        ? countRegistrationPaymentSources(session.gameCartelas ?? [])
        : null;

    const roundIndex = session.roundIndex ?? slot.currentRound ?? 1;
    const roundCount = slot.roundCount ?? 1;
    const roundPrizes = Array.isArray(slot.roundPrizes)
      ? slot.roundPrizes.map((value) => String(value))
      : null;
    const roundGameRuleIds = Array.isArray(slot.roundGameRuleIds)
      ? slot.roundGameRuleIds.map((value) => String(value))
      : null;
    const roundPrizeAmount =
      roundPrizes != null &&
      roundIndex >= 1 &&
      roundIndex <= roundPrizes.length
        ? roundPrizes[roundIndex - 1]
        : session.prizeAmount.toString();
    const effectiveGameRule = session.gameRule ?? slot.gameRule;

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
      maxCartelasPerPlayer: exposedMaxCartelasPerPlayer(
        slot.category,
        slot.maxCartelasPerPlayer,
      ),
      roundCount,
      currentRound: slot.currentRound ?? roundIndex,
      roundIndex,
      roundPrizes,
      roundGameRuleIds,
      roundPrizeAmount,
      registrationDurationSeconds: slot.registrationDurationSeconds ?? null,
      autoCallIntervalSeconds: slot.autoCallIntervalSeconds ?? null,
      gameRule: effectiveGameRule
        ? {
            id: effectiveGameRule.id,
            key: effectiveGameRule.key,
            name: effectiveGameRule.name,
          }
        : null,
      entryFee: session.entryFee.toString(),
      ...(options.includePrizePerCartela
        ? { prizePerCartela: session.prizePerCartela.toString() }
        : {}),
      ...(options.isAdmin
        ? {
            companyFeePerCartela: (
              session.companyFeePerCartela ??
              session.entryFee.minus(session.prizePerCartela)
            ).toString(),
          }
        : {}),
      prizeAmount: session.prizeAmount.toString(),
      registeredCartelasCount: session._count.gameCartelas,
      ...(paymentCounts ?? {}),
      calledNumbersCount: session._count.calledNumbers,
      latestCalledNumber: session.calledNumbers?.[0] ?? null,
      registrationOpensAt: session.registrationOpensAt,
      scheduledStartAt: session.scheduledStartAt,
      nextAutoCallAt: session.nextAutoCallAt,
      winnerWindowEndsAt: session.winnerWindowEndsAt,
      noWinnerGraceEndsAt: session.noWinnerGraceEndsAt,
      noWinnerReason: session.noWinnerReason,
      sortOrder: slot.sortOrder,
      canRegister: this.canRegisterForSession(session, {
        hasActiveBlockingSession: options.hasActiveBlockingSession,
      }),
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
      maxCartelasPerPlayer: exposedMaxCartelasPerPlayer(
        slot.category,
        slot.maxCartelasPerPlayer,
      ),
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
      companyFeePerCartela: slot.entryFee.minus(slot.prizePerCartela).toString(),
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
      maxCartelasPerPlayer: exposedMaxCartelasPerPlayer(
        slot.category,
        slot.maxCartelasPerPlayer,
      ),
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
      companyFeePerCartela: slot.entryFee.minus(slot.prizePerCartela).toString(),
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
    const winnerPhoneDisplayMode =
      await this.appDisplayConfigService.getWinnerPhoneDisplayMode();
    const results = await buildSessionWinnerResults(
      this.prisma,
      sessionId,
      this.gameRuleEvaluationService,
      requestingUserId,
      { winnerPhoneDisplayMode },
    );

    if (results.length === 0) {
      const session = await this.prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          roundPausedUntil: true,
          gameSlot: { select: { category: true } },
        },
      });
      if (!session) {
        throw new NotFoundException('Game session not found');
      }
      const isChainRoundPause =
        session.status === GameStatus.PLAYING &&
        session.gameSlot.category === GameCategory.CHAIN_GAME &&
        session.roundPausedUntil != null;
      if (
        session.status !== GameStatus.FINISHED &&
        session.status !== GameStatus.NO_WINNER &&
        session.status !== GameStatus.WINNER_WINDOW &&
        !isChainRoundPause
      ) {
        throw new BadRequestException(
          'Winner results are available only for finished or winner-window sessions',
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
        gameRule: {
          select: {
            name: true,
            key: true,
            patterns: true,
          },
        },
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

    const effectiveRule =
      session.gameRule ?? session.gameSlot.gameRule ?? null;
    const patternName = effectiveRule?.name ?? session.gameSlot.gameType;

    if (session.status === GameStatus.NO_WINNER) {
      return {
        sessionId,
        cartelaNumber: null,
        winningCells: [],
        patternName,
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
        patternName,
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
    const ruleKey = effectiveRule?.key ?? session.gameSlot.gameType;
    const evaluation = this.gameRuleEvaluationService.evaluate(
      winnerCartela.cartela,
      calledNumbers,
      ruleKey,
      effectiveRule?.patterns,
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
      patternName,
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
    options?: { forceBigGameStart?: boolean },
  ) {
    return this.gameEngineService.startGame(
      slotId,
      actorId,
      sessionConfig,
      options,
    );
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

  async getSessionRegisteredPlayers(sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        playCode: true,
        status: true,
        gameSlot: {
          select: {
            staticCode: true,
            name: true,
          },
        },
        gameCartelas: {
          where: {
            status: { not: GameCartelaStatus.CANCELLED },
          },
          select: {
            id: true,
            status: true,
            isWinner: true,
            blockedAt: true,
            userId: true,
            cartelaId: true,
            paymentSource: true,
            user: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
              },
            },
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
            bingoClaims: {
              where: { status: BingoClaimStatus.INVALID },
              select: {
                reason: true,
                checkedAt: true,
                winningBallLetter: true,
                winningBallNumber: true,
              },
              orderBy: { checkedAt: 'desc' },
              take: 1,
            },
          },
          orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    const playersById = new Map<
      string,
      {
        userId: string;
        fullName: string;
        phoneNumber: string;
        cartelas: Array<{
          gameCartelaId: string;
          cartelaId: string;
          cartelaNumber: number;
          status: string;
          isWinner: boolean;
          paymentSource: CartelaPaymentSource | null;
          blockedAt: string | null;
          blockReason: string | null;
          blockCheckedAt: string | null;
          activeNumberWhenBlocked: {
            letter: string;
            number: number;
          } | null;
          cartela: {
            id: string;
            number: number;
            b: unknown;
            i: unknown;
            n: unknown;
            g: unknown;
            o: unknown;
          };
        }>;
      }
    >();

    for (const registration of session.gameCartelas) {
      const existing = playersById.get(registration.userId);
      const blockClaim = registration.bingoClaims[0] ?? null;
      const activeNumberWhenBlocked =
        blockClaim?.winningBallLetter != null &&
        blockClaim?.winningBallNumber != null
          ? {
              letter: blockClaim.winningBallLetter,
              number: blockClaim.winningBallNumber,
            }
          : null;
      const cartelaEntry = {
        gameCartelaId: registration.id,
        cartelaId: registration.cartelaId,
        cartelaNumber: registration.cartela.number,
        status: registration.status,
        isWinner: registration.isWinner,
        paymentSource: registration.paymentSource ?? null,
        blockedAt: registration.blockedAt?.toISOString() ?? null,
        blockReason: blockClaim?.reason ?? null,
        blockCheckedAt: blockClaim?.checkedAt?.toISOString() ?? null,
        activeNumberWhenBlocked,
        cartela: {
          id: registration.cartela.id,
          number: registration.cartela.number,
          b: registration.cartela.b,
          i: registration.cartela.i,
          n: registration.cartela.n,
          g: registration.cartela.g,
          o: registration.cartela.o,
        },
      };

      if (existing) {
        existing.cartelas.push(cartelaEntry);
        continue;
      }

      playersById.set(registration.userId, {
        userId: registration.user.id,
        fullName: registration.user.fullName,
        phoneNumber: registration.user.phoneNumber,
        cartelas: [cartelaEntry],
      });
    }

    const players = Array.from(playersById.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );

    const paymentCounts = countRegistrationPaymentSources(
      session.gameCartelas,
    );

    return {
      sessionId: session.id,
      playCode: session.playCode,
      status: session.status,
      staticCode: session.gameSlot.staticCode,
      gameName: session.gameSlot.name,
      registeredCartelasCount: session.gameCartelas.length,
      ...paymentCounts,
      playersCount: players.length,
      players,
    };
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

  private async parseBigGameRoundConfigOrThrow(
    createGameDto: CreateGameDto,
    fixedPrizeAmount: Prisma.Decimal,
    gameRuleId: string,
  ) {
    return this.parseRoundConfigOrThrow(createGameDto, fixedPrizeAmount, {
      gameRuleId,
      minRoundCount: 1,
      minDelaySeconds: BIG_GAME_MIN_INTER_ROUND_DELAY_SECONDS,
      maxDelaySeconds: BIG_GAME_MAX_INTER_ROUND_DELAY_SECONDS,
      label: 'big games',
    });
  }

  /**
   * CHAIN_GAME rounds run inside ONE session, so a single-round chain is just a Big GOTD.
   * The pause is a live winner reveal rather than a session handoff, hence the much
   * shorter delay bounds than Big Game.
   */
  private async parseChainGameRoundConfigOrThrow(
    createGameDto: CreateGameDto,
    fixedPrizeAmount: Prisma.Decimal,
    gameRuleId: string,
  ) {
    return this.parseRoundConfigOrThrow(createGameDto, fixedPrizeAmount, {
      gameRuleId,
      minRoundCount: 2,
      minDelaySeconds: CHAIN_GAME_MIN_INTER_ROUND_DELAY_SECONDS,
      maxDelaySeconds: CHAIN_GAME_MAX_INTER_ROUND_DELAY_SECONDS,
      label: 'chain games',
    });
  }

  private async parseRoundConfigOrThrow(
    createGameDto: CreateGameDto,
    fixedPrizeAmount: Prisma.Decimal,
    options: {
      gameRuleId: string;
      minRoundCount: number;
      minDelaySeconds: number;
      maxDelaySeconds: number;
      label: string;
    },
  ) {
    const { gameRuleId, minRoundCount, minDelaySeconds, maxDelaySeconds } =
      options;
    const roundCount = createGameDto.roundCount ?? 1;
    if (
      !Number.isInteger(roundCount) ||
      roundCount < minRoundCount ||
      roundCount > 10
    ) {
      throw new BadRequestException(
        `roundCount must be between ${minRoundCount} and 10 for ${options.label}`,
      );
    }

    let roundPrizeStrings = createGameDto.roundPrizes;
    if (!roundPrizeStrings || roundPrizeStrings.length === 0) {
      if (roundCount === 1) {
        roundPrizeStrings = [fixedPrizeAmount.toFixed(2)];
      } else {
        throw new BadRequestException(
          'roundPrizes is required when roundCount is greater than 1',
        );
      }
    }

    if (roundPrizeStrings.length !== roundCount) {
      throw new BadRequestException(
        `roundPrizes length must equal roundCount (${roundCount})`,
      );
    }

    const roundPrizeDecimals = roundPrizeStrings.map((value, index) =>
      this.parsePositiveMoneyOrThrow(value, `roundPrizes[${index}]`),
    );

    const sum = roundPrizeDecimals.reduce(
      (acc, value) => acc.plus(value),
      new Prisma.Decimal(0),
    );
    if (!sum.equals(fixedPrizeAmount)) {
      throw new BadRequestException(
        `roundPrizes must sum to fixedPrizeAmount (${fixedPrizeAmount.toString()})`,
      );
    }

    let roundGameRuleIds = createGameDto.roundGameRuleIds;
    if (!roundGameRuleIds || roundGameRuleIds.length === 0) {
      roundGameRuleIds = [gameRuleId];
      if (roundCount > 1) {
        roundGameRuleIds = Array.from({ length: roundCount }, () => gameRuleId);
      }
    }

    if (roundGameRuleIds.length !== roundCount) {
      throw new BadRequestException(
        `roundGameRuleIds length must equal roundCount (${roundCount})`,
      );
    }

    if (roundGameRuleIds[0] !== gameRuleId) {
      throw new BadRequestException(
        'roundGameRuleIds[0] must equal gameRuleId',
      );
    }

    const uniqueRuleIds = [...new Set(roundGameRuleIds)];
    for (const ruleId of uniqueRuleIds) {
      await this.gameRulesService.getActiveGameRuleOrThrow(ruleId);
    }

    let interRoundDelaySeconds: number | null = null;
    if (roundCount > 1) {
      interRoundDelaySeconds = this.parsePositiveIntOrThrow(
        createGameDto.interRoundDelaySeconds,
        'interRoundDelaySeconds',
        `multi-round ${options.label}`,
      );
      if (
        interRoundDelaySeconds < minDelaySeconds ||
        interRoundDelaySeconds > maxDelaySeconds
      ) {
        throw new BadRequestException(
          `interRoundDelaySeconds must be between ${minDelaySeconds} and ${maxDelaySeconds} for ${options.label}`,
        );
      }
    }

    return {
      roundCount,
      roundPrizes: roundPrizeDecimals.map((value) => value.toFixed(2)),
      roundPrizeDecimals,
      roundGameRuleIds,
      interRoundDelaySeconds,
    };
  }

  private async parseForceBigGameConfigOrThrow(createGameDto: CreateGameDto) {
    await this.bigGameTicketService.requireActiveBigGameForForce();
    const forceBigGameCartelaCount = this.parsePositiveIntOrThrow(
      createGameDto.forceBigGameCartelaCount,
      'forceBigGameCartelaCount',
      'force Big Ticket games',
    );
    if (!isValidForceBigGameCartelaCount(forceBigGameCartelaCount)) {
      throw new BadRequestException(
        'forceBigGameCartelaCount must be 1, or an even integer from 2 to 10',
      );
    }
    return {
      forceBigGameEnabled: true,
      forceBigGameCartelaCount,
    };
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

  private async findActiveBigGameSessions() {
    // Lean select only — used by operations/current polling. Full session
    // payload is loaded separately in getCurrentBigGame.
    return this.prisma.gameSession.findMany({
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
        gameSlot: {
          category: GameCategory.BIG_GAME,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: {
        id: true,
        status: true,
        scheduledStartAt: true,
        roundIndex: true,
        playCode: true,
        gameSlot: {
          select: {
            id: true,
            staticCode: true,
            category: true,
            status: true,
          },
        },
      },
    });
  }

  private async findBlockingNonBigGameSession(isAdmin: boolean) {
    return this.prisma.gameSession.findFirst({
      where: {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
        gameSlot: {
          status: { not: GameStatus.CANCELLED },
          category: { not: GameCategory.BIG_GAME },
        },
      },
      orderBy: { gameSlot: { sortOrder: 'asc' } },
      select: this.getOperationsSnapshotSelect(isAdmin),
    });
  }

  /**
   * Legacy overlap helper. Option A does not open Round N+1 READY while Round N
   * is live, so this normally returns undefined. Kept for recovering older
   * overlapped sessions still in the DB.
   */
  private async resolveBigGameNextRegistration(
    bigGameSessions: Awaited<
      ReturnType<GamesService['findActiveBigGameSessions']>
    >,
  ): Promise<CachedOperationsSnapshot['bigGameNextRegistration'] | undefined> {
    if (bigGameSessions.length === 0) {
      return undefined;
    }

    const sorted = [...bigGameSessions].sort((left, right) =>
      this.compareBigGameSessions(left, right),
    );
    const primary = sorted[0];
    const primaryIsLive =
      primary.status === GameStatus.PLAYING ||
      primary.status === GameStatus.CHECKING ||
      primary.status === GameStatus.WINNER_WINDOW;
    if (!primaryIsLive) {
      return undefined;
    }

    const next = sorted.find(
      (session) =>
        session.status === GameStatus.READY &&
        (session.roundIndex ?? 1) === (primary.roundIndex ?? 1) + 1,
    );
    if (!next) {
      return undefined;
    }

    const detail = await this.prisma.gameSession.findUnique({
      where: { id: next.id },
      select: {
        id: true,
        playCode: true,
        roundIndex: true,
        scheduledStartAt: true,
        registrationOpensAt: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: GameCartelaStatus.CANCELLED } },
            },
          },
        },
        gameSlot: {
          select: {
            id: true,
            staticCode: true,
            roundCount: true,
          },
        },
      },
    });
    if (!detail) {
      return undefined;
    }

    return {
      sessionId: detail.id,
      slotId: detail.gameSlot.id,
      roundIndex: detail.roundIndex ?? (primary.roundIndex ?? 1) + 1,
      roundCount: detail.gameSlot.roundCount,
      scheduledStartAt: detail.scheduledStartAt?.toISOString() ?? null,
      registrationOpensAt: detail.registrationOpensAt?.toISOString() ?? null,
      registeredCartelasCount: detail._count.gameCartelas,
      playCode: detail.playCode,
      staticCode: detail.gameSlot.staticCode,
    };
  }

  private resolveBigGameHeldState(
    bigGameSession: {
      status: GameStatus;
      scheduledStartAt: Date | null;
      gameSlot: { staticCode: string };
      id: string;
      playCode: string;
    },
    blockingSession: Awaited<
      ReturnType<GamesService['findBlockingNonBigGameSession']>
    > | null,
  ) {
    const now = new Date();
    const isReadyPastStart =
      bigGameSession.status === GameStatus.READY &&
      (bigGameSession.scheduledStartAt == null ||
        bigGameSession.scheduledStartAt.getTime() <= now.getTime());

    if (!isReadyPastStart || !blockingSession) {
      return {
        heldWaitingForLiveSlot: false as const,
        blockingLiveGame: undefined,
      };
    }

    return {
      heldWaitingForLiveSlot: true as const,
      blockingLiveGame: this.buildBlockingLiveGameSummary(blockingSession),
    };
  }

  private resolveBigGameLiveElsewhere(
    bigGameSessions: Awaited<
      ReturnType<GamesService['findActiveBigGameSessions']>
    >,
    blockingNonBigGameSession: Awaited<
      ReturnType<GamesService['findFirstOperationsSession']>
    > | null,
  ): { sessionId: string; phase: 'live' | 'held' } | undefined {
    if (bigGameSessions.length === 0) {
      return undefined;
    }

    const session = [...bigGameSessions].sort((left, right) =>
      this.compareBigGameSessions(left, right),
    )[0];

    if (
      session.status === GameStatus.PLAYING ||
      session.status === GameStatus.CHECKING ||
      session.status === GameStatus.WINNER_WINDOW
    ) {
      return { sessionId: session.id, phase: 'live' };
    }

    const now = new Date();
    if (
      session.status === GameStatus.READY &&
      (session.scheduledStartAt == null ||
        session.scheduledStartAt.getTime() <= now.getTime()) &&
      blockingNonBigGameSession
    ) {
      return { sessionId: session.id, phase: 'held' };
    }

    return undefined;
  }

  private buildBlockingLiveGameSummary(session: {
    id: string;
    playCode: string;
    status: GameStatus;
    gameSlot: { status: GameStatus; staticCode: string };
  }) {
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
      sessionId: session.id,
      staticCode: slot.staticCode,
      playCode: session.playCode,
      playerStatus,
    } as const;
  }

  private compareBigGameSessions(
    left: {
      status: GameStatus;
      registrationOpensAt?: Date | null;
      scheduledStartAt: Date | null;
      createdAt?: Date;
      roundIndex?: number | null;
    },
    right: {
      status: GameStatus;
      registrationOpensAt?: Date | null;
      scheduledStartAt: Date | null;
      createdAt?: Date;
      roundIndex?: number | null;
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

    return (
      (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0)
    );
  }

  private canRegisterForSession(
    session: {
      status: GameStatus;
      registrationOpensAt?: Date | null;
      scheduledStartAt?: Date | null;
      gameSlot: {
        operationMode?: GameOperationMode | null;
        category?: GameCategory | null;
      };
    },
    options?: { hasActiveBlockingSession?: boolean },
  ): boolean {
    const hasActiveBlockingSession = options?.hasActiveBlockingSession ?? false;

    if (isBigGameCategory(session.gameSlot.category)) {
      return (
        session.status === GameStatus.READY &&
        canRegisterForBigGameWindow(
          session.registrationOpensAt,
          session.scheduledStartAt,
        )
      );
    }

    if (
      hasActiveBlockingSession &&
      session.status === GameStatus.READY &&
      !isBigGameCategory(session.gameSlot.category)
    ) {
      return true;
    }

    return canRegisterForOperationMode(
      session.gameSlot.operationMode ?? GameOperationMode.MANUAL,
      session.status,
      session.scheduledStartAt,
    );
  }

  private async hasActiveBlockingSession(
    db: Prisma.TransactionClient | Pick<PrismaService, 'gameSession'>,
  ): Promise<boolean> {
    const activeSession = await db.gameSession.findFirst({
      where: {
        status: {
          in: [
            GameStatus.PLAYING,
            GameStatus.CHECKING,
            GameStatus.WINNER_WINDOW,
          ],
        },
      },
      select: { id: true },
    });

    return activeSession != null;
  }

  private async assertSessionRegistrationAllowed(
    session: {
      status: GameStatus;
      registrationOpensAt?: Date | null;
      scheduledStartAt?: Date | null;
      roundIndex?: number | null;
      gameSlot: {
        operationMode?: GameOperationMode | null;
        category?: GameCategory | null;
      };
    },
    options?: {
      now?: Date;
      db?: Prisma.TransactionClient | Pick<PrismaService, 'gameSession'>;
    },
  ): Promise<void> {
    const now = options?.now ?? new Date();
    const db = options?.db ?? this.prisma;

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

    const hasActiveBlockingSession = await this.hasActiveBlockingSession(db);
    if (
      hasActiveBlockingSession &&
      session.status == GameStatus.READY &&
      !isBigGameCategory(session.gameSlot.category)
    ) {
      return;
    }

    assertRegistrationAllowed(
      session.gameSlot.operationMode ?? GameOperationMode.MANUAL,
      session.status,
      session.scheduledStartAt,
    );
  }

  private async getSessionForRegistrationWrite(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    const locked = await lockGameSessionRow(tx, sessionId);
    if (!locked) {
      return null;
    }

    return tx.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        gameSlotId: true,
        playCode: true,
        entryFee: true,
        prizePerCartela: true,
        companyFeePerCartela: true,
        status: true,
        registrationOpensAt: true,
        scheduledStartAt: true,
        roundIndex: true,
        gameSlot: {
          select: {
            id: true,
            operationMode: true,
            category: true,
            maxCartelasPerPlayer: true,
          },
        },
      },
    });
  }

  private async assertCategoryCartelaLimit(
    tx: Prisma.TransactionClient,
    sessionId: string,
    userId: string,
    category?: GameCategory | null,
    maxCartelasPerPlayer?: number | null,
  ) {
    const existingCartelas = await tx.gameCartela.count({
      where: {
        gameSessionId: sessionId,
        userId,
        status: { not: GameCartelaStatus.CANCELLED },
      },
    });

    const remaining = remainingCategoryCartelaSlots({
      category,
      maxCartelasPerPlayer,
      existingCount: existingCartelas,
    });
    if (remaining > 0) {
      return;
    }

    throw new BadRequestException(categoryCartelaLimitError(category));
  }

  private shouldLockCartelasAgainstLiveRound(session: {
    status: GameStatus;
    gameSlot: {
      category?: GameCategory | null;
    };
  }): boolean {
    return (
      session.status !== GameStatus.READY ||
      isBigGameCategory(session.gameSlot.category)
    );
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
    let createdSessionId: string | null = null;
    let createdSlotStatus: GameStatus | null = null;
    let createdSlotCategory: GameCategory | null = null;
    let createdOperationMode: GameOperationMode | null = null;

    const session = await this.prisma.$transaction(async (tx) => {
      const lockedSlot = await lockGameSlotRow(tx, slotId);
      if (!lockedSlot) {
        throw new NotFoundException('Game slot not found');
      }

      const slot = await tx.gameSlot.findUnique({
        where: { id: slotId },
        select: {
          id: true,
          status: true,
          entryFee: true,
          prizePerCartela: true,
          category: true,
          fixedPrizeAmount: true,
          operationMode: true,
          gameRuleId: true,
          roundPrizes: true,
          roundGameRuleIds: true,
        },
      });

      if (!slot) {
        throw new NotFoundException('Game slot not found');
      }

      if (
        slot.status !== GameStatus.NEXT &&
        slot.status !== GameStatus.READY &&
        slot.status !== GameStatus.PLAYING
      ) {
        throw new BadRequestException(
          'Cartela registration is only allowed for NEXT, READY, or PLAYING slots',
        );
      }

      let session = await tx.gameSession.findFirst({
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
          throw new BadRequestException({
            message: 'No active session found for this slot',
            code: 'SESSION_NOT_READY',
          });
        }

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

        session = await tx.gameSession.create({
          data: {
            gameSlotId: slotId,
            playCode,
            entryFee: sessionMoneyConfig.entryFee,
            prizePerCartela: sessionMoneyConfig.prizePerCartela,
            companyFeePerCartela: sessionMoneyConfig.companyFeePerCartela,
            prizeAmount: sessionMoneyConfig.prizeAmount,
            companyRevenue: sessionMoneyConfig.companyRevenue,
            status: GameStatus.READY,
            ...buildChainRoundSeedData(slot),
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

        createdSessionId = session.id;
        createdSlotStatus = slot.status;
        createdSlotCategory = slot.category;
        createdOperationMode = slot.operationMode;
      }

      if (!session) {
        throw new BadRequestException({
          message: 'No active session found for this slot',
          code: 'SESSION_NOT_READY',
        });
      }

      await this.assertSessionRegistrationAllowed(
        {
          ...session,
          gameSlot: {
            operationMode: slot.operationMode,
            category: slot.category,
          },
        },
        { db: tx },
      );

      return session;
    });

    if (
      createdSessionId &&
      createdSlotCategory != null &&
      createdOperationMode != null
    ) {
      this.lifecycleLogger?.sessionCreated?.({
        sessionId: createdSessionId,
        slotId,
        slotStatus: createdSlotStatus ?? GameStatus.NEXT,
        sessionStatus: GameStatus.READY,
        category: createdSlotCategory,
        operationMode: createdOperationMode,
        reason: 'first_registration',
      });

      this.lifecycleLogger?.registrationOpened?.({
        sessionId: createdSessionId,
        slotId,
        category: createdSlotCategory,
        operationMode: createdOperationMode,
        reason: 'first_player_registration',
      });

      await this.emitSessionCreatedForSlot(slotId, createdSessionId);
    }

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

  private assertBulkCartelasWithinLimit(cartelaCount: number) {
    if (cartelaCount > MAX_BULK_CARTELAS_PER_REQUEST) {
      throw new BadRequestException({
        message: `Bulk registration supports at most ${MAX_BULK_CARTELAS_PER_REQUEST} cartelas per request`,
        code: 'BULK_CARTELAS_LIMIT_EXCEEDED',
      });
    }
  }

  private extractRegistrationClosedReason(error: unknown): string | null {
    if (!(error instanceof BadRequestException)) {
      return null;
    }

    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response
    ) {
      const code = response.code;
      if (
        code === 'REGISTRATION_CLOSED' ||
        code === 'BIG_GAME_REGISTRATION_CLOSED'
      ) {
        return this.extractExceptionMessage(error);
      }
    }

    return null;
  }

  private resolveRegistrationPaymentPlanFromBonusBalance(
    session: {
      entryFee: Prisma.Decimal;
      prizePerCartela: Prisma.Decimal;
      companyFeePerCartela: Prisma.Decimal;
      gameSlot: {
        category: GameCategory;
      };
    },
    bonusCartelaBalance: number,
    preferredPaymentSource?: CartelaPaymentSource | null,
  ) {
    if (isFreeEntryCategory(session.gameSlot.category)) {
      return resolveRegistrationAccounting(session, 0, preferredPaymentSource);
    }

    return resolveRegistrationAccounting(
      session,
      bonusCartelaBalance,
      preferredPaymentSource,
    );
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
    const normalized = message.toLowerCase();
    return (
      normalized.includes('insufficient wallet balance') ||
      normalized.includes('insufficient bonus cartela balance')
    );
  }

  private async resolveRegistrationPaymentPlan(
    tx: Prisma.TransactionClient,
    userId: string,
    session: {
      entryFee: Prisma.Decimal;
      prizePerCartela: Prisma.Decimal;
      companyFeePerCartela: Prisma.Decimal;
      gameSlotId?: string;
      gameSlot: {
        category: GameCategory;
        id?: string;
      };
    },
    preferredPaymentSource?: CartelaPaymentSource | null,
  ) {
    if (isFreeEntryCategory(session.gameSlot.category)) {
      return resolveRegistrationAccounting(session, 0, preferredPaymentSource);
    }

    if (
      preferredPaymentSource === CartelaPaymentSource.BIG_GAME_TICKET &&
      isBigGameCategory(session.gameSlot.category)
    ) {
      const slotId = session.gameSlotId ?? session.gameSlot.id;
      if (!slotId) {
        throw new BadRequestException({
          code: 'BIG_GAME_TICKET_SLOT_MISSING',
          message: 'Big Game slot missing for ticket payment',
        });
      }
      await this.bigGameTicketService.getBalanceOrThrow(userId, slotId, tx);
      return resolveRegistrationAccounting(
        session,
        0,
        CartelaPaymentSource.BIG_GAME_TICKET,
      );
    }

    const wallet = await this.walletService.getWalletOrThrow(tx, userId);
    return resolveRegistrationAccounting(
      session,
      wallet.bonusCartelaBalance,
      preferredPaymentSource,
    );
  }

  private async applyRegistrationPayment(
    tx: Prisma.TransactionClient,
    userId: string,
    session: {
      playCode: string;
      entryFee: Prisma.Decimal;
      gameSlotId?: string;
      gameSlot?: {
        id?: string;
        category?: GameCategory;
      };
    },
    gameCartelaId: string,
    accounting: RegistrationAccounting,
  ) {
    if (!accounting.paymentSource) {
      return undefined;
    }

    if (accounting.paymentSource === CartelaPaymentSource.BONUS_CARTELA) {
      await this.walletService.consumeBonusCartela(tx, userId);
      return undefined;
    }

    if (accounting.paymentSource === CartelaPaymentSource.BIG_GAME_TICKET) {
      const slotId = session.gameSlotId ?? session.gameSlot?.id;
      if (!slotId) {
        throw new BadRequestException({
          code: 'BIG_GAME_TICKET_SLOT_MISSING',
          message: 'Big Game slot missing for ticket payment',
        });
      }
      await this.bigGameTicketService.spendTicket(tx, {
        userId,
        gameSlotId: slotId,
        referenceType: 'GAME_CARTELA',
        referenceId: gameCartelaId,
        description: `Big Ticket entry for ${session.playCode}`,
      });
      return undefined;
    }

    if (accounting.paymentSource === CartelaPaymentSource.CARRIED_FORWARD) {
      return undefined;
    }

    return this.walletService.debitWallet(tx, userId, session.entryFee, {
      type: WalletTransactionType.GAME_ENTRY,
      referenceType: 'GAME_CARTELA',
      referenceId: gameCartelaId,
      description: `Game entry fee for ${session.playCode}`,
    });
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
        paymentSource: gameCartela.paymentSource ?? null,
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
    void this.invalidateRegistrationStateAfterCommittedMutation(
      sessionId,
      updatedSession.status,
    );
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

    void this.emitWalletUpdated(userId);
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
          paymentSource:
            'paymentSource' in gameCartela
              ? ((gameCartela as { paymentSource?: CartelaPaymentSource | null })
                  .paymentSource ?? null)
              : null,
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
    void this.invalidateRegistrationStateAfterCommittedMutation(
      sessionId,
      updatedSession.status,
    );
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

    void this.emitWalletUpdated(userId);
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
