/** Singleton row id for manual deposit approval PIN storage. */
export const DEPOSIT_MANUAL_APPROVAL_PIN_CONFIG_ID = 'default';

/**
 * Bcrypt hash of the legacy default PIN (121921). Used when the config row is
 * missing (pre-migration databases) so behavior matches production until migrated.
 */
export const DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH =
  '$2b$10$LTxy8lXxov0.GSvxsQnScO5EodhkjD5qlzj8P6MasJooowSNpOFH.';
