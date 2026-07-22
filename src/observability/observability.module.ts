import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { ObservabilityService } from './observability.service';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [ObservabilityService, RequestContextService],
  exports: [ObservabilityService, RequestContextService],
})
export class ObservabilityModule {}
