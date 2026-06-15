import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FETCH_TIMEOUT_MS = 15_000;
const MIN_VALID_RECEIPT_BYTES = 1000;

@Injectable()
export class TelebirrReceiptFetcher {
  private readonly logger = new Logger(TelebirrReceiptFetcher.name);

  constructor(private readonly configService: ConfigService) {}

  buildReceiptUrl(receiptCode: string): string {
    const baseUrl = (
      this.configService.get<string>('TELEBIRR_RECEIPT_BASE_URL') ??
      'https://transactioninfo.ethiotelecom.et/receipt'
    ).replace(/\/+$/, '');

    return `${baseUrl}/${receiptCode}`;
  }

  async fetchReceiptHtml(receiptCode: string): Promise<string | null> {
    const url = this.buildReceiptUrl(receiptCode);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html',
          'User-Agent': 'FriendsBingoDepositVerifier/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Telebirr receipt fetch failed for ${receiptCode}: HTTP ${response.status}`,
        );
        return null;
      }

      const html = await response.text();
      if (html.length < MIN_VALID_RECEIPT_BYTES) {
        return null;
      }

      return html;
    } catch (error) {
      this.logger.warn(
        `Telebirr receipt fetch error for ${receiptCode}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
