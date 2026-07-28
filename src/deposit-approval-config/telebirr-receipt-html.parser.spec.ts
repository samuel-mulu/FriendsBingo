import { parseTelebirrReceiptHtml } from './telebirr-receipt-html.parser';

describe('parseTelebirrReceiptHtml', () => {
  const sampleHtml = `
    <tr>
      <td>የገንዘብ ተቀባይ ስም/Credited Party name</td>
      <td>Yonas Shiferaw Yowhans</td>
    </tr>
    <tr>
      <td>የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no</td>
      <td>2519****3287</td>
    </tr>
    <tr>
      <td>የክፍያው ሁኔታ/transaction status</td>
      <td>Completed</td>
    </tr>
    <tr>
      <td>የክፍያ ቁጥር/Invoice No.</td>
      <td>የክፍያ ቀን/Payment date</td>
      <td>የተከፈለው መጠን/Settled Amount</td>
    </tr>
    <tr>
      <td>DGS1BJ2WJ3</td>
      <td>28-07-2026 16:54:42</td>
      <td>10 Birr</td>
    </tr>
  `;

  it('parses a real Telebirr receipt layout', () => {
    const parsed = parseTelebirrReceiptHtml(sampleHtml, 'DGS1BJ2WJ3');

    expect(parsed).toEqual({
      invoiceNumber: 'DGS1BJ2WJ3',
      transactionStatus: 'Completed',
      settledAmount: '10',
      creditedPartyName: 'Yonas Shiferaw Yowhans',
      creditedPartyAccountNo: '2519****3287',
    });
  });

  it('returns null when invoice is missing', () => {
    expect(parseTelebirrReceiptHtml('<html></html>', 'DGS1BJ2WJ3')).toBeNull();
  });
});
