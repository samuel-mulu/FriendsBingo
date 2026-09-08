import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CartelaPaymentSource,
  CompanyFeeSource,
  GameCartelaStatus,
  GameCategory,
  GameOperationMode,
  GameStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BigGameTicketService } from './big-game-ticket.service';
import { buildSessionMoneyConfig } from './game-category.util';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { gameSessionSelect } from './games.select';
import {
  serializeGameSession,
  toPlayerGameSession,
} from './games.mapper';

const CLONE_CHUNK_SIZE = 500;

function parseRoundPrizes(roundPrizes: unknown): Prisma.Decimal[] {
  if (!Array.isArray(roundPrizes) || roundPrizes.length === 0) {
    return [];
  }
  return roundPrizes.map((value) => new Prisma.Decimal(String(value)));
}

@Injectable()
export class BigGameRoundService {
  private readonly logger = new Logger(BigGameRoundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bigGameTicketService: BigGameTicketService,
    private readonly realtimeService: RealtimeService,
    private readonly lifecycleLogger: GameLifecycleDebugLogger,
  ) {}

  /**
   * Cancel or last-round finish: expire remaining Big Tickets and clear
   * inter-round markers so GET /games/big-game/current returns null once the
   * slot is CANCELLED (or has no active/open-next sessions).
   */
  async tearDownEventArtifacts(
    tx: Prisma.TransactionClient,
    gameSlotId: string,
  ): Promise<void> {
    await this.bigGameTicketService.expireAllForSlot(gameSlotId, tx);
    await tx.gameSession.updateMany({
      where: {
        gameSlotId,
        nextRoundStartsAt: { not: null },
      },
      data: { nextRoundStartsAt: null },
    });
  }

