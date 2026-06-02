import { PaymentProvider } from '@prisma/client';

export interface VerifyDepositInput {
  depositId: string;
  provider: PaymentProvider;
  transactionRef: string;
  requestedAmount: string;
}
