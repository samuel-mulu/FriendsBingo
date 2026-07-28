import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DepositApprovalConfigService } from './deposit-approval-config.service';
import { TelebirrReceiptFetchService } from './telebirr-receipt-fetch.service';

@Module({
  imports: [PrismaModule, CommonModule],
  providers: [DepositApprovalConfigService, TelebirrReceiptFetchService],
  exports: [DepositApprovalConfigService, TelebirrReceiptFetchService],
})
export class DepositApprovalConfigModule {}