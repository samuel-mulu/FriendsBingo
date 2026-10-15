import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelebirrClientReceiptDto } from '../deposits/dto/telebirr-client-receipt.dto';
import { maskDepositRef } from '../deposits/deposit-verification.observability';
import { parseTelebirrReceiptHtml } from './telebirr-receipt-html.parser';

@Injectable()
export class TelebirrReceiptFetchService {
  private readonly logger = new Logger(TelebirrReceiptFetchService.name);

  constructor(private readonly configService: ConfigService) {}

  async fetchClientReceipt(
    transactionRef: string,
  ): Promise<TelebirrClientReceiptDto | null> {
    const baseUrl =
      this.configService.get<string>('TELEBIRR_RECEIPT_BASE_URL') ??
      'https://transactioninfo.ethiotelecom.et/receipt';
    const normalizedRef = transactionRef.trim().toUpperCase();
    const refSuffix = maskDepositRef(normalizedRef);
    const url = `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(normalizedRef)}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'FriendsBingo/1.0',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Telebirr receipt fetch failed for ${refSuffix}: HTTP ${response.status}`,
        );
        return null;
      }

      const html = await response.text();
      const parsed = parseTelebirrReceiptHtml(html, normalizedRef);
      if (!parsed) {
        this.logger.warn(`Telebirr receipt parse failed for ${refSuffix}`);
      }

      return parsed;
    } catch (error) {
      this.logger.warn(
        `Telebirr receipt fetch error for ${refSuffix}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
