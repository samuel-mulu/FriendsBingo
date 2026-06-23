import { WalletRecord, WalletTransactionRecord } from './wallet.select';

export function serializeWallet(wallet: WalletRecord) {
  return {
    ...wallet,
    balance: wallet.balance.toString(),
    lockedBalance: wallet.lockedBalance.toString(),
    totalBalance: wallet.balance.plus(wallet.lockedBalance).toString(),
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
