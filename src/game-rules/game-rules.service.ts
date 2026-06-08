import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GameRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listGameRules() {
    return this.prisma.gameRule.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listActiveGameRules() {
    return this.prisma.gameRule.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getActiveGameRuleOrThrow(gameRuleId: string) {
    const gameRule = await this.prisma.gameRule.findFirst({
      where: {
        id: gameRuleId,
        isActive: true,
      },
    });

    if (!gameRule) {
      throw new NotFoundException('Active game rule not found');
    }

    return gameRule;
  }
}
