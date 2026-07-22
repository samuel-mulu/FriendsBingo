import { Prisma } from '@prisma/client';
import { ObservabilityService } from '../../observability/observability.service';
import { RequestPerformanceContext } from './request-performance.context';

export function createPrismaPerformanceExtension(
  perfContext: RequestPerformanceContext,
  observability: ObservabilityService,
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
            const durationMs = performance.now() - startedAt;
            observability.recordPrismaQuery(model ?? 'raw', operation, durationMs);
            perfContext.recordQuery({
              model: model ?? 'raw',
              operation,
              durationMs,
            });
          }
        },
      },
    },
  });
}
