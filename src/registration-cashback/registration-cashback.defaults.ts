export const REGISTRATION_CASHBACK_CONFIG_ID = 'default';

export const DEFAULT_REGISTRATION_CASHBACK_TIERS = [
  { minCartelasInSession: 50, rewardEtb: '10' },
  { minCartelasInSession: 70, rewardEtb: '20' },
] as const;

export const REGISTRATION_CASHBACK_REFERENCE_TYPE =
  'REGISTRATION_CASHBACK_SESSION';
