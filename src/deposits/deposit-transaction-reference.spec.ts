import { DepositApprovalMode, PaymentProvider } from '@prisma/client';
import { canonicalizeDepositTransactionRef } from './deposit-transaction-reference';

describe('canonicalizeDepositTransactionRef', () => {
  const cbeReceiptBaseUrl = 'https://mbreciept.cbe.com.et/receipt';

  function canonicalize(
    transactionRef: string,
    provider: PaymentProvider = PaymentProvider.CBE,
    approvalMode: DepositApprovalMode = DepositApprovalMode.MANUAL,
  ) {
    return canonicalizeDepositTransactionRef({
      provider,
      approvalMode,
      transactionRef,
      cbeReceiptBaseUrl,
    });
  }

  it('normalizes a legacy CBE FT reference in manual mode', () => {
    expect(canonicalize(' ft26152zn0xy ')).toBe('FT26152ZN0XY');
  });

  it('preserves a case-sensitive CBE mobile receipt token', () => {
    expect(canonicalize('fHCxyU3pPQIUBir8hu')).toBe('fHCxyU3pPQIUBir8hu');
  });

  it('canonicalizes path and query URLs to the same token', () => {
    const token = 'fHCxyU3pPQIUBir8hu';

    expect(canonicalize(`${cbeReceiptBaseUrl}/${token}?utm_source=share`)).toBe(
      token,
    );
    expect(canonicalize(`https://mbreciept.cbe.com.et/?id=${token}`)).toBe(
      token,
    );
  });

  it('rejects non-official CBE receipt URLs', () => {
    expect(
      canonicalize('https://example.com/receipt/fHCxyU3pPQIUBir8hu'),
    ).toBeNull();
    expect(
      canonicalize('https://mbreciept.cbe.com.et/other/fHCxyU3pPQIUBir8hu'),
    ).toBeNull();
  });

  it('does not allow URLs for CBE automatic mode', () => {
    expect(
      canonicalize(
        `${cbeReceiptBaseUrl}/fHCxyU3pPQIUBir8hu`,
        PaymentProvider.CBE,
        DepositApprovalMode.AUTOMATIC,
      ),
    ).toBeNull();
  });

  it('does not allow URLs for other manual providers', () => {
    expect(
      canonicalize(
        `${cbeReceiptBaseUrl}/fHCxyU3pPQIUBir8hu`,
        PaymentProvider.TELEBIRR,
        DepositApprovalMode.MANUAL,
      ),
    ).toBeNull();
  });

  it('keeps existing uppercase normalization outside CBE manual mode', () => {
    expect(
      canonicalize(
        'dfE8v9no7e',
        PaymentProvider.TELEBIRR,
        DepositApprovalMode.AUTOMATIC,
      ),
    ).toBe('DFE8V9NO7E');
  });
});
