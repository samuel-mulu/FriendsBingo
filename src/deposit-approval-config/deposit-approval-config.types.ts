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
  DepositApprovalMode.LOCAL_WITH_FALLBACK,
];

export const STANDARD_APPROVAL_MODES: DepositApprovalMode[] = [
  DepositApprovalMode.AUTOMATIC,
  DepositApprovalMode.MANUAL,
];

export type DepositApprovalModeApi =
  | 'automatic'
  | 'manual'
  | 'local'
  | 'local_with_fallback';

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
  fallbackThreshold: number;
  fallbackWindowMinutes: number;
  fallbackDurationMinutes: number;
  fallbackUntil: Date | null;
  fallbackReason: string | null;
  updatedAt: Date;
  updatedById: string | null;
}

export interface AdminDepositApprovalConfigResponse {
  providers: Array<{
    provider: PaymentProvider;
    enabled: boolean;
    approvalMode: DepositApprovalModeApi;
    allowedModes: DepositApprovalModeApi[];
    fallbackThreshold?: number;
    fallbackWindowMinutes?: number;
    fallbackDurationMinutes?: number;
    fallbackUntil?: string | null;
    fallbackReason?: string | null;
    isFallbackActive?: boolean;
    updatedAt: string;
    updatedById: string | null;
  }>;
}

export interface PlayerDepositProviderApprovalConfig {
  key: PaymentProvider;
  enabled: boolean;
  approvalMode: DepositApprovalModeApi;
  configuredApprovalMode?: DepositApprovalModeApi;
  isFallbackActive?: boolean;
  fallbackUntil?: string | null;
}
