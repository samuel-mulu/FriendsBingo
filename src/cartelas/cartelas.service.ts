import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  serializeCartelaBoard,
} from './cartelas.mapper';
import { cartelaSelect } from './cartelas.select';

@Injectable()
export class CartelasService {
  constructor(private readonly prisma: PrismaService) {}

  async getCartelaCatalog() {
    const cartelas = await this.prisma.cartela.findMany({
      orderBy: { number: 'asc' },
      select: cartelaSelect,
    });

    return cartelas.map(serializeCartelaBoard);
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

    const activeReservation = await this.prisma.gameCartelaReservation.findFirst(
      {
        where: {
          gameSessionId: sessionId,
          cartelaId,
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      },
    );

    return Boolean(activeReservation);
  }
}
