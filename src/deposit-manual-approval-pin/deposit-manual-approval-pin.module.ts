import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DepositManualApprovalPinService } from './deposit-manual-approval-pin.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [DepositManualApprovalPinService],
  exports: [DepositManualApprovalPinService],
})
export class DepositManualApprovalPinModule {}
