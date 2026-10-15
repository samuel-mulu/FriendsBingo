/**
 * Documents the exclusive claim used by finalizeAutomaticApproval.
 * Real fencing is Prisma updateMany; this suite asserts the predicate shape.
 */
describe('DepositVerificationAttempt concurrent completion claim', () => {
  type ClaimRow = {
    id: string;
    status: 'SUBMITTING' | 'AWAITING_PROVIDER' | 'AMBIGUOUS' | 'SUCCEEDED';
    depositId: string | null;
    lastErrorCode: string | null;
  };

  function canClaim(row: ClaimRow): boolean {
    const active = ['SUBMITTING', 'AWAITING_PROVIDER', 'AMBIGUOUS'].includes(
      row.status,
    );
    return (
      active &&
      row.depositId === null &&
      row.lastErrorCode !== 'COMPLETING'
    );
  }

  function applyClaim(row: ClaimRow): ClaimRow {
    if (!canClaim(row)) {
      return row;
    }
    return {
      ...row,
      lastErrorCode: 'COMPLETING',
    };
  }

  it('allows only the first of two concurrent claimants', () => {
    let row: ClaimRow = {
      id: 'attempt-1',
      status: 'AWAITING_PROVIDER',
      depositId: null,
      lastErrorCode: 'VERIFICATION_PENDING',
    };

    const first = canClaim(row);
    row = applyClaim(row);
    const second = canClaim(row);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(row.lastErrorCode).toBe('COMPLETING');
  });

  it('rejects claim after deposit is linked', () => {
    const row: ClaimRow = {
      id: 'attempt-1',
      status: 'AWAITING_PROVIDER',
      depositId: 'dep-1',
      lastErrorCode: null,
    };
    expect(canClaim(row)).toBe(false);
  });

  it('rejects claim on terminal succeeded status', () => {
    const row: ClaimRow = {
      id: 'attempt-1',
      status: 'SUCCEEDED',
      depositId: null,
      lastErrorCode: null,
    };
    expect(canClaim(row)).toBe(false);
  });
});
