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
  Prisma,
} from '@prisma/client';
import { CalledNumberRecord } from '../called-numbers/called-numbers.select';
import { AuditLogService } from '../common/services/audit-log.service';
import { GameEngineService } from '../game-engine/game-engine.service';
import { GameRulesService } from '../game-rules/game-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { serializeBingoClaim } from './bingo-claims.mapper';
import { bingoClaimSelect } from './bingo-claims.select';

@Injectable()
export class BingoClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameRulesService: GameRulesService,
    private readonly gameEngineService: GameEngineService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async claimBingo(gameId: string, userId: string, gameCartelaId: string) {
    const checkedAt = new Date();

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
              b: true,
              i: true,
              n: true,
              g: true,
              o: true,
            },
          },
          game: {
            select: {
              id: true,
              gameType: true,
              status: true,
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

      if (gameCartela.game.status === GameStatus.FINISHED) {
        throw new BadRequestException('Game already finished');
      }

      if (gameCartela.game.status !== GameStatus.PLAYING) {
        throw new BadRequestException('Game must be PLAYING to claim bingo');
      }

      const calledNumbers = await tx.calledNumber.findMany({
        where: { gameId },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          gameId: true,
          letter: true,
          number: true,
          order: true,
          createdAt: true,
        },
      });

      return this.handleClaimResult(
        tx,
        checkedAt,
        gameId,
        userId,
        gameCartela.id,
        gameCartela.status,
        gameCartela.game.gameType,
        gameCartela.cartela,
        calledNumbers,
      );
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

    if (result.isWinner) {
      const validPayload = {
        gameId,
        userId,
        gameCartelaId,
        claimId: result.claim.id,
        matchedPattern: result.claim.checkedPattern,
        progress: result.progress,
      };

      this.realtimeService.emitToGame(gameId, 'game:bingo_valid', validPayload);
      this.realtimeService.emitToAdmin('game:bingo_valid', validPayload);
      this.realtimeService.emitToUser(userId, 'game:bingo_valid', validPayload);

      const finishedPayload = {
        gameId,
        winnerCartelaId: gameCartelaId,
        finishedAt: result.claim.checkedAt,
      };

      this.realtimeService.emitToGame(gameId, 'game:finished', finishedPayload);
      this.realtimeService.emitToAdmin('game:finished', finishedPayload);
    } else {
      const invalidPayload = {
        gameId,
        userId,
        gameCartelaId,
        claimId: result.claim.id,
        matchedPattern: result.claim.checkedPattern,
        reason: result.claim.reason,
        progress: result.progress,
      };

      this.realtimeService.emitToGame(gameId, 'game:bingo_invalid', invalidPayload);
      this.realtimeService.emitToAdmin('game:bingo_invalid', invalidPayload);
      this.realtimeService.emitToUser(userId, 'game:bingo_invalid', invalidPayload);
    }

    return result;
  }

  private async handleClaimResult(
    tx: Prisma.TransactionClient,
    checkedAt: Date,
    gameId: string,
    userId: string,
    gameCartelaId: string,
    gameCartelaStatus: GameCartelaStatus,
    gameType: string,
    cartela: {
      id: string;
      number: number;
      b: unknown;
      i: unknown;
      n: unknown;
      g: unknown;
      o: unknown;
    },
    calledNumbers: CalledNumberRecord[],
  ) {
    if (gameCartelaStatus !== GameCartelaStatus.REGISTERED) {
      throw new BadRequestException('This cartela cannot make a bingo claim');
    }

    const evaluation = this.gameRulesService.evaluate(
      cartela,
      calledNumbers,
      gameType,
    );

    if (!evaluation.isWinner) {
      const updateResult = await tx.gameCartela.updateMany({
        where: {
          id: gameCartelaId,
          status: GameCartelaStatus.REGISTERED,
        },
        data: {
          status: GameCartelaStatus.BLOCKED,
          blockedAt: checkedAt,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('Cartela could not be blocked');
      }

      const claim = await tx.bingoClaim.create({
        data: {
          gameId,
          userId,
          gameCartelaId,
          status: BingoClaimStatus.INVALID,
          checkedPattern: evaluation.matchedPattern,
          reason: `Cartela does not satisfy the ${gameType} rule`,
          checkedAt,
        },
        select: bingoClaimSelect,
      });

      await this.auditLogService.create(tx, {
        actorId: userId,
        action: 'player.bingo.invalid',
        entity: 'BingoClaim',
        entityId: claim.id,
        metadata: {
          gameId,
          gameCartelaId,
          matchedPattern: evaluation.matchedPattern,
          progress: evaluation.progress,
        },
      });

      return {
        claim: serializeBingoClaim(claim),
        progress: evaluation.progress,
        isWinner: false,
        gameStatus: GameStatus.PLAYING,
        gameCartelaStatus: GameCartelaStatus.BLOCKED,
      };
    }

    const cartelaUpdateResult = await tx.gameCartela.updateMany({
      where: {
        id: gameCartelaId,
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
      gameId,
      gameCartelaId,
      checkedAt,
    );

    if (!gameFinished) {
      throw new ConflictException('Game already finished');
    }

    const claim = await tx.bingoClaim.create({
      data: {
        gameId,
        userId,
        gameCartelaId,
        status: BingoClaimStatus.VALID,
        checkedPattern: evaluation.matchedPattern,
        reason: null,
        checkedAt,
      },
      select: bingoClaimSelect,
    });

    await this.auditLogService.create(tx, {
      actorId: userId,
      action: 'player.bingo.valid',
      entity: 'BingoClaim',
      entityId: claim.id,
      metadata: {
        gameId,
        gameCartelaId,
        matchedPattern: evaluation.matchedPattern,
        progress: evaluation.progress,
      },
    });

    return {
      claim: serializeBingoClaim(claim),
      progress: evaluation.progress,
      isWinner: true,
      gameStatus: GameStatus.FINISHED,
      gameCartelaStatus: GameCartelaStatus.WINNER,
    };
  }
}
