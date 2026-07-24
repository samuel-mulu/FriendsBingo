import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GetCartelaCatalogQueryDto } from './dto/get-cartela-catalog-query.dto';
import {
  decodeCartelaCursor,
  encodeCartelaCursor,
  sanitizeCartelaSearchPrefix,
} from './cartelas-prefix.util';
import {
  serializeCartelaBoard,
  serializeCartelaNumberOnly,
} from './cartelas.mapper';
import { cartelaNumberSelect, cartelaSelect } from './cartelas.select';

type CartelaNumberRow = {
  id: string;
  number: number;
  createdAt: Date;
};

@Injectable()
export class CartelasService {
  constructor(private readonly prisma: PrismaService) {}

  async getCartelaCatalog(query?: GetCartelaCatalogQueryDto) {
    if (this.hasPagingParams(query)) {
      return this.getCartelaCatalogPage(query!);
    }

    const cartelas = await this.prisma.cartela.findMany({
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
      select: cartelaNumberSelect,
    });

    return cartelas.map(serializeCartelaNumberOnly);
  }

  private hasPagingParams(query?: GetCartelaCatalogQueryDto): boolean {
    return (
      query != null &&
      (query.limit != null ||
        (query.cursor != null && query.cursor.trim().length > 0) ||
        (query.search != null && query.search.trim().length > 0) ||
        query.shuffle === true)
    );
  }

  private async getCartelaCatalogPage(query: GetCartelaCatalogQueryDto) {
    const limit = Math.min(query.limit ?? 1000, 1000);
    const searchPrefix = sanitizeCartelaSearchPrefix(query.search);
    const cursor = query.cursor?.trim();

    if (
      query.search != null &&
      query.search.trim().length > 0 &&
      !searchPrefix
    ) {
      return {
        items: [],
        nextCursor: null,
        total: 0,
      };
    }

    if (query.shuffle) {
      const rows = await this.queryShuffledRows(limit, searchPrefix);
      return {
        items: rows.map(serializeCartelaNumberOnly),
        nextCursor: null,
        total: searchPrefix
          ? await this.countRowsForSearch(searchPrefix)
          : await this.prisma.cartela.count(),
      };
    }

    const { rows, hasMore } = await this.queryPagedRows({
      limit,
      searchPrefix,
      cursor,
    });
    const items = rows.map(serializeCartelaNumberOnly);
    const nextCursor =
      hasMore && rows.length > 0
        ? encodeCartelaCursor(
            rows[rows.length - 1].number,
            rows[rows.length - 1].id,
          )
        : null;

    const total =
      cursor == null
        ? searchPrefix
          ? await this.countRowsForSearch(searchPrefix)
          : await this.prisma.cartela.count()
        : undefined;

    return {
      items,
      nextCursor,
      ...(total == null ? {} : { total }),
    };
  }

  private async queryShuffledRows(
    limit: number,
    searchPrefix: string | null,
  ): Promise<CartelaNumberRow[]> {
    if (searchPrefix) {
      const likePattern = `${searchPrefix}%`;
      return this.prisma.$queryRaw<CartelaNumberRow[]>`
        SELECT id, number, "createdAt"
        FROM "Cartela"
        WHERE number::text LIKE ${likePattern}
        ORDER BY RANDOM()
        LIMIT ${limit}
      `;
    }

    return this.prisma.$queryRaw<CartelaNumberRow[]>`
      SELECT id, number, "createdAt"
      FROM "Cartela"
      ORDER BY RANDOM()
      LIMIT ${limit}
    `;
  }

  private async queryPagedRows(options: {
    limit: number;
    searchPrefix: string | null;
    cursor?: string;
  }): Promise<{ rows: CartelaNumberRow[]; hasMore: boolean }> {
    const take = options.limit + 1;

    if (options.searchPrefix) {
      const likePattern = `${options.searchPrefix}%`;

      if (options.cursor) {
        const decoded = decodeCartelaCursor(options.cursor);
        if (!decoded) {
          throw new BadRequestException('Invalid cartela catalog cursor');
        }

        const rows = await this.prisma.$queryRaw<CartelaNumberRow[]>`
          SELECT id, number, "createdAt"
          FROM "Cartela"
          WHERE number::text LIKE ${likePattern}
            AND (
              number > ${decoded.number}
              OR (number = ${decoded.number} AND id > ${decoded.id}::uuid)
            )
          ORDER BY number ASC, id ASC
          LIMIT ${take}
        `;

        return {
          rows: rows.slice(0, options.limit),
          hasMore: rows.length > options.limit,
        };
      }

      const rows = await this.prisma.$queryRaw<CartelaNumberRow[]>`
        SELECT id, number, "createdAt"
        FROM "Cartela"
        WHERE number::text LIKE ${likePattern}
        ORDER BY number ASC, id ASC
        LIMIT ${take}
      `;

      return {
        rows: rows.slice(0, options.limit),
        hasMore: rows.length > options.limit,
      };
    }

    if (options.cursor) {
      const decoded = decodeCartelaCursor(options.cursor);
      if (!decoded) {
        throw new BadRequestException('Invalid cartela catalog cursor');
      }

      const rows = await this.prisma.cartela.findMany({
        where: {
          OR: [
            { number: { gt: decoded.number } },
            {
              number: decoded.number,
              id: { gt: decoded.id },
            },
          ],
        },
        orderBy: [{ number: 'asc' }, { id: 'asc' }],
        take,
        select: cartelaNumberSelect,
      });

      return {
        rows,
        hasMore: rows.length > options.limit,
      };
    }

    const rows = await this.prisma.cartela.findMany({
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
      take,
      select: cartelaNumberSelect,
    });

    return {
      rows,
      hasMore: rows.length > options.limit,
    };
  }

  private async countRowsForSearch(searchPrefix: string): Promise<number> {
    const likePattern = `${searchPrefix}%`;
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Cartela"
      WHERE number::text LIKE ${likePattern}
    `;

    return Number(result[0]?.count ?? 0n);
  }

  async getCartelaBoard(
    cartelaId: string,
    requestingUserId: string,
    requestingUserRole: UserRole,
    sessionId: string,
  ) {
    const cartela = await this.prisma.cartela.findUnique({
      where: { id: cartelaId },
      select: cartelaSelect,
    });

    if (!cartela) {
      throw new NotFoundException('Cartela not found');
    }

    if (requestingUserRole !== UserRole.ADMIN) {
      const canViewBoard = await this.canPlayerViewCartelaBoard(
        requestingUserId,
        cartelaId,
        sessionId,
      );

      if (!canViewBoard) {
        throw new ForbiddenException(
          'Cartela board is only available for your active reservation or registered cartelas in this session',
        );
      }
    }

    return serializeCartelaBoard(cartela);
  }

  private async canPlayerViewCartelaBoard(
    userId: string,
    cartelaId: string,
    sessionId: string,
  ): Promise<boolean> {
    const registeredCartela = await this.prisma.gameCartela.findFirst({
      where: {
        gameSessionId: sessionId,
        cartelaId,
        userId,
        status: { not: 'CANCELLED' },
      },
      select: { id: true },
    });

    if (registeredCartela) {
      return true;
    }

    const activeReservation =
      await this.prisma.gameCartelaReservation.findFirst({
        where: {
          gameSessionId: sessionId,
          cartelaId,
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

    return Boolean(activeReservation);
  }
}
