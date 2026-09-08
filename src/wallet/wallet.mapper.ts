import { WalletRecord, WalletTransactionRecord } from './wallet.select';

export function serializeWallet(
  wallet: WalletRecord,
  context?: {
    isFirstTimePlayer: boolean;
    bigGameTicketBalance?: number;
    bigGameTicketSlotId?: string | null;
    bigGameName?: string | null;
  },
) {
  return {
    ...wallet,
    balance: wallet.balance.toString(),
    lockedBalance: wallet.lockedBalance.toString(),
    totalBalance: wallet.balance.plus(wallet.lockedBalance).toString(),
    isFirstTimePlayer: context?.isFirstTimePlayer ?? false,
    bigGameTicketBalance: context?.bigGameTicketBalance ?? 0,
    bigGameTicketSlotId: context?.bigGameTicketSlotId ?? null,
    bigGameName: context?.bigGameName ?? null,
  };
}

export function serializeWalletTransaction(
  transaction: WalletTransactionRecord,
) {
  return {
    ...transaction,
    amount: transaction.amount.toString(),
    balanceBefore: transaction.balanceBefore.toString(),
    balanceAfter: transaction.balanceAfter.toString(),
  };
}
