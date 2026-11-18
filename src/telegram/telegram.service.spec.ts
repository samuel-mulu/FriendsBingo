import {
  buildMiniappPathUrl,
  buildMiniappStartUrl,
  escapeTelegramHtml,
  normalizeHttpsMiniappUrl,
} from './telegram-formatting.util';
import { handleStartCommand } from './commands/start.command';
import { handleWalletCommand } from './commands/wallet.command';
import { envValidationSchema } from '../config/env.validation';

describe('Telegram Formatting Utilities', () => {
  describe('escapeTelegramHtml', () => {
    it('should escape &, <, and > characters', () => {
      expect(escapeTelegramHtml('John & Jane')).toBe('John &amp; Jane');
      expect(escapeTelegramHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert("xss")&lt;/script&gt;',
      );
      expect(escapeTelegramHtml('A < B & B > C')).toBe('A &lt; B &amp; B &gt; C');
    });

    it('should leave strings without special characters untouched', () => {
      expect(escapeTelegramHtml('Hello World 123!')).toBe('Hello World 123!');
    });
  });

  describe('normalizeHttpsMiniappUrl', () => {
    it('should normalize valid HTTPS URLs and strip trailing slashes', () => {
      expect(normalizeHttpsMiniappUrl('https://example.com/')).toBe(
        'https://example.com',
      );
      expect(normalizeHttpsMiniappUrl('  https://friends-mini-app.vercel.app///  ')).toBe(
        'https://friends-mini-app.vercel.app',
      );
    });

    it('should reject non-HTTPS URLs', () => {
      expect(normalizeHttpsMiniappUrl('http://localhost:3000')).toBeUndefined();
      expect(normalizeHttpsMiniappUrl('ftp://example.com')).toBeUndefined();
    });

    it('should return undefined for empty or invalid inputs', () => {
      expect(normalizeHttpsMiniappUrl(undefined)).toBeUndefined();
      expect(normalizeHttpsMiniappUrl('')).toBeUndefined();
      expect(normalizeHttpsMiniappUrl('   ')).toBeUndefined();
      expect(normalizeHttpsMiniappUrl('not-a-url')).toBeUndefined();
    });
  });

  describe('buildMiniappPathUrl', () => {
    it('should cleanly join base URL and relative path without double slashes', () => {
      expect(
        buildMiniappPathUrl('https://example.com', '/wallet'),
      ).toBe('https://example.com/wallet');
      expect(
        buildMiniappPathUrl('https://example.com/', 'wallet'),
      ).toBe('https://example.com/wallet');
      expect(
        buildMiniappPathUrl('https://example.com///', '/wallet'),
      ).toBe('https://example.com/wallet');
    });
  });

  describe('buildMiniappStartUrl', () => {
    it('should append startapp query param when provided', () => {
      expect(
        buildMiniappStartUrl('https://example.com', 'referral_123'),
      ).toBe('https://example.com/?startapp=referral_123');
    });

    it('should return baseUrl unchanged when startParam is missing or empty', () => {
      expect(buildMiniappStartUrl('https://example.com', undefined)).toBe(
        'https://example.com',
      );
      expect(buildMiniappStartUrl('https://example.com', '   ')).toBe(
        'https://example.com',
      );
    });
  });
});

