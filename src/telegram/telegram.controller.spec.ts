import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

describe('TelegramController', () => {
  let controller: TelegramController;
  let telegramService: jest.Mocked<Partial<TelegramService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    telegramService = {
      handleWebhookUpdate: jest.fn().mockResolvedValue(undefined),
      getBotInstance: jest.fn().mockReturnValue({} as any),
      getStatus: jest.fn().mockReturnValue({
        configured: true,
        initialized: true,
        mode: 'webhook',
      }),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'TELEGRAM_WEBHOOK_SECRET') return 'test-secret-at-least-16-chars';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: TelegramService, useValue: telegramService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<TelegramController>(TelegramController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should process webhook when secret header matches', async () => {
    const mockUpdate = { update_id: 12345 } as any;
    const result = await controller.handleWebhook(
      mockUpdate,
      'test-secret-at-least-16-chars',
    );

    expect(result).toEqual({ ok: true });
    expect(telegramService.handleWebhookUpdate).toHaveBeenCalledWith(mockUpdate);
  });

  it('should throw UnauthorizedException if secret token does not match', async () => {
    const mockUpdate = { update_id: 12345 } as any;

    await expect(
      controller.handleWebhook(mockUpdate, 'wrong-secret'),
    ).rejects.toThrow(UnauthorizedException);
    expect(telegramService.handleWebhookUpdate).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if secret token is missing when configured', async () => {
    const mockUpdate = { update_id: 12345 } as any;

    await expect(
      controller.handleWebhook(mockUpdate, undefined),
    ).rejects.toThrow(UnauthorizedException);
    expect(telegramService.handleWebhookUpdate).not.toHaveBeenCalled();
  });

  it('should fail closed with UnauthorizedException in production when secret is not configured', async () => {
    configService.get = jest.fn((key: string) => {
      if (key === 'NODE_ENV') return 'production';
      if (key === 'TELEGRAM_WEBHOOK_SECRET') return '';
      return undefined;
    });

    const mockUpdate = { update_id: 12345 } as any;

    await expect(
      controller.handleWebhook(mockUpdate, 'some-header'),
    ).rejects.toThrow(UnauthorizedException);
    expect(telegramService.handleWebhookUpdate).not.toHaveBeenCalled();
  });

  it('should return { ok: true } when bot is not configured', async () => {
    telegramService.getBotInstance = jest.fn().mockReturnValue(null);
    const mockUpdate = { update_id: 12345 } as any;

    const result = await controller.handleWebhook(
      mockUpdate,
      'test-secret-at-least-16-chars',
    );
    expect(result).toEqual({ ok: true });
    expect(telegramService.handleWebhookUpdate).not.toHaveBeenCalled();
  });

  it('should catch handler errors and return { ok: true } to prevent infinite Telegram retries', async () => {
    telegramService.handleWebhookUpdate = jest
      .fn()
      .mockRejectedValue(new Error('Transient failure'));

    const mockUpdate = { update_id: 12345 } as any;
    const result = await controller.handleWebhook(
      mockUpdate,
      'test-secret-at-least-16-chars',
    );

    expect(result).toEqual({ ok: true });
    expect(telegramService.handleWebhookUpdate).toHaveBeenCalledWith(mockUpdate);
  });

  it('should report health and configuration status', () => {
    const health = controller.health();
    expect(health).toEqual({
      status: 'ok',
      configured: true,
      initialized: true,
      mode: 'webhook',
    });
  });
});
