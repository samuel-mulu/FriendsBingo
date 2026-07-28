import { DepositApprovalMode, PaymentProvider } from '@prisma/client';

export const ALL_DEPOSIT_PROVIDERS: PaymentProvider[] = [
  PaymentProvider.TELEBIRR,
  PaymentProvider.CBE,
  PaymentProvider.AWASH,
  PaymentProvider.BOA,
];

export const TELEBIRR_APPROVAL_MODES: DepositApprovalMode[] = [
  DepositApprovalMode.AUTOMATIC,
  DepositApprovalMode.MANUAL,
  DepositApprovalMode.LOCAL,
];

export const STANDARD_APPROVAL_MODES: DepositApprovalMode[] = [
  DepositApprovalMode.AUTOMATIC,
  DepositApprovalMode.MANUAL,
];

export type DepositApprovalModeApi =
  | 'automatic'
  | 'manual'
  | 'local';

export function toApiApprovalMode(
  mode: DepositApprovalMode,
): DepositApprovalModeApi {
  return mode.toLowerCase() as DepositApprovalModeApi;
}

export function fromApiApprovalMode(
  mode: DepositApprovalModeApi,
): DepositApprovalMode {
  return mode.toUpperCase() as DepositApprovalMode;
}

export interface DepositApprovalConfigRecord {
  provider: PaymentProvider;
  enabled: boolean;
  approvalMode: DepositApprovalMode;
  updatedAt: Date;
  updatedById: string | null;
}

export interface AdminDepositApprovalConfigResponse {
  providers: Array<{
    provider: PaymentProvider;
    enabled: boolean;
    approvalMode: DepositApprovalModeApi;
    allowedModes: DepositApprovalModeApi[];
    updatedAt: string;
    updatedById: string | null;
  }>;
}

export interface PlayerDepositProviderApprovalConfig {
  key: PaymentProvider;
  enabled: boolean;
  approvalMode: DepositApprovalModeApi;
}
