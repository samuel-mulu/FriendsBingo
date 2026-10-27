import * as bcrypt from 'bcrypt';
import { DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH } from '../deposit-manual-approval-pin/deposit-manual-approval-pin.defaults';

describe('Manual deposit approval PIN migration default', () => {
  it('keeps the seeded default hash matching legacy PIN 121921', async () => {
    expect(DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH).toMatch(/^\$2[aby]\$/);
    await expect(
      bcrypt.compare('121921', DEFAULT_DEPOSIT_MANUAL_APPROVAL_PIN_HASH),
    ).resolves.toBe(true);
  });
});
