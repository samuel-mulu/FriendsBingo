import { Global, Module } from '@nestjs/common';
import { OperationsCacheService } from './operations-cache.service';
import { RegistrationStateCacheService } from './registration-state-cache.service';

@Global()
@Module({
  providers: [OperationsCacheService, RegistrationStateCacheService],
  exports: [OperationsCacheService, RegistrationStateCacheService],
})
export class OperationsCacheModule {}
