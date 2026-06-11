import { Prisma } from '@prisma/client';
import { RequestPerformanceContext } from './request-performance.context';

export function createPrismaPerformanceExtension(
  perfContext: RequestPerformanceContext,
) {
  return Prisma.defineExtension({
    name: 'request-performance',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const startedAt = performance.now();
          try {
            return await query(args);
          } finally {
            perfContext.recordQuery({
              model: model ?? 'raw',
              operation,
              durationMs: performance.now() - startedAt,
            });
          }
        },
      },
    },
  });
}
