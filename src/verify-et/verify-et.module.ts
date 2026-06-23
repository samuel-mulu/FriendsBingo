import { Module } from '@nestjs/common';
import { VerifyEtClient } from './verify-et.client';
import { VerifyEtService } from './verify-et.service';

@Module({
  providers: [VerifyEtClient, VerifyEtService],
  exports: [VerifyEtService],
})
export class VerifyEtModule {}
