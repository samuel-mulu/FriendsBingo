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
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateGameDto } from './dto/create-game.dto';
import { RegisterCartelaDto } from './dto/register-cartela.dto';
import { UpdateGameStatusDto } from './dto/update-game-status.dto';
import { assertValidGameStatusTransition } from './game-status.rules';
import { serializeGame, serializeGameCartela } from './games.mapper';
import {
  gameSummarySelect,
  myGameCartelaSelect,
  registerableGameStatuses,
} from './games.select';

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly gameEngineService: GameEngineService,
    private readonly calledNumbersService: CalledNumbersService,
    private readonly bingoClaimsService: BingoClaimsService,
    private readonly realtimeService: RealtimeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createGame(createGameDto: CreateGameDto, actorId?: string) {
    const entryFee = this.parseAmount(createGameDto.entryFee, 'entryFee');
    const prizeAmount = this.parseAmount(
      createGameDto.prizeAmount,
      'prizeAmount',
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = await this.generateUniqueGameCode();

      try {
        const game = await this.prisma.$transaction(async (tx) => {
          const createdGame = await tx.game.create({
            data: {
              code,
              name: createGameDto.name.trim(),
              gameType: createGameDto.gameType.trim(),
              entryFee,
              prizeAmount,
              startsAt: new Date(createGameDto.startsAt),
            },
            select: gameSummarySelect,
          });

          if (actorId) {
            await this.auditLogService.create(tx, {
              actorId,
              action: 'admin.game.create',
              entity: 'Game',
              entityId: createdGame.id,
              metadata: {
                code: createdGame.code,
                gameType: createdGame.gameType,
              },
            });
          }

          return createdGame;
        });

        return serializeGame(game);
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new InternalServerErrorException('Failed to generate unique game code');
  }

  async getAdminGames(paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const [totalItems, games] = await Promise.all([
      this.prisma.game.count(),
      this.prisma.game.findMany({
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
        select: gameSummarySelect,
      }),
    ]);

    return {
      items: games.map(serializeGame),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async updateGameStatus(
    gameId: string,
    updateGameStatusDto: UpdateGameStatusDto,
    actorId?: string,
  ) {
    if (updateGameStatusDto.status === GameStatus.PLAYING) {
      throw new BadRequestException(
        'Use the start endpoint to move a game into PLAYING status',
      );
    }

    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    assertValidGameStatusTransition(game.status, updateGameStatusDto.status);

    const updatedGame = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.game.updateMany({
        where: {
          id: gameId,
          status: game.status,
        },
        data: {
          status: updateGameStatusDto.status,
        },
      });

      if (updateResult.count !== 1) {
        throw new BadRequestException('Game status update failed');
      }

      if (actorId) {
        await this.auditLogService.create(tx, {
          actorId,
          action: 'admin.game.status_change',
          entity: 'Game',
          entityId: gameId,
          metadata: {
            from: game.status,
            to: updateGameStatusDto.status,
          },
        });
      }

      const refreshedGame = await tx.game.findUnique({
        where: { id: gameId },
        select: gameSummarySelect,
      });

      if (!refreshedGame) {
        throw new NotFoundException('Game not found');
      }

      return refreshedGame;
    });

    const payload = serializeGame(updatedGame);
    this.realtimeService.emitToGame(gameId, 'game:status_changed', payload);
    this.realtimeService.emitToAdmin('game:status_changed', payload);

    return payload;
  }

  async getAvailableGames() {
    const games = await this.prisma.game.findMany({
      where: {
        status: {
          in: registerableGameStatuses,
        },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'desc' }],
      select: gameSummarySelect,
    });

    return games.map(serializeGame);
  }

  async getGameDetail(gameId: string) {
    const game = await this.getGameSummaryOrThrow(gameId);
    return serializeGame(game);
  }

  async startGame(gameId: string, actorId?: string) {
    return this.gameEngineService.startGame(gameId, actorId);
  }

  async callNumber(
    gameId: string,
    callNumberDto: CallNumberDto,
    actorId?: string,
  ) {
    return this.calledNumbersService.callNumber(gameId, callNumberDto, actorId);
  }

  async getCalledNumbers(gameId: string) {
    return this.calledNumbersService.getCalledNumbers(gameId);
  }

  async registerCartela(
    gameId: string,
    userId: string,
    registerCartelaDto: RegisterCartelaDto,
  ) {
    try {
      const gameCartela = await this.prisma.$transaction(async (tx) => {
        const game = await tx.game.findUnique({
          where: { id: gameId },
          select: {
            id: true,
            code: true,
            entryFee: true,
            status: true,
          },
        });

        if (!game) {
          throw new NotFoundException('Game not found');
        }

        if (!registerableGameStatuses.includes(game.status)) {
          throw new BadRequestException(
            'Cartela registration is not allowed for this game status',
          );
        }

        const cartela = await tx.cartela.findUnique({
          where: { id: registerCartelaDto.cartelaId },
          select: { id: true },
        });

        if (!cartela) {
          throw new NotFoundException('Cartela not found');
        }

        await this.walletService.debitWallet(tx, userId, game.entryFee, {
          type: WalletTransactionType.GAME_ENTRY,
          referenceType: 'GAME',
          referenceId: game.id,
          description: `Game entry fee for ${game.code}`,
        });

        return tx.gameCartela.create({
          data: {
            gameId: game.id,
            userId,
            cartelaId: cartela.id,
            status: GameCartelaStatus.REGISTERED,
          },
          select: myGameCartelaSelect,
        });
      });

      return serializeGameCartela(gameCartela);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'This cartela is already registered for the selected game',
        );
      }

      throw error;
    }
  }

  async claimBingo(
    gameId: string,
    userId: string,
    createBingoClaimDto: CreateBingoClaimDto,
  ) {
    return this.bingoClaimsService.claimBingo(
      gameId,
      userId,
      createBingoClaimDto.gameCartelaId,
    );
  }

  async getMyCartelas(gameId: string, userId: string) {
    await this.ensureGameExists(gameId);

    const gameCartelas = await this.prisma.gameCartela.findMany({
      where: {
        gameId,
        userId,
      },
      orderBy: { createdAt: 'desc' },
      select: myGameCartelaSelect,
    });

    return gameCartelas.map(serializeGameCartela);
  }

  private async getGameSummaryOrThrow(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: gameSummarySelect,
    });

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return game;
  }

  private async ensureGameExists(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true },
    });

    if (!game) {
      throw new NotFoundException('Game not found');
    }
  }

  private async generateUniqueGameCode(): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = `FB-${Math.floor(100000 + Math.random() * 900000)}`;
      const existingGame = await this.prisma.game.findUnique({
        where: { code },
        select: { id: true },
      });

      if (!existingGame) {
        return code;
      }
    }

    throw new InternalServerErrorException('Unable to reserve a unique game code');
  }

  private parseAmount(value: string, fieldName: string): Prisma.Decimal {
    const amount = new Prisma.Decimal(value);

    if (amount.lte(0)) {
      throw new BadRequestException(`${fieldName} must be greater than zero`);
    }

    return amount;
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
