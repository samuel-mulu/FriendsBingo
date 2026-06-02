import {
  AdminWithdrawalRecord,
  WithdrawalRecord,
} from './withdrawals.select';

export function serializeWithdrawal(withdrawal: WithdrawalRecord) {
  return {
    ...withdrawal,
    amount: withdrawal.amount.toString(),
  };
}

export function serializeAdminWithdrawal(withdrawal: AdminWithdrawalRecord) {
  return {
    ...serializeWithdrawal(withdrawal),
    user: withdrawal.user,
  };
}
