import { AdminDepositRecord, DepositRecord } from './deposits.select';

export function serializeDeposit(deposit: DepositRecord) {
  return {
    ...deposit,
    amount: deposit.amount.toString(),
    verifiedAmount: deposit.verifiedAmount?.toString() ?? null,
  };
}

export function serializeAdminDeposit(deposit: AdminDepositRecord) {
  return {
    ...serializeDeposit(deposit),
    user: deposit.user,
  };
}
