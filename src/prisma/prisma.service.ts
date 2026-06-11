import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { createPrismaPerformanceExtension } from '../common/performance/prisma-performance.extension';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    configService: ConfigService,
    perfContext: RequestPerformanceContext,
  ) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
    });

    super({ adapter });

    return this.$extends(
      createPrismaPerformanceExtension(perfContext),
    ) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
