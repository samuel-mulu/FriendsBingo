export const VERIFY_ET_BANK_KEYS = {
  TELEBIRR: 'telebirr',
  CBE: 'cbe',
  AWASH: 'awash',
  BOA: 'boa',
} as const;

export const VERIFY_ET_COMPLETED_STATUS = 'completed';

export const VERIFY_ET_UNAVAILABLE_STATUSES = new Set(['failed', 'error']);