describe('Telegram Bot Commands', () => {
  describe('handleStartCommand', () => {
    it('should escape user name in HTML mode', async () => {
      const mockReply = jest.fn().mockResolvedValue(undefined);
      const mockCtx: any = {
        from: {
          first_name: '<Scary&Name>',
          language_code: 'en',
        },
        match: '',
        reply: mockReply,
      };

      await handleStartCommand(mockCtx, 'https://example.com');

      expect(mockReply).toHaveBeenCalledTimes(1);
      const [text, options] = mockReply.mock.calls[0];
      expect(options.parse_mode).toBe('HTML');
      expect(text).toContain('&lt;Scary&amp;Name&gt;');
      expect(text).not.toContain('<Scary&Name>');
    });
  });

  describe('handleWalletCommand', () => {
    it('should display balance and bonus cartelas for Linked Player', async () => {
      const mockReply = jest.fn().mockResolvedValue(undefined);
      const mockCtx: any = {
        from: {
          id: 12345678,
          language_code: 'en',
        },
        reply: mockReply,
      };

      const mockPrisma: any = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            telegramId: '12345678',
            wallet: {
              balance: 150.5,
              bonusCartelaBalance: 3,
            },
          }),
        },
      };

      await handleWalletCommand(mockCtx, mockPrisma, 'https://example.com');

      expect(mockReply).toHaveBeenCalledTimes(1);
      const [text, options] = mockReply.mock.calls[0];
      expect(options.parse_mode).toBe('HTML');
      expect(text).toContain('Current Balance:');
      expect(text).toContain('150.50 ETB');
      expect(text).toContain('Bonus Cartelas:');
      expect(text).toContain('3');
    });

    it('should display unlinked notice for Unlinked Telegram Visitor', async () => {
      const mockReply = jest.fn().mockResolvedValue(undefined);
      const mockCtx: any = {
        from: {
          id: 99999999,
          language_code: 'en',
        },
        reply: mockReply,
      };

      const mockPrisma: any = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };

      await handleWalletCommand(mockCtx, mockPrisma, 'https://example.com');

      expect(mockReply).toHaveBeenCalledTimes(1);
      const [text, options] = mockReply.mock.calls[0];
      expect(options.parse_mode).toBe('HTML');
      expect(text).toContain('Your Telegram account is not yet linked');
      expect(text).not.toContain('Current Balance:');
    });
  });
});

describe('Telegram Environment Validation', () => {
  const baseValidEnv = {
    NODE_ENV: 'production',
    PORT: 4000,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'super_secret_jwt_key_at_least_16_chars',
    JWT_EXPIRES_IN: '7d',
    CBE_SETTLEMENT_ACCOUNT: '1000000000000',
    AWASH_SETTLEMENT_ACCOUNT: '01320000000000',
    BOA_SETTLEMENT_ACCOUNT: '148000000',
    TELEBIRR_RECEIVER_PHONE: '0900000000',
    TELEBIRR_SETTLEMENT_ACCOUNT: '0900000000',
    VERIFY_ET_API_KEY: 'verify_key',
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_CLIENT_EMAIL: 'test@example.com',
    FIREBASE_PRIVATE_KEY: 'key',
    CORS_ORIGINS: 'https://friends-mini-app.vercel.app',
  };

  it('should require TELEGRAM_WEBHOOK_SECRET (>=16 chars) in production when bot token is set in webhook mode', () => {
    const invalidEnv = {
      ...baseValidEnv,
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      TELEGRAM_BOT_POLLING: false,
      TELEGRAM_WEBHOOK_SECRET: 'short',
    };

    const result = envValidationSchema.validate(invalidEnv);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('should accept valid TELEGRAM_WEBHOOK_SECRET in production when bot token is set', () => {
    const validEnv = {
      ...baseValidEnv,
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      TELEGRAM_BOT_POLLING: false,
      TELEGRAM_WEBHOOK_SECRET: 'valid_webhook_secret_min_16_chars_long',
    };

    const result = envValidationSchema.validate(validEnv);
    expect(result.error).toBeUndefined();
  });

  it('should allow empty TELEGRAM_WEBHOOK_SECRET when bot token is not set', () => {
    const validEnvWithoutBot = {
      ...baseValidEnv,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    };

    const result = envValidationSchema.validate(validEnvWithoutBot);
    expect(result.error).toBeUndefined();
  });

  it('should allow empty TELEGRAM_WEBHOOK_SECRET in development mode', () => {
    const devEnv = {
      ...baseValidEnv,
      NODE_ENV: 'development',
      CORS_ORIGINS: '*',
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
      TELEGRAM_BOT_POLLING: false,
      TELEGRAM_WEBHOOK_SECRET: '',
    };

    const result = envValidationSchema.validate(devEnv);
    expect(result.error).toBeUndefined();
  });
});
