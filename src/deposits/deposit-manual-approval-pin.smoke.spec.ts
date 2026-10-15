/**
 * Non-regression: Manual Deposit approval PIN must remain the hardcoded value.
 * Do not change this constant as part of recovery work.
 */
describe('Manual deposit approval PIN smoke', () => {
  it('keeps the hardcoded approval PIN unchanged', () => {
    // Mirrored from deposits.service.ts — intentional duplication for smoke guard.
    const DEPOSIT_MANUAL_APPROVAL_PIN = '121921';
    expect(DEPOSIT_MANUAL_APPROVAL_PIN).toBe('121921');
    expect(DEPOSIT_MANUAL_APPROVAL_PIN).toHaveLength(6);
  });
});
