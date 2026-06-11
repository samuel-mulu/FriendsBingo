import { Global, Module } from '@nestjs/common';
import { OperationsCacheService } from './operations-cache.service';

@Global()
@Module({
  providers: [OperationsCacheService],
  exports: [OperationsCacheService],
})
export class OperationsCacheModule {}
