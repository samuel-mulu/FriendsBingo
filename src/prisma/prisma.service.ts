import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { RequestPerformanceContext } from '../common/performance/request-performance.context';
import { createPrismaPerformanceExtension } from '../common/performance/prisma-performance.extension';
import {
  createPgPoolConfig,
  resolveDirectDatabaseUrl,
} from './database-url.util';

type ExtendedPrismaClient = PrismaClient;

interface PrismaLifecycleState {
  queryClient: ExtendedPrismaClient;
  transactionClient: ExtendedPrismaClient;
  queryPool: Pool;
  transactionPool: Pool;
  ownsTransactionPool: boolean;
}

/** Merges Prisma model delegates onto the proxied service instance. */
export interface PrismaService extends PrismaClient {}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    configService: ConfigService,
    perfContext: RequestPerformanceContext,
  ) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    const directUrl = resolveDirectDatabaseUrl(
      databaseUrl,
      configService.get<string>('DIRECT_URL'),
    );
    const queryPoolMax = configService.get<number>('DATABASE_POOL_MAX') ?? 15;
    const transactionPoolMax =
      configService.get<number>('DATABASE_DIRECT_POOL_MAX') ?? 5;

    const queryPool = new Pool(createPgPoolConfig(databaseUrl, queryPoolMax));
    const useSeparateTransactionPool = directUrl !== databaseUrl;
    const transactionPool = useSeparateTransactionPool
      ? new Pool(createPgPoolConfig(directUrl, transactionPoolMax))
      : queryPool;

    const extension = createPrismaPerformanceExtension(perfContext);
    const queryClient = new PrismaClient({
      adapter: new PrismaPg(queryPool),
    }).$extends(extension) as unknown as ExtendedPrismaClient;
    const transactionClient = useSeparateTransactionPool
      ? (new PrismaClient({
          adapter: new PrismaPg(transactionPool),
        }).$extends(extension) as unknown as ExtendedPrismaClient)
      : queryClient;

    const lifecycle: PrismaLifecycleState = {
      queryClient,
      transactionClient,
      queryPool,
      transactionPool,
      ownsTransactionPool: useSeparateTransactionPool,
    };

    const lifecycleHandlers = {
      onModuleInit: async () => {
        await lifecycle.queryClient.$connect();
        if (lifecycle.transactionClient !== lifecycle.queryClient) {
          await lifecycle.transactionClient.$connect();
        }
      },
      onModuleDestroy: async () => {
        await lifecycle.queryClient.$disconnect();
        if (lifecycle.transactionClient !== lifecycle.queryClient) {
          await lifecycle.transactionClient.$disconnect();
        }
        await lifecycle.queryPool.end();
        if (lifecycle.ownsTransactionPool) {
          await lifecycle.transactionPool.end();
        }
      },
    };

    const client = new Proxy(queryClient, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return transactionClient.$transaction.bind(transactionClient);
        }

        if (prop === 'onModuleInit' || prop === 'onModuleDestroy') {
          return Reflect.get(lifecycleHandlers, prop, receiver);
        }

        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ExtendedPrismaClient;

    return client as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {}

  async onModuleDestroy(): Promise<void> {}
}
