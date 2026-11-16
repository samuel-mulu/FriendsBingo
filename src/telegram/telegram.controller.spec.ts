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
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'TELEGRAM_WEBHOOK_SECRET') return 'test-secret';
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
    const result = await controller.handleWebhook(mockUpdate, 'test-secret');

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

  it('should report health and configuration status', () => {
    const health = controller.health();
    expect(health).toEqual({ status: 'ok', configured: true });
  });
});