  /**
   * While a Big Game round is LIVE: open the next READY session so missed
   * players can register (queue-like). Does not arm scheduledStartAt yet —
   * finalize sets the inter-round delay. Does not flip the slot to READY.
   */
  async ensureNextRoundReadyWhileLive(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      gameSlotId: string;
    },
  ): Promise<{
    nextSessionId: string | null;
    nextRoundIndex: number | null;
    clonedCount: number;
  }> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: params.gameSlotId },
      select: {
        id: true,
        name: true,
        category: true,
        roundCount: true,
        roundPrizes: true,
        entryFee: true,
        prizePerCartela: true,
        fixedPrizeAmount: true,
        operationMode: true,
      },
    });

    if (!slot || slot.category !== GameCategory.BIG_GAME) {
      return { nextSessionId: null, nextRoundIndex: null, clonedCount: 0 };
    }

    const liveSession = await tx.gameSession.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        roundIndex: true,
        registrationOpensAt: true,
        status: true,
      },
    });

    if (!liveSession) {
      return { nextSessionId: null, nextRoundIndex: null, clonedCount: 0 };
    }

    const liveRound = liveSession.roundIndex ?? 1;
    const roundCount = slot.roundCount ?? 1;
    if (liveRound >= roundCount) {
      return { nextSessionId: null, nextRoundIndex: null, clonedCount: 0 };
    }

    const nextRoundIndex = liveRound + 1;
    const opened = await this.createNextRoundReadySession(tx, {
      slot,
      previousSessionId: liveSession.id,
      previousRegistrationOpensAt: liveSession.registrationOpensAt,
      previousRoundIndex: liveRound,
      nextRoundIndex,
      scheduledStartAt: null,
      registrationOpensAt: new Date(),
      keepSlotLive: true,
      cloneStatuses: [GameCartelaStatus.REGISTERED],
    });

    this.logger.log(
      `Opened Big Game round ${opened.roundIndex} READY while round ${liveRound} live (slot=${params.gameSlotId}, session=${opened.sessionId}, carried=${opened.clonedCount})`,
    );

    return {
      nextSessionId: opened.sessionId,
      nextRoundIndex: opened.roundIndex,
      clonedCount: opened.clonedCount,
    };
  }

  /**
   * After a Big Game round finishes: arm the already-open next READY session
   * (or create it as recovery), sync carried cartelas, set inter-round delay.
   * Last round tears down tickets/slot artifacts.
   */
  async afterBigGameRoundFinalized(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: string;
      gameSlotId: string;
    },
  ): Promise<{
    shouldRemoveSlot: boolean;
    nextRoundStartsAt: Date | null;
    nextRoundIndex: number | null;
    nextSessionId: string | null;
  }> {
    const slot = await tx.gameSlot.findUnique({
      where: { id: params.gameSlotId },
      select: {
        id: true,
        name: true,
        category: true,
        roundCount: true,
        currentRound: true,
        interRoundDelaySeconds: true,
        roundPrizes: true,
        entryFee: true,
        prizePerCartela: true,
        fixedPrizeAmount: true,
        operationMode: true,
      },
    });

    if (!slot || slot.category !== GameCategory.BIG_GAME) {
      return {
        shouldRemoveSlot: true,
        nextRoundStartsAt: null,
        nextRoundIndex: null,
        nextSessionId: null,
      };
    }

    const session = await tx.gameSession.findUnique({
      where: { id: params.sessionId },
      select: {
        roundIndex: true,
        registrationOpensAt: true,
      },
    });

    const finishedRound = session?.roundIndex ?? slot.currentRound ?? 1;
    const roundCount = slot.roundCount ?? 1;

    if (finishedRound < roundCount) {
      const delaySeconds = slot.interRoundDelaySeconds ?? 300;
      const nextRoundStartsAt = new Date(Date.now() + delaySeconds * 1000);
      const nextRoundIndex = finishedRound + 1;

      const opened = await this.createNextRoundReadySession(tx, {
        slot,
        previousSessionId: params.sessionId,
        previousRegistrationOpensAt: session?.registrationOpensAt ?? null,
        previousRoundIndex: finishedRound,
        nextRoundIndex,
        scheduledStartAt: nextRoundStartsAt,
        registrationOpensAt: new Date(),
        keepSlotLive: false,
        cloneStatuses: [
          GameCartelaStatus.REGISTERED,
          GameCartelaStatus.WINNER,
        ],
      });

      // Arm play start on the next READY (created at live start or recovery).
      await tx.gameSession.update({
        where: { id: opened.sessionId },
        data: {
          scheduledStartAt: nextRoundStartsAt,
        },
      });

      await this.syncCarriedCartelas(tx, {
        previousSessionId: params.sessionId,
        nextSessionId: opened.sessionId,
        statuses: [GameCartelaStatus.REGISTERED, GameCartelaStatus.WINNER],
      });

      await tx.gameSlot.update({
        where: { id: slot.id },
        data: {
          currentRound: nextRoundIndex,
          status: GameStatus.READY,
        },
      });

      // Keep on finished session for admin/report clients that still read it.
      await tx.gameSession.update({
        where: { id: params.sessionId },
        data: { nextRoundStartsAt },
      });

      return {
        shouldRemoveSlot: false,
        nextRoundStartsAt,
        nextRoundIndex,
        nextSessionId: opened.sessionId,
      };
    }

    await this.tearDownEventArtifacts(tx, slot.id);

    return {
      shouldRemoveSlot: true,
      nextRoundStartsAt: null,
      nextRoundIndex: null,
      nextSessionId: null,
    };
  }

  /**
   * Legacy scheduler hook: next round opens at live start and is armed at
   * finalize. Returns empty so auto-start uses due READY sessions.
   */
  async findDueNextRoundSlotIds(_now: Date = new Date()): Promise<string[]> {
    return [];
  }

  /**
   * Admin: force the open READY next-round session to start ASAP
   * (sets scheduledStartAt = now). Does not create a second session.
   */
  async startNextRoundNow(slotId: string, actorId?: string) {
    const readySession = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: GameStatus.READY,
        roundIndex: { gt: 1 },
        gameSlot: {
          category: GameCategory.BIG_GAME,
          status: { not: GameStatus.CANCELLED },
        },
      },
      orderBy: { roundIndex: 'desc' },
      select: {
        id: true,
        roundIndex: true,
        scheduledStartAt: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: GameCartelaStatus.CANCELLED } },
            },
          },
        },
      },
    });

    if (!readySession) {
      throw new BadRequestException({
        code: 'BIG_GAME_NO_PENDING_ROUND',
        message: 'No open next Big Game round registration to start',
      });
    }

    const now = new Date();
    await this.prisma.gameSession.update({
      where: { id: readySession.id },
      data: { scheduledStartAt: now },
    });

    await this.prisma.gameSession.updateMany({
      where: {
        gameSlotId: slotId,
        status: GameStatus.FINISHED,
        nextRoundStartsAt: { not: null },
      },
      data: { nextRoundStartsAt: now },
    });

    await this.emitSessionUpdated(slotId, readySession.id);

    this.logger.log(
      `Forced Big Game round ${readySession.roundIndex} start window for slot ${slotId} (actor=${actorId ?? 'system'})`,
    );

    return {
      sessionId: readySession.id,
      roundIndex: readySession.roundIndex,
      clonedCount: readySession._count.gameCartelas,
      actorId: actorId ?? null,
    };
  }

  /**
   * Idempotent: if READY next round already exists, force its start window.
   * Otherwise create+clone (recovery path for pre-migration / failed finalize).
   */
  async startNextBigGameRound(
    slotId: string,
    options?: { actorId?: string },
  ) {
    const existingReady = await this.prisma.gameSession.findFirst({
      where: {
        gameSlotId: slotId,
        status: GameStatus.READY,
        roundIndex: { gt: 1 },
        gameSlot: {
          category: GameCategory.BIG_GAME,
          status: { not: GameStatus.CANCELLED },
        },
      },
      select: { id: true },
    });

    if (existingReady) {
      return this.startNextRoundNow(slotId, options?.actorId);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const slot = await tx.gameSlot.findUnique({
        where: { id: slotId },
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          roundCount: true,
          currentRound: true,
          roundPrizes: true,
          entryFee: true,
          prizePerCartela: true,
          fixedPrizeAmount: true,
          operationMode: true,
        },
      });

      if (!slot || slot.category !== GameCategory.BIG_GAME) {
        throw new NotFoundException('Big Game slot not found');
      }

      if (slot.status === GameStatus.CANCELLED) {
        throw new BadRequestException('Big Game is cancelled');
      }

      const activeSession = await tx.gameSession.findFirst({
        where: {
          gameSlotId: slotId,
          status: {
            in: [
              GameStatus.READY,
              GameStatus.PLAYING,
              GameStatus.CHECKING,
              GameStatus.WINNER_WINDOW,
            ],
          },
        },
        select: { id: true },
      });

      if (activeSession) {
        throw new BadRequestException({
          code: 'BIG_GAME_ROUND_ALREADY_ACTIVE',
          message: 'A Big Game round is already active',
        });
      }

      const previousSession = await tx.gameSession.findFirst({
        where: {
          gameSlotId: slotId,
          status: GameStatus.FINISHED,
        },
        orderBy: { roundIndex: 'desc' },
        select: {
          id: true,
          roundIndex: true,
          registrationOpensAt: true,
        },
      });

      if (!previousSession) {
        throw new BadRequestException({
          code: 'BIG_GAME_NO_PREVIOUS_ROUND',
          message: 'No finished round to carry cartelas from',
        });
      }

      const nextRoundIndex = previousSession.roundIndex + 1;
      if (nextRoundIndex > slot.roundCount) {
        throw new BadRequestException({
          code: 'BIG_GAME_ROUNDS_COMPLETE',
          message: 'All Big Game rounds are complete',
        });
      }

      const now = new Date();
      const opened = await this.createNextRoundReadySession(tx, {
        slot,
        previousSessionId: previousSession.id,
        previousRegistrationOpensAt: previousSession.registrationOpensAt,
        previousRoundIndex: previousSession.roundIndex,
        nextRoundIndex,
        scheduledStartAt: now,
        registrationOpensAt: now,
      });

      await tx.gameSession.update({
        where: { id: previousSession.id },
        data: { nextRoundStartsAt: null },
      });

      return opened;
    });

    await this.emitSessionUpdated(slotId, result.sessionId, result.clonedCount);

    this.logger.log(
      `Recovered Big Game round ${result.roundIndex} for slot ${slotId} with ${result.clonedCount} carried cartelas`,
    );

    return {
      sessionId: result.sessionId,
      roundIndex: result.roundIndex,
      clonedCount: result.clonedCount,
      actorId: options?.actorId ?? null,
    };
  }

  private async createNextRoundReadySession(
    tx: Prisma.TransactionClient,
    params: {
      slot: {
        id: string;
        name: string | null;
        roundCount: number | null;
        roundPrizes: unknown;
        entryFee: Prisma.Decimal;
        prizePerCartela: Prisma.Decimal;
        fixedPrizeAmount: Prisma.Decimal | null;
        operationMode: GameOperationMode;
      };
      previousSessionId: string;
      previousRegistrationOpensAt: Date | null;
      previousRoundIndex: number;
      nextRoundIndex: number;
      scheduledStartAt: Date | null;
      registrationOpensAt: Date;
      /** When true, do not flip slot to READY / bump currentRound (live overlap). */
      keepSlotLive?: boolean;
      cloneStatuses?: GameCartelaStatus[];
    },
  ): Promise<{
    sessionId: string;
    roundIndex: number;
    clonedCount: number;
  }> {
    const existing = await tx.gameSession.findFirst({
      where: {
        gameSlotId: params.slot.id,
        status: GameStatus.READY,
        roundIndex: params.nextRoundIndex,
      },
      select: {
        id: true,
        _count: {
          select: {
            gameCartelas: {
              where: { status: { not: GameCartelaStatus.CANCELLED } },
            },
          },
        },
      },
    });

    if (existing) {
      await this.syncCarriedCartelas(tx, {
        previousSessionId: params.previousSessionId,
        nextSessionId: existing.id,
        statuses:
          params.cloneStatuses ?? [
            GameCartelaStatus.REGISTERED,
            GameCartelaStatus.WINNER,
          ],
      });
      return {
        sessionId: existing.id,
        roundIndex: params.nextRoundIndex,
        clonedCount: existing._count.gameCartelas,
      };
    }

    const roundPrizes = parseRoundPrizes(params.slot.roundPrizes);
    const prizeOverride =
      roundPrizes[params.nextRoundIndex - 1] ??
      new Prisma.Decimal(params.slot.fixedPrizeAmount?.toString() ?? '0');

    const money = buildSessionMoneyConfig(params.slot, {
      prizeAmountOverride: prizeOverride,
    });

    const createdSession = await tx.gameSession.create({
      data: {
        gameSlotId: params.slot.id,
        playCode: this.generatePlayCode(),
        entryFee: money.entryFee,
        prizePerCartela: money.prizePerCartela,
        companyFeePerCartela: money.companyFeePerCartela,
        prizeAmount: money.prizeAmount,
        companyRevenue: money.companyRevenue,
        status: GameStatus.READY,
        registrationOpensAt: params.registrationOpensAt,
        scheduledStartAt: params.scheduledStartAt,
        roundIndex: params.nextRoundIndex,
      },
      select: { id: true },
    });

    if (!params.keepSlotLive) {
      await tx.gameSlot.update({
        where: { id: params.slot.id },
        data: {
          currentRound: params.nextRoundIndex,
          status: GameStatus.READY,
        },
      });
    }

    const cloneStatuses =
      params.cloneStatuses ?? [
        GameCartelaStatus.REGISTERED,
        GameCartelaStatus.WINNER,
      ];
    const clonedCount = await this.syncCarriedCartelas(tx, {
      previousSessionId: params.previousSessionId,
      nextSessionId: createdSession.id,
      statuses: cloneStatuses,
    });

    this.lifecycleLogger?.sessionCreated?.({
      sessionId: createdSession.id,
      slotId: params.slot.id,
      slotStatus: params.keepSlotLive ? GameStatus.PLAYING : GameStatus.READY,
      sessionStatus: GameStatus.READY,
      category: GameCategory.BIG_GAME,
      operationMode: params.slot.operationMode,
      reason: 'big_game_next_round',
      scheduledStartAt: params.scheduledStartAt,
    });

    return {
      sessionId: createdSession.id,
      roundIndex: params.nextRoundIndex,
      clonedCount,
    };
  }

  private async syncCarriedCartelas(
    tx: Prisma.TransactionClient,
    params: {
      previousSessionId: string;
      nextSessionId: string;
      statuses: GameCartelaStatus[];
    },
  ): Promise<number> {
    const sourceCartelas = await tx.gameCartela.findMany({
      where: {
        gameSessionId: params.previousSessionId,
        status: { in: params.statuses },
      },
      select: {
        userId: true,
        cartelaId: true,
        entryFeeCents: true,
        companyFeeCents: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (let i = 0; i < sourceCartelas.length; i += CLONE_CHUNK_SIZE) {
      const chunk = sourceCartelas.slice(i, i + CLONE_CHUNK_SIZE);
      await tx.gameCartela.createMany({
        data: chunk.map((row) => ({
          id: randomUUID(),
          gameSessionId: params.nextSessionId,
          userId: row.userId,
          cartelaId: row.cartelaId,
          status: GameCartelaStatus.REGISTERED,
          paymentSource: CartelaPaymentSource.CARRIED_FORWARD,
          entryFeeCents: row.entryFeeCents,
          prizeContributionCents: 0,
          companyFeeCents: row.companyFeeCents,
          companyFeeSource: CompanyFeeSource.MONEY,
        })),
        skipDuplicates: true,
      });
    }

    return sourceCartelas.length;
  }

  async emitOpenedNextRoundSession(slotId: string, sessionId: string) {
    await this.emitSessionUpdated(slotId, sessionId);
  }

  private async emitSessionUpdated(
    slotId: string,
    sessionId: string,
    registeredCartelasCount?: number,
  ) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (!session) {
      return;
    }

    const payload = serializeGameSession(session);
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
    this.realtimeService.emitSessionCartelasUpdated({
      sessionId: session.id,
      slotId,
      prizeAmount: session.prizeAmount.toString(),
      registeredCartelasCount:
        registeredCartelasCount ?? session._count.gameCartelas,
      changes: [],
    });
  }

  private generatePlayCode() {
    return `BG${Date.now().toString(36).toUpperCase()}${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, '0')}`;
  }
}
