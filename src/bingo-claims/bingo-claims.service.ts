import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BingoClaimStatus,
  GameCartelaStatus,
  GameStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AuditLogService } from '../common/services/audit-log.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { GameEngineService } from '../game-engine/game-engine.service';
import {
  serializeGameSession,
  serializeGameSlot,
  toPlayerGameSession,
  toPlayerGameSlot,
} from '../games/games.mapper';
import { gameSessionSelect, gameSlotSelect } from '../games/games.select';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { RejectBingoClaimDto } from './dto/reject-bingo-claim.dto';
import { serializeBingoClaim } from './bingo-claims.mapper';
import { bingoClaimSelect } from './bingo-claims.select';

@Injectable()
export class BingoClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngineService: GameEngineService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
    private readonly walletService: WalletService,
  ) {}

  async claimBingo(sessionId: string, userId: string, gameCartelaId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const gameCartela = await tx.gameCartela.findFirst({
        where: {
          id: gameCartelaId,
          gameSessionId: sessionId,
          userId,
        },
        select: {
          id: true,
          gameSessionId: true,
          userId: true,
          status: true,
          isWinner: true,
          cartela: {
            select: {
              id: true,
              number: true,
            },
          },
          gameSession: {
            select: {
              id: true,
              playCode: true,
              status: true,
              gameSlot: {
                select: {
                  gameType: true,
                  gameRule: {
                    select: {
                      id: true,
                      key: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!gameCartela) {
        throw new NotFoundException('Game cartela not found');
      }

      if (gameCartela.status === GameCartelaStatus.BLOCKED) {
        throw new BadRequestException(
          'Blocked cartelas cannot claim bingo again',
        );
      }

      if (
        gameCartela.status === GameCartelaStatus.WINNER ||
        gameCartela.isWinner
      ) {
        throw new BadRequestException('This cartela is already the winner');
      }

      if (gameCartela.status !== GameCartelaStatus.REGISTERED) {
        throw new BadRequestException('This cartela cannot make a bingo claim');
      }

      if (gameCartela.gameSession.status === GameStatus.FINISHED) {
        throw new BadRequestException('Game already finished');
      }

      if (gameCartela.gameSession.status !== GameStatus.PLAYING) {
        throw new BadRequestException('Game must be PLAYING to claim bingo');
      }

      const existingPendingClaim = await tx.bingoClaim.findFirst({
        where: {
          gameSessionId: sessionId,
          gameCartelaId,
          status: BingoClaimStatus.PENDING,
        },
        select: { id: true },
      });

      if (existingPendingClaim) {
        throw new BadRequestException(
          'A bingo claim for this cartela is already pending review',
        );
      }

      const claim = await tx.bingoClaim.create({
        data: {
          gameSessionId: sessionId,
          userId,
          gameCartelaId: gameCartela.id,
          status: BingoClaimStatus.PENDING,
          checkedPattern:
            gameCartela.gameSession.gameSlot.gameRule?.key ??
            gameCartela.gameSession.gameSlot.gameType,
          reason: 'Waiting for admin confirmation',
        },
        select: bingoClaimSelect,
      });

      // Update session status to CHECKING when bingo is claimed
      await tx.gameSession.update({
        where: { id: sessionId },
        data: { status: GameStatus.CHECKING },
      });

      await this.auditLogService.create(tx, {
        actorId: userId,
        action: 'player.bingo.pending',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          sessionId,
          gameCartelaId,
          gameRuleKey:
            gameCartela.gameSession.gameSlot.gameRule?.key ??
            gameCartela.gameSession.gameSlot.gameType,
        },
      });

      return {
        claim: serializeBingoClaim(claim),
        progress: null,
        isWinner: false,
        gameStatus: GameStatus.CHECKING,
        gameCartelaStatus: GameCartelaStatus.REGISTERED,
      };
    });

    this.realtimeService.emitToGame(sessionId, 'game:bingo_claimed', {
      sessionId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });
    this.realtimeService.emitToAdmin('game:bingo_claimed', {
      sessionId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });
    this.realtimeService.emitToUser(userId, 'game:bingo_claimed', {
      sessionId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });

    // Emit session status changed to CHECKING when bingo is claimed
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: gameSessionSelect,
    });

    if (updatedSession) {
      const sessionPayload = serializeGameSession(updatedSession);
      const playerPayload = toPlayerGameSession(sessionPayload);
      this.realtimeService.emitToGame(
        sessionId,
        'game:status_changed',
        playerPayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        playerPayload,
      );
    }

    return result;
  }

  async getAdminBingoClaims(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const [totalItems, claims] = await Promise.all([
      this.prisma.bingoClaim.count(),
      this.prisma.bingoClaim.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: bingoClaimSelect,
      }),
    ]);

    return {
      items: claims.map(serializeBingoClaim),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async approveClaim(claimId: string, actorId: string) {
    const checkedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.bingoClaim.findUnique({
        where: { id: claimId },
        select: bingoClaimSelect,
      });

      if (!claim) {
        throw new NotFoundException('Bingo claim not found');
      }

      if (claim.status !== BingoClaimStatus.PENDING) {
        throw new BadRequestException('Only pending claims can be approved');
      }

      if (claim.gameSession.status === GameStatus.FINISHED) {
        throw new BadRequestException('Game already finished');
      }

      const cartelaUpdateResult = await tx.gameCartela.updateMany({
        where: {
          id: claim.gameCartela.id,
          status: GameCartelaStatus.REGISTERED,
          isWinner: false,
        },
        data: {
          status: GameCartelaStatus.WINNER,
          isWinner: true,
          blockedAt: null,
        },
      });

      if (cartelaUpdateResult.count !== 1) {
        throw new ConflictException('Cartela could not be finalized as winner');
      }

      const sessionFinished = await this.gameEngineService.finishGameWithWinner(
        tx,
        claim.gameSession.id,
        claim.gameCartela.id,
        checkedAt,
      );

      if (!sessionFinished) {
        throw new ConflictException('Game already finished');
      }

      await this.walletService.creditWallet(
        tx,
        claim.userId,
        claim.gameSession.prizeAmount,
        {
          type: WalletTransactionType.PRIZE_WIN,
          referenceType: 'SESSION',
          referenceId: claim.gameSession.id,
          description: `Prize win for session ${claim.gameSession.playCode}`,
        },
      );

      const updatedClaim = await tx.bingoClaim.update({
        where: { id: claim.id },
        data: {
          status: BingoClaimStatus.VALID,
          reason: null,
          checkedAt,
        },
        select: bingoClaimSelect,
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.bingo_claim.approve',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          sessionId: claim.gameSessionId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        sessionId: claim.gameSession.id,
        userId: claim.userId,
        gameCartelaId: claim.gameCartela.id,
      };
    });

    const validPayload = {
      sessionId: result.sessionId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      progress: null,
    };

    this.realtimeService.emitToGame(
      result.sessionId,
      'game:bingo_valid',
      validPayload,
    );
    this.realtimeService.emitToAdmin('game:bingo_valid', validPayload);
    this.realtimeService.emitToUser(
      result.userId,
      'game:bingo_valid',
      validPayload,
    );

    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: result.sessionId },
      select: gameSessionSelect,
    });

    if (updatedSession) {
      const sessionPayload = serializeGameSession(updatedSession);
      const playerPayload = toPlayerGameSession(sessionPayload);

      this.realtimeService.emitToGame(
        result.sessionId,
        'game:status_changed',
        playerPayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        playerPayload,
      );

      // Re-fetch the slot with relations for normalized payload
      const updatedSlot = await this.prisma.gameSlot.findUnique({
        where: { id: updatedSession.gameSlotId },
        include: {
          gameRule: true,
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            include: {
              _count: {
                select: { gameCartelas: true, calledNumbers: true },
              },
            },
          },
        },
      });

      if (updatedSlot) {
        const adminSlotPayload = serializeGameSlot(updatedSlot);
        const publicSlotPayload = toPlayerGameSlot(adminSlotPayload);

        this.realtimeService.emitGameFinished({
          sessionId: result.sessionId,
          adminPayload: adminSlotPayload,
          publicPayload: publicSlotPayload,
        });

        this.realtimeService.emitGameOperationUpdate({
          slotId: updatedSession.gameSlotId,
          sessionId: result.sessionId,
          adminPayload: adminSlotPayload,
          publicPayload: publicSlotPayload,
        });
      }
    }

    await this.emitWalletUpdated(result.userId);

    return result.claim;
  }

  async rejectClaim(
    claimId: string,
    rejectBingoClaimDto: RejectBingoClaimDto,
    actorId: string,
  ) {
    const checkedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.bingoClaim.findUnique({
        where: { id: claimId },
        select: bingoClaimSelect,
      });

      if (!claim) {
        throw new NotFoundException('Bingo claim not found');
      }

      if (claim.status !== BingoClaimStatus.PENDING) {
        throw new BadRequestException('Only pending claims can be rejected');
      }

      const cartelaUpdateResult = await tx.gameCartela.updateMany({
        where: {
          id: claim.gameCartela.id,
          status: GameCartelaStatus.REGISTERED,
        },
        data: {
          status: GameCartelaStatus.BLOCKED,
          blockedAt: checkedAt,
        },
      });

      if (cartelaUpdateResult.count !== 1) {
        throw new ConflictException('Cartela could not be blocked');
      }

      const updatedClaim = await tx.bingoClaim.update({
        where: { id: claim.id },
        data: {
          status: BingoClaimStatus.INVALID,
          reason:
            rejectBingoClaimDto.reason?.trim() ||
            'Rejected after manual admin review',
          checkedAt,
        },
        select: bingoClaimSelect,
      });

      // Update session status back to PLAYING when claim is rejected
      await tx.gameSession.update({
        where: { id: claim.gameSessionId },
        data: { status: GameStatus.PLAYING },
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.bingo_claim.reject',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          sessionId: claim.gameSessionId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        sessionId: claim.gameSessionId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
      };
    });

    const invalidPayload = {
      sessionId: result.sessionId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      reason: result.claim.reason,
      progress: null,
    };

    this.realtimeService.emitToGame(
      result.sessionId,
      'game:bingo_invalid',
      invalidPayload,
    );
    this.realtimeService.emitToAdmin('game:bingo_invalid', invalidPayload);
    this.realtimeService.emitToUser(
      result.userId,
      'game:bingo_invalid',
      invalidPayload,
    );

    // Emit session status changed back to PLAYING after claim rejection
    const updatedSession = await this.prisma.gameSession.findUnique({
      where: { id: result.sessionId },
      select: gameSessionSelect,
    });

    if (updatedSession) {
      const sessionPayload = serializeGameSession(updatedSession);
      const playerPayload = toPlayerGameSession(sessionPayload);

      this.realtimeService.emitToGame(
        result.sessionId,
        'game:status_changed',
        playerPayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', sessionPayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        playerPayload,
      );

      // Re-fetch the slot for normalized operation_updated payload
      const updatedSlot = await this.prisma.gameSlot.findUnique({
        where: { id: updatedSession.gameSlotId },
        include: {
          gameRule: true,
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            include: {
              _count: {
                select: { gameCartelas: true, calledNumbers: true },
              },
            },
          },
        },
      });

      if (updatedSlot) {
        const adminSlotPayload = serializeGameSlot(updatedSlot);
        const publicSlotPayload = toPlayerGameSlot(adminSlotPayload);

        this.realtimeService.emitGameOperationUpdate({
          slotId: updatedSession.gameSlotId,
          sessionId: result.sessionId,
          adminPayload: adminSlotPayload,
          publicPayload: publicSlotPayload,
        });
      }
    }

    return result.claim;
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
