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
import { serializeGame } from '../games/games.mapper';
import { gameSummarySelect } from '../games/games.select';
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

  async claimBingo(gameId: string, userId: string, gameCartelaId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const gameCartela = await tx.gameCartela.findFirst({
        where: {
          id: gameCartelaId,
          gameId,
          userId,
        },
        select: {
          id: true,
          gameId: true,
          userId: true,
          status: true,
          isWinner: true,
          cartela: {
            select: {
              id: true,
              number: true,
            },
          },
          game: {
            select: {
              id: true,
              code: true,
              gameType: true,
              status: true,
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
      });

      if (!gameCartela) {
        throw new NotFoundException('Game cartela not found');
      }

      if (gameCartela.status === GameCartelaStatus.BLOCKED) {
        throw new BadRequestException(
          'Blocked cartelas cannot claim bingo again',
        );
      }

      if (gameCartela.status === GameCartelaStatus.WINNER || gameCartela.isWinner) {
        throw new BadRequestException('This cartela is already the winner');
      }

      if (gameCartela.status !== GameCartelaStatus.REGISTERED) {
        throw new BadRequestException('This cartela cannot make a bingo claim');
      }

      if (gameCartela.game.status === GameStatus.FINISHED) {
        throw new BadRequestException('Game already finished');
      }

      if (gameCartela.game.status !== GameStatus.PLAYING) {
        throw new BadRequestException('Game must be PLAYING to claim bingo');
      }

      const existingPendingClaim = await tx.bingoClaim.findFirst({
        where: {
          gameId,
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
          gameId,
          userId,
          gameCartelaId: gameCartela.id,
          status: BingoClaimStatus.PENDING,
          checkedPattern: gameCartela.game.gameRule?.key ?? gameCartela.game.gameType,
          reason: 'Waiting for admin confirmation',
        },
        select: bingoClaimSelect,
      });

      // Update game status to CHECKING when bingo is claimed
      await tx.game.update({
        where: { id: gameId },
        data: { status: GameStatus.CHECKING },
      });

      await this.auditLogService.create(tx, {
        actorId: userId,
        action: 'player.bingo.pending',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          gameId,
          gameCartelaId,
          gameRuleKey:
            gameCartela.game.gameRule?.key ?? gameCartela.game.gameType,
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

    this.realtimeService.emitToGame(gameId, 'game:bingo_claimed', {
      gameId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });
    this.realtimeService.emitToAdmin('game:bingo_claimed', {
      gameId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });
    this.realtimeService.emitToUser(userId, 'game:bingo_claimed', {
      gameId,
      userId,
      gameCartelaId,
      claimId: result.claim.id,
      status: result.claim.status,
    });

    // Emit game status changed to CHECKING when bingo is claimed
    const updatedGame = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: gameSummarySelect,
    });

    if (updatedGame) {
      const gamePayload = serializeGame(updatedGame);
      this.realtimeService.emitToGame(
        gameId,
        'game:status_changed',
        gamePayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', gamePayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        gamePayload,
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

      if (claim.game.status === GameStatus.FINISHED) {
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

      const gameFinished = await this.gameEngineService.finishGameWithWinner(
        tx,
        claim.game.id,
        claim.gameCartela.id,
        checkedAt,
      );

      if (!gameFinished) {
        throw new ConflictException('Game already finished');
      }

      await this.walletService.creditWallet(tx, claim.userId, claim.game.prizeAmount, {
        type: WalletTransactionType.PRIZE_WIN,
        referenceType: 'GAME',
        referenceId: claim.game.id,
        description: `Prize win for game ${claim.game.code}`,
      });

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
          gameId: claim.gameId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        gameId: claim.game.id,
        userId: claim.userId,
        gameCartelaId: claim.gameCartela.id,
      };
    });

    const validPayload = {
      gameId: result.gameId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      progress: null,
    };

    this.realtimeService.emitToGame(result.gameId, 'game:bingo_valid', validPayload);
    this.realtimeService.emitToAdmin('game:bingo_valid', validPayload);
    this.realtimeService.emitToUser(result.userId, 'game:bingo_valid', validPayload);

    const finishedPayload = {
      gameId: result.gameId,
      winnerCartelaId: result.gameCartelaId,
      finishedAt: result.claim.checkedAt,
    };

    const updatedGame = await this.prisma.game.findUnique({
      where: { id: result.gameId },
      select: gameSummarySelect,
    });

    if (updatedGame) {
      const gamePayload = serializeGame(updatedGame);
      this.realtimeService.emitToGame(
        result.gameId,
        'game:status_changed',
        gamePayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', gamePayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        gamePayload,
      );
    }

    this.realtimeService.emitToGame(result.gameId, 'game:finished', finishedPayload);
    this.realtimeService.emitToAdmin('game:finished', finishedPayload);
    this.realtimeService.emitToPublicGames('game:finished', finishedPayload);
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

      // Update game status back to PLAYING when claim is rejected
      await tx.game.update({
        where: { id: claim.gameId },
        data: { status: GameStatus.PLAYING },
      });

      await this.auditLogService.create(tx, {
        actorId,
        action: 'admin.bingo_claim.reject',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          gameId: claim.gameId,
          gameCartelaId: claim.gameCartelaId,
          userId: claim.userId,
        },
      });

      return {
        claim: serializeBingoClaim(updatedClaim),
        gameId: claim.gameId,
        userId: claim.userId,
        gameCartelaId: claim.gameCartelaId,
      };
    });

    const invalidPayload = {
      gameId: result.gameId,
      userId: result.userId,
      gameCartelaId: result.gameCartelaId,
      claimId: result.claim.id,
      matchedPattern: result.claim.checkedPattern,
      reason: result.claim.reason,
      progress: null,
    };

    this.realtimeService.emitToGame(
      result.gameId,
      'game:bingo_invalid',
      invalidPayload,
    );
    this.realtimeService.emitToAdmin(
      'game:bingo_invalid',
      invalidPayload,
    );
    this.realtimeService.emitToUser(
      result.userId,
      'game:bingo_invalid',
      invalidPayload,
    );

    // Emit game status changed back to PLAYING after claim rejection
    const updatedGame = await this.prisma.game.findUnique({
      where: { id: result.gameId },
      select: gameSummarySelect,
    });

    if (updatedGame) {
      const gamePayload = serializeGame(updatedGame);
      this.realtimeService.emitToGame(
        result.gameId,
        'game:status_changed',
        gamePayload,
      );
      this.realtimeService.emitToAdmin('game:status_changed', gamePayload);
      this.realtimeService.emitToPublicGames(
        'game:status_changed',
        gamePayload,
      );
    }

    return result.claim;
  }

  private async emitWalletUpdated(userId: string): Promise<void> {
    const wallet = await this.walletService.getSerializedWallet(userId);
    this.realtimeService.emitToUser(userId, 'wallet:updated', wallet);
    this.realtimeService.emitToAdmin('wallet:updated', wallet);
  }
}
