import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializeCartela } from './cartelas.mapper';
import { cartelaSelect } from './cartelas.select';

@Injectable()
export class CartelasService {
  constructor(private readonly prisma: PrismaService) {}

  async getCartelas() {
    const cartelas = await this.prisma.cartela.findMany({
      orderBy: { number: 'asc' },
      select: cartelaSelect,
    });

    return cartelas.map(serializeCartela);
  }
}
